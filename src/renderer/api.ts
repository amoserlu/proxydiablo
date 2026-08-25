import type { ActionClassification, AppStateSnapshot, FilterRule } from '../shared/types';

interface Envelope<T = unknown> {
  ok: boolean;
  data?: T;
  error?: string;
}

let sessionPromise: Promise<void> | undefined;

async function ensureSession(): Promise<void> {
  sessionPromise ??= fetch('/api/session', { credentials: 'same-origin', cache: 'no-store' }).then((response) => {
    if (!response.ok) throw new Error(`Unable to create UI session (${response.status})`);
  });
  return sessionPromise;
}

async function request<T = unknown>(method: string, route: string, body?: unknown): Promise<T> {
  await ensureSession();
  const response = await fetch(route, {
    method,
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const envelope = await response.json() as Envelope<T>;
  if (!response.ok || !envelope.ok) throw new Error(envelope.error || `HTTP ${response.status}`);
  return envelope.data as T;
}

function tabRoute(tabId: string, action?: string): string {
  return `/api/tabs/${encodeURIComponent(tabId)}${action ? `/${action}` : ''}`;
}

export const api = {
  getState: () => request<AppStateSnapshot>('GET', '/api/state'),
  newPgsqlTab: () => request('POST', '/api/tabs/pgsql', {}),
  updatePgsql: (tabId: string, sql: string) => request('PATCH', tabRoute(tabId, 'pgsql'), { sql }),
  updateConnection: (tabId: string, profile: string, database: string) =>
    request('PATCH', tabRoute(tabId, 'connection'), { profile, database }),
  updateCommand: (tabId: string, command: string, cwd: string) =>
    request('PATCH', tabRoute(tabId, 'command'), { command, cwd }),
  updateClassification: (tabId: string, classification: ActionClassification) =>
    request('PATCH', tabRoute(tabId, 'classification'), { classification }),
  run: (tabId: string, doubleConfirmed: boolean) =>
    request('POST', tabRoute(tabId, 'run'), { doubleConfirmed }),
  cancel: (tabId: string) => request('POST', tabRoute(tabId, 'cancel'), {}),
  revise: (tabId: string, explanation: string) =>
    request('POST', tabRoute(tabId, 'revise'), { explanation }),
  release: (tabId: string) =>
    request('POST', tabRoute(tabId, 'release'), { sensitiveDataConfirmed: true }),
  setActiveTab: (tabId: string) => request('POST', tabRoute(tabId, 'active'), {}),
  closeTab: (tabId: string) => request('DELETE', tabRoute(tabId), {}),
  saveFilters: (filters: FilterRule[]) => request('PUT', '/api/filters', { filters }),
  quickFilter: (columnName: string) => request('POST', '/api/filters/quick', { columnName }),
  toggleTabFilterExemption: (tabId: string, columnName: string) =>
    request('POST', tabRoute(tabId, 'filter-exemption'), { columnName }),
  onState(callback: (state: AppStateSnapshot) => void, onError?: () => void): () => void {
    let events: EventSource | undefined;
    let closed = false;
    void ensureSession().then(() => {
      if (closed) return;
      events = new EventSource('/api/events');
      events.addEventListener('state', (event) => callback(JSON.parse((event as MessageEvent<string>).data)));
      events.onerror = () => onError?.();
    });
    return () => {
      closed = true;
      events?.close();
    };
  },
};
