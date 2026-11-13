import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DoubleConfirmationRequiredError,
  ProxyService,
  SensitiveOutputConfirmationRequiredError,
} from '../server/service';

describe('ProxyService', () => {
  it('keeps mixed proxy tabs and active selection in one snapshot', () => {
    const service = new ProxyService();
    const pgsql = service.createPgsqlTab();
    const command = service.createCommandTab({
      command: 'printf ok',
      cwd: '/tmp',
      description: 'Print a harmless marker.',
      classification: 'read',
    });

    service.updateConnection(pgsql.id, 'production', 'app');
    service.updatePgsql(pgsql.id, 'select 1;');
    service.setActiveTab(pgsql.id);

    expect(service.snapshot().activeTabId).toBe(pgsql.id);
    expect(service.snapshot().tabs).toHaveLength(2);
    expect(service.snapshot().tabs.find((tab) => tab.id === pgsql.id)).toMatchObject({
      proxyType: 'pgsql',
      profile: 'production',
      database: 'app',
      detectedClassification: 'read',
    });
    expect(service.snapshot().tabs.find((tab) => tab.id === command.id)).toMatchObject({
      proxyType: 'command',
      classification: 'read',
      status: 'waiting_user',
    });
  });

  it('requires double confirmation for declared writes and conservatively detected SQL writes', async () => {
    const service = new ProxyService();
    const declaredWrite = service.createCommandTab({
      command: 'touch marker',
      cwd: '/tmp',
      description: 'Create a marker.',
      classification: 'write',
    });
    const detectedWrite = service.createPgsqlTab({
      profile: 'production',
      database: 'app',
      sql: 'delete from users;',
      description: 'Delete users.',
      classification: 'read',
    });

    await expect(service.approveTab(declaredWrite.id, false)).rejects.toBeInstanceOf(DoubleConfirmationRequiredError);
    await expect(service.approveTab(detectedWrite.id, false)).rejects.toBeInstanceOf(DoubleConfirmationRequiredError);
    expect(service.snapshot().tabs.every((tab) => tab.status === 'waiting_user')).toBe(true);
  });

  it('issues a run instruction for a read command after one approval', async () => {
    const service = new ProxyService();
    const tab = service.createCommandTab({
      command: 'printf ok',
      cwd: '/tmp',
      description: 'Print a marker.',
      classification: 'read',
    });

    await service.approveTab(tab.id, false);

    expect(service.commandInstruction(tab.id, 0)).toMatchObject({
      seq: 1,
      type: 'run',
      command: 'printf ok',
      cwd: '/tmp',
    });
    expect(service.snapshot().tabs[0].status).toBe('running');
  });

  it('returns revision feedback for both proxy types', async () => {
    const service = new ProxyService();
    const pendingPgsql = service.submitPgsql({
      profile: 'production',
      database: 'app',
      sql: 'select email from users;',
      description: 'List user emails.',
      classification: 'read',
    });
    const pgsqlId = service.snapshot().activeTabId!;
    service.requestRevision(pgsqlId, 'Remove the email field.');

    await expect(pendingPgsql).resolves.toMatchObject({
      status: 'revision_requested',
      explanation: 'Remove the email field.',
    });

    const command = service.createCommandTab({
      command: 'curl localhost',
      cwd: '/tmp',
      description: 'Call the local endpoint.',
      classification: 'read',
    });
    service.requestRevision(command.id, 'Only return the status field.');
    expect(service.commandInstruction(command.id, 0)).toMatchObject({
      type: 'revision_requested',
      explanation: 'Only return the status field.',
    });
  });

  it('does not release command output without the sensitive-data confirmation', () => {
    const service = new ProxyService();
    const tab = service.createCommandTab({
      command: 'printf ok',
      cwd: '/tmp',
      description: 'Print a marker.',
      classification: 'read',
    });
    void service.approveTab(tab.id, false);
    service.storeCommandResult(tab.id, {
      stdout: '{"ok":true}',
      stderr: '',
      exitCode: 0,
      signal: null,
      durationMs: 3,
      stdoutTruncated: false,
      stderrTruncated: false,
      outputKind: 'text',
    });

    expect(() => service.releaseTab(tab.id, false)).toThrow(SensitiveOutputConfirmationRequiredError);
    expect(service.snapshot().tabs[0]).toMatchObject({
      status: 'executed',
      result: { outputKind: 'json' },
    });

    service.releaseTab(tab.id, true);
    expect(service.commandInstruction(tab.id, 1)).toMatchObject({ type: 'released' });
  });

  it('tracks whether a browser UI is currently connected', () => {
    const service = new ProxyService();
    const disconnect = service.connectUi();
    expect(service.hasUiClients()).toBe(true);
    disconnect();
    expect(service.hasUiClients()).toBe(false);
  });
});

