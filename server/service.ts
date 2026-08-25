import crypto from 'node:crypto';
import { applyFilters, toggleExactFilter } from '../src/shared/filters.js';
import { classifySql } from '../src/shared/sqlClassifier.js';
import type {
  ActionClassification,
  AppStateSnapshot,
  CommandInstruction,
  CommandResult,
  CommandSubmitRequest,
  CommandTab,
  FilterRule,
  PgsqlSubmitRequest,
  PgsqlTab,
  ProfileSummary,
  ProxyResponse,
  ProxyTab,
} from '../src/shared/types.js';
import { listProfiles, resolveConnection } from './pgadmin.js';
import { inspectStructure } from './pgsql.js';
import { runQuery } from './queryRunner.js';
import { loadFilters, saveFilters } from './store.js';

export class DoubleConfirmationRequiredError extends Error {
  constructor() {
    super('double_confirmation_required');
  }
}

export class SensitiveOutputConfirmationRequiredError extends Error {
  constructor() {
    super('sensitive_output_confirmation_required');
  }
}

type CommandInstructionWithoutSeq =
  | Omit<Extract<CommandInstruction, { type: 'run' }>, 'seq'>
  | Omit<Extract<CommandInstruction, { type: 'cancelled' }>, 'seq'>
  | Omit<Extract<CommandInstruction, { type: 'revision_requested' }>, 'seq'>
  | Omit<Extract<CommandInstruction, { type: 'released' }>, 'seq'>
  | Omit<Extract<CommandInstruction, { type: 'error' }>, 'seq'>;

export class ProxyService {
  private filters: FilterRule[] = loadFilters();
  private tabs: ProxyTab[] = [];
  private activeTabId: string | undefined;
  private attentionSeq = 0;
  private attentionTabId: string | undefined;
  private profiles: ProfileSummary[] = [];
  private uiClients = 0;
  private readonly listeners = new Set<(state: AppStateSnapshot) => void>();
  private readonly pgsqlWaiters = new Map<string, (response: ProxyResponse) => void>();
  private readonly commandInstructions = new Map<string, CommandInstruction>();
  private readonly commandSequences = new Map<string, number>();

  snapshot(): AppStateSnapshot {
    return {
      tabs: this.tabs,
      activeTabId: this.activeTabId,
      filters: this.filters,
      profiles: this.profiles,
      attentionSeq: this.attentionSeq,
      attentionTabId: this.attentionTabId,
    };
  }

  subscribe(listener: (state: AppStateSnapshot) => void): () => void {
    this.listeners.add(listener);
    listener(this.snapshot());
    return () => this.listeners.delete(listener);
  }

  connectUi(): () => void {
    this.uiClients += 1;
    let connected = true;
    return () => {
      if (!connected) return;
      connected = false;
      this.uiClients = Math.max(0, this.uiClients - 1);
    };
  }

  hasUiClients(): boolean {
    return this.uiClients > 0;
  }

  async refreshProfiles(): Promise<void> {
    try {
      this.profiles = await listProfiles();
      this.broadcast();
    } catch {
      console.error('Could not load pgAdmin profiles.');
    }
  }

  createPgsqlTab(request?: Partial<PgsqlSubmitRequest>): PgsqlTab {
    const sql = request?.sql ?? '';
    const profile = request?.profile ?? '';
    const database = request?.database ?? '';
    const tab: PgsqlTab = {
      id: this.makeId(request ? 'pgsql' : 'manual'),
      proxyType: 'pgsql',
      title: database || 'New PostgreSQL request',
      profile,
      database,
      sql,
      description: request?.description?.trim() || undefined,
      source: request ? 'codex' : 'manual',
      status: request ? 'waiting_user' : 'draft',
      classification: request?.classification ?? 'read',
      detectedClassification: classifySql(sql),
      createdAt: new Date().toISOString(),
    };
    this.addTab(tab, Boolean(request));
    return tab;
  }

  createCommandTab(request: CommandSubmitRequest): CommandTab {
    const tab: CommandTab = {
      id: this.makeId('command'),
      proxyType: 'command',
      title: commandTitle(request.command),
      command: request.command,
      cwd: request.cwd,
      description: request.description.trim() || undefined,
      source: 'codex',
      status: 'waiting_user',
      classification: request.classification,
      createdAt: new Date().toISOString(),
    };
    this.commandSequences.set(tab.id, 0);
    this.addTab(tab, true);
    return tab;
  }

  submitPgsql(request: PgsqlSubmitRequest): Promise<ProxyResponse> {
    const tab = this.createPgsqlTab(request);
    return new Promise((resolve) => this.pgsqlWaiters.set(tab.id, resolve));
  }

  setActiveTab(tabId: string): void {
    if (!this.tabs.some((tab) => tab.id === tabId)) return;
    this.activeTabId = tabId;
    this.broadcast();
  }

