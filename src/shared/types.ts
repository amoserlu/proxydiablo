export type ProxyKind = 'pgsql' | 'command';
export type ActionClassification = 'read' | 'write';
export type ProxySource = 'codex' | 'manual';

export type ProxyStatus =
  | 'draft'
  | 'waiting_user'
  | 'running'
  | 'executed'
  | 'released'
  | 'cancelled'
  | 'revision_requested'
  | 'error';

export type SqlClassification = 'read' | 'write' | 'ambiguous';

export interface ProfileSummary {
  id: number;
  name: string;
  host?: string;
  port?: number;
  username?: string;
  maintenanceDb?: string;
}

export interface QueryColumn {
  name: string;
  dataTypeID?: number;
}

export interface QueryResult {
  columns: QueryColumn[];
  rows: Record<string, unknown>[];
  rowCount: number;
  command?: string;
  durationMs: number;
}

export interface FilterRule {
  id: string;
  pattern: string;
  mode: 'exact' | 'glob';
  enabled: boolean;
  createdAt: string;
}

export interface FilteredResult extends QueryResult {
  filteredColumns: string[];
  rows: Record<string, unknown>[];
}

interface BaseProxyTab {
  id: string;
  proxyType: ProxyKind;
  title: string;
  description?: string;
  source: ProxySource;
  status: ProxyStatus;
  classification: ActionClassification;
  error?: string;
  feedback?: string;
  releasedAt?: string;
  createdAt: string;
}

export interface PgsqlTab extends BaseProxyTab {
  proxyType: 'pgsql';
  profile: string;
  database: string;
  sql: string;
  detectedClassification: SqlClassification;
  result?: QueryResult;
  filtered?: FilteredResult;
  filterExemptColumns?: string[];
}

export interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal: string | null;
  durationMs: number;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
  outputKind: 'json' | 'text';
}

export interface CommandTab extends BaseProxyTab {
  proxyType: 'command';
  command: string;
  cwd: string;
  result?: CommandResult;
}

export type ProxyTab = PgsqlTab | CommandTab;

export interface AppStateSnapshot {
  tabs: ProxyTab[];
  activeTabId?: string;
  filters: FilterRule[];
  profiles: ProfileSummary[];
  attentionSeq: number;
  attentionTabId?: string;
}

export interface PgsqlSubmitRequest {
  profile: string;
  database: string;
  sql: string;
  description: string;
  classification: ActionClassification;
}

export interface CommandSubmitRequest {
  command: string;
  cwd: string;
  description: string;
  classification: ActionClassification;
}

export type ReleasedResult = FilteredResult | CommandResult;

export type ProxyResponse =
  | { status: 'released'; tabId: string; proxyType: ProxyKind; result: ReleasedResult }
  | { status: 'cancelled'; tabId: string; proxyType: ProxyKind }
  | { status: 'revision_requested'; tabId: string; proxyType: ProxyKind; explanation: string }
  | { status: 'error'; tabId: string; proxyType: ProxyKind; error: string };

export type CommandInstruction =
  | { seq: number; type: 'run'; command: string; cwd: string }
  | { seq: number; type: 'cancelled' }
  | { seq: number; type: 'revision_requested'; explanation: string }
  | { seq: number; type: 'released' }
  | { seq: number; type: 'error'; error: string };

export type InspectKind = 'schemas' | 'tables' | 'views' | 'columns' | 'all';

export interface InspectRequest {
  profile: string;
  database: string;
  kinds: InspectKind[];
  schema?: string;
}

export interface InspectResult {
  profile: string;
  database: string;
  schema?: string;
  schemas?: string[];
  tables?: Record<string, unknown>[];
  views?: Record<string, unknown>[];
  columns?: Record<string, unknown>[];
}

export interface BridgeEnvelope<T = unknown> {
  ok: boolean;
  data?: T;
  error?: string;
}