describe('ProxyService column filters', () => {
  it('flips any column of a tab between hidden and shown from the eye toggle', () => {
    const service = new ProxyService();
    const tab = service.createPgsqlTab();
    const result = { columns: [{ name: 'email' }, { name: 'total' }], rows: [{ email: 'a@example.com', total: 3 }], rowCount: 1, durationMs: 1 };
    (service as unknown as { updateTab(id: string, patch: object): void }).updateTab(tab.id, { result });
    const hidden = (column: string) => {
      const current = service.snapshot().tabs[0];
      return current.proxyType === 'pgsql' && Boolean(current.filtered?.filteredColumns.includes(column));
    };
    // Starting state depends on the configured rules; the toggle must flip it either way.
    for (const column of ['email', 'total']) {
      const initially = hidden(column);
      service.toggleTabColumnFilter(tab.id, column);
      expect(hidden(column)).toBe(!initially);
      service.toggleTabColumnFilter(tab.id, column);
      expect(hidden(column)).toBe(initially);
    }
  });
});

describe('ProxyService send error', () => {
  const failTab = (service: ProxyService, tabId: string, error: string) =>
    (service as unknown as { updateTab(id: string, patch: object): void }).updateTab(tabId, { status: 'error', error });

  it('returns a SQL error to the waiting requester only after the sensitive-data check', async () => {
    const service = new ProxyService();
    const { tabId, response } = service.startPgsqlSubmission({
      profile: 'p',
      database: 'd',
      sql: 'select missing_column from users;',
      description: 'Send error test.',
      classification: 'read',
    });
    service.sendError(tabId, true);
    expect(service.snapshot().tabs[0].status).toBe('waiting_user');

    failTab(service, tabId, 'column "missing_column" does not exist');
    expect(() => service.sendError(tabId, false)).toThrow(SensitiveOutputConfirmationRequiredError);
    service.sendError(tabId, true);
    await expect(response).resolves.toEqual({
      status: 'error',
      tabId,
      proxyType: 'pgsql',
      error: 'column "missing_column" does not exist',
      sql: 'select missing_column from users;',
    });
    expect(service.snapshot().tabs[0].status).toBe('error_sent');
  });

  it('returns a command error through the instruction channel', () => {
    const service = new ProxyService();
    const tab = service.createCommandTab({ command: 'true', cwd: '/tmp', description: 'Send error test.', classification: 'read' });
    failTab(service, tab.id, 'Command and working directory are required.');
    service.sendError(tab.id, true);
    expect(service.commandInstruction(tab.id, 0)).toMatchObject({ type: 'error', error: 'Command and working directory are required.' });
  });
});

describe('ProxyService abandoned submissions', () => {
  it('cancels a waiting tab when its requester disconnects', async () => {
    const service = new ProxyService();
    const { tabId } = service.startPgsqlSubmission({
      profile: 'p',
      database: 'd',
      sql: 'select 1;',
      description: 'Abandon test.',
      classification: 'read',
    });
    service.abandonPgsql(tabId);
    const tab = service.snapshot().tabs.find((item) => item.id === tabId);
    expect(tab).toMatchObject({ status: 'cancelled' });
    expect(tab?.error).toContain('requester disconnected');
  });

  it('leaves a finished tab alone', () => {
    const service = new ProxyService();
    const { tabId } = service.startPgsqlSubmission({
      profile: 'p',
      database: 'd',
      sql: 'select 1;',
      description: 'Abandon test.',
      classification: 'read',
    });
    service.cancelTab(tabId);
    service.abandonPgsql(tabId);
    expect(service.snapshot().tabs.find((item) => item.id === tabId)?.error).toBeUndefined();
  });
});

describe('ProxyService database engines', () => {
  let dir: string;
  const writeEnvironments = (engine?: string) => fs.writeFileSync(
    process.env.PROXYDIABLO_ENVIRONMENTS!,
    JSON.stringify({ environments: [{ name: 'shop', host: 'h', user: 'u', ...(engine ? { engine } : {}) }] }),
  );
  // Read for PostgreSQL ($a$ quoting), but a DROP between two identifiers for MySQL.
  const sql = 'select $a$; drop table users; $a$';
  const request = { profile: 'shop', database: 'app', sql, description: 'Engine test.', classification: 'read' as const };

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'proxydiablo-engine-'));
    process.env.PROXYDIABLO_ENVIRONMENTS = path.join(dir, 'environments.json');
  });

  afterEach(() => {
    delete process.env.PROXYDIABLO_ENVIRONMENTS;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('classifies SQL with the engine of the selected environment', async () => {
    writeEnvironments('mysql');
    const service = new ProxyService();
    const tab = service.createPgsqlTab(request);
    expect(tab).toMatchObject({ engine: 'mysql', detectedClassification: 'ambiguous' });
    await expect(service.approveTab(tab.id, false)).rejects.toBeInstanceOf(DoubleConfirmationRequiredError);

    service.updateConnection(tab.id, 'pgadmin-profile', 'app');
    expect(service.snapshot().tabs[0]).toMatchObject({ engine: 'postgresql', detectedClassification: 'read' });
  });

  it('re-checks the engine when the environment changes before approval', async () => {
    writeEnvironments();
    const service = new ProxyService();
    const tab = service.createPgsqlTab(request);
    expect(tab).toMatchObject({ engine: 'postgresql', detectedClassification: 'read' });

    writeEnvironments('mysql');
    await expect(service.approveTab(tab.id, false)).rejects.toBeInstanceOf(DoubleConfirmationRequiredError);
    expect(service.snapshot().tabs[0]).toMatchObject({ engine: 'mysql', detectedClassification: 'ambiguous', status: 'waiting_user' });
  });
});