  updatePgsql(tabId: string, sql: string): void {
    const tab = this.getTab(tabId, 'pgsql');
    if (!tab) return;
    this.updateTab(tabId, {
      sql,
      detectedClassification: classifySql(sql),
      status: tab.status === 'waiting_user' ? 'waiting_user' : 'draft',
      error: undefined,
      result: undefined,
      filtered: undefined,
    });
  }

  updateConnection(tabId: string, profile: string, database: string): void {
    const tab = this.getTab(tabId, 'pgsql');
    if (!tab) return;
    this.updateTab(tabId, {
      profile,
      database,
      title: database || profile || 'New PostgreSQL request',
      error: undefined,
      status: tab.source === 'codex' ? 'waiting_user' : 'draft',
    });
  }

  updateCommand(tabId: string, command: string, cwd: string): void {
    const tab = this.getTab(tabId, 'command');
    if (!tab || tab.status === 'running') return;
    this.updateTab(tabId, {
      command,
      cwd,
      title: commandTitle(command),
      error: undefined,
      result: undefined,
      status: 'waiting_user',
    });
  }

  updateClassification(tabId: string, classification: ActionClassification): void {
    const tab = this.tabs.find((item) => item.id === tabId);
    if (!tab || tab.status === 'running' || !isClassification(classification)) return;
    this.updateTab(tabId, { classification });
  }

  async approveTab(tabId: string, doubleConfirmed: boolean): Promise<void> {
    const tab = this.tabs.find((item) => item.id === tabId);
    if (!tab) return;
    if (requiresDoubleConfirmation(tab) && !doubleConfirmed) throw new DoubleConfirmationRequiredError();

    if (tab.proxyType === 'command') {
      if (!tab.command.trim() || !tab.cwd.trim()) {
        this.updateTab(tabId, { status: 'error', error: 'Command and working directory are required.' });
        return;
      }
      this.updateTab(tabId, { status: 'running', error: undefined, result: undefined });
      this.issueCommandInstruction(tabId, { type: 'run', command: tab.command, cwd: tab.cwd });
      return;
    }

    if (!tab.profile.trim() || !tab.database.trim() || !tab.sql.trim()) {
      this.updateTab(tabId, { status: 'error', error: 'Profile, database and SQL are required.' });
      return;
    }
    this.updateTab(tabId, { status: 'running', error: undefined });
    try {
      const connection = await resolveConnection(tab.profile, tab.database);
      const result = await runQuery(connection, tab.sql, tab.detectedClassification === 'read');
      const current = this.getTab(tabId, 'pgsql');
      if (current?.status === 'running') this.updateTab(tabId, { status: 'executed', result, error: undefined });
    } catch (error) {
      const message = safeError(error);
      this.updateTab(tabId, { status: 'error', error: message });
    }
  }

  storeCommandResult(tabId: string, result: CommandResult): void {
    const tab = this.getTab(tabId, 'command');
    if (!tab || tab.status !== 'running') return;
    this.updateTab(tabId, { status: 'executed', result: normalizeCommandResult(result), error: undefined });
  }

  cancelTab(tabId: string): void {
    const tab = this.tabs.find((item) => item.id === tabId);
    if (!tab) return;
    this.updateTab(tabId, { status: 'cancelled' });
    if (tab.proxyType === 'command') this.issueCommandInstruction(tabId, { type: 'cancelled' });
    else this.finishPgsql(tabId, { status: 'cancelled', tabId, proxyType: 'pgsql' });
  }

  requestRevision(tabId: string, explanation: string): void {
    const feedback = explanation.trim();
    if (!feedback) throw new Error('An explanation is required.');
    const tab = this.tabs.find((item) => item.id === tabId);
    if (!tab) return;
    this.updateTab(tabId, { status: 'revision_requested', feedback });
    if (tab.proxyType === 'command') {
      this.issueCommandInstruction(tabId, { type: 'revision_requested', explanation: feedback });
    } else {
      this.finishPgsql(tabId, {
        status: 'revision_requested',
        tabId,
        proxyType: 'pgsql',
        explanation: feedback,
      });
    }
  }

  releaseTab(tabId: string, sensitiveDataConfirmed: boolean): void {
    if (!sensitiveDataConfirmed) throw new SensitiveOutputConfirmationRequiredError();
    const tab = this.tabs.find((item) => item.id === tabId);
    if (!tab || tab.status !== 'executed') return;

    if (tab.proxyType === 'pgsql') {
      if (!tab.filtered) return;
      this.updateTab(tabId, { status: 'released', releasedAt: new Date().toISOString() });
      this.finishPgsql(tabId, { status: 'released', tabId, proxyType: 'pgsql', result: tab.filtered });
      return;
    }

    if (!tab.result) return;
    this.updateTab(tabId, { status: 'released', releasedAt: new Date().toISOString() });
    this.issueCommandInstruction(tabId, { type: 'released' });
  }

  closeTab(tabId: string): void {
    const tab = this.tabs.find((item) => item.id === tabId);
    if (!tab) return;
    if (!['released', 'cancelled', 'revision_requested'].includes(tab.status)) this.cancelTab(tabId);
    const index = this.tabs.findIndex((item) => item.id === tabId);
    this.tabs = this.tabs.filter((item) => item.id !== tabId);
    if (this.activeTabId === tabId) {
      this.activeTabId = this.tabs[Math.max(0, index - 1)]?.id ?? this.tabs[0]?.id;
    }
    this.broadcast();
  }

  commandInstruction(tabId: string, afterSeq: number): CommandInstruction | undefined {
    const instruction = this.commandInstructions.get(tabId);
    return instruction && instruction.seq > afterSeq ? instruction : undefined;
  }

  saveFilters(nextFilters: FilterRule[]): void {
    this.filters = nextFilters;
    saveFilters(this.filters);
    this.reapplyFilters();
  }

  quickFilter(columnName: string): void {
    this.filters = toggleExactFilter(this.filters, columnName);
    saveFilters(this.filters);
    this.reapplyFilters();
  }

  toggleTabFilterExemption(tabId: string, columnName: string): void {
    const tab = this.getTab(tabId, 'pgsql');
    if (!tab) return;
    const existing = tab.filterExemptColumns ?? [];
    const exists = existing.some((column) => column.toLowerCase() === columnName.toLowerCase());
    this.updateTab(tabId, {
      filterExemptColumns: exists
        ? existing.filter((column) => column.toLowerCase() !== columnName.toLowerCase())
        : [...existing, columnName],
    });
  }

  inspect = inspectStructure;

  private addTab(tab: ProxyTab, requestAttention: boolean): void {
    this.tabs = [...this.tabs, tab];
    this.activeTabId = tab.id;
    if (requestAttention) {
      this.attentionSeq += 1;
      this.attentionTabId = tab.id;
    }
    this.broadcast();
  }

  private getTab(tabId: string, proxyType: 'pgsql'): PgsqlTab | undefined;
  private getTab(tabId: string, proxyType: 'command'): CommandTab | undefined;
  private getTab(tabId: string, proxyType: ProxyTab['proxyType']): ProxyTab | undefined {
    return this.tabs.find((tab) => tab.id === tabId && tab.proxyType === proxyType);
  }

  private updateTab(tabId: string, patch: Partial<PgsqlTab> | Partial<CommandTab>): void {
    this.tabs = this.tabs.map((tab) => {
      if (tab.id !== tabId) return tab;
      const updated = { ...tab, ...patch } as ProxyTab;
      if (updated.proxyType === 'pgsql' && updated.result) {
        updated.filtered = applyFilters(updated.result, this.filters, updated.filterExemptColumns ?? []);
      }
      return updated;
    });
    this.broadcast();
  }

  private reapplyFilters(): void {
    this.tabs = this.tabs.map((tab) => tab.proxyType === 'pgsql' && tab.result
      ? { ...tab, filtered: applyFilters(tab.result, this.filters, tab.filterExemptColumns ?? []) }
      : tab);
    this.broadcast();
  }

  private issueCommandInstruction(
    tabId: string,
    instruction: CommandInstructionWithoutSeq,
  ): void {
    const seq = (this.commandSequences.get(tabId) ?? 0) + 1;
    this.commandSequences.set(tabId, seq);
    this.commandInstructions.set(tabId, { ...instruction, seq } as CommandInstruction);
  }

  private finishPgsql(tabId: string, response: ProxyResponse): void {
    this.pgsqlWaiters.get(tabId)?.(response);
    this.pgsqlWaiters.delete(tabId);
  }

  private makeId(prefix: string): string {
    return `${prefix}_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  }

  private broadcast(): void {
    const state = this.snapshot();
    for (const listener of this.listeners) listener(state);
  }
}

export function requiresDoubleConfirmation(tab: ProxyTab): boolean {
  return tab.classification === 'write' || (tab.proxyType === 'pgsql' && tab.detectedClassification !== 'read');
}

function normalizeCommandResult(result: CommandResult): CommandResult {
  let outputKind: CommandResult['outputKind'] = 'text';
  if (result.stdout.trim()) {
    try {
      JSON.parse(result.stdout);
      outputKind = 'json';
    } catch {
      // Non-JSON output stays text.
    }
  }
  return { ...result, outputKind };
}

function commandTitle(command: string): string {
  const firstLine = command.trim().split(/\r?\n/, 1)[0] || 'Command';
  return firstLine.length > 48 ? `${firstLine.slice(0, 45)}...` : firstLine;
}

function isClassification(value: string): value is ActionClassification {
  return value === 'read' || value === 'write';
}

function safeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
