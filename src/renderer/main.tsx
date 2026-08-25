import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import CodeMirror from '@uiw/react-codemirror';
import { sql } from '@codemirror/lang-sql';
import { oneDark } from '@codemirror/theme-one-dark';
import { format as formatSql } from 'sql-formatter';
import {
  AlertTriangle,
  AlignLeft,
  Braces,
  Copy,
  Eye,
  EyeOff,
  FileText,
  Filter,
  MessageSquareWarning,
  Play,
  Plus,
  Send,
  Square,
  Trash2,
  X,
} from 'lucide-react';
import type {
  AppStateSnapshot,
  CommandResult,
  CommandTab,
  FilterRule,
  PgsqlTab,
  ProxyTab,
} from '../shared/types';
import { api } from './api';
import './styles.css';

function App() {
  const [state, setState] = useState<AppStateSnapshot>({ tabs: [], filters: [], profiles: [], attentionSeq: 0 });
  const [showFilters, setShowFilters] = useState(false);
  const [showRaw, setShowRaw] = useState(false);
  const [attentionTabId, setAttentionTabId] = useState<string>();
  const [formattedTabs, setFormattedTabs] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    void api.getState().then(setState);
    return api.onState(setState);
  }, []);

  const active = useMemo(
    () => state.tabs.find((tab) => tab.id === state.activeTabId) ?? state.tabs[0],
    [state.activeTabId, state.tabs],
  );

  useEffect(() => {
    if (!state.attentionSeq || !state.attentionTabId) return;
    setAttentionTabId(state.attentionTabId);
    const timer = window.setTimeout(() => setAttentionTabId(undefined), 1400);
    return () => window.clearTimeout(timer);
  }, [state.attentionSeq, state.attentionTabId]);

  useEffect(() => {
    for (const tab of state.tabs) {
      if (tab.proxyType !== 'pgsql' || tab.source !== 'codex' || formattedTabs.has(tab.id)) continue;
      const formatted = formatSqlForEditor(tab.sql);
      setFormattedTabs((current) => new Set(current).add(tab.id));
      if (formatted !== tab.sql) void api.updatePgsql(tab.id, formatted);
      break;
    }
  }, [formattedTabs, state.tabs]);

  return (
    <div className={`app-shell ${attentionTabId ? 'attention' : ''}`}>
      <header className="app-header">
        <div className="brand"><span />proxydiablo</div>
        <button className="primary-action" onClick={() => void api.newPgsqlTab()}>
          <Plus size={16} /> New PostgreSQL tab
        </button>
      </header>

      <main className="workspace">
        <div className="tab-strip">
          {state.tabs.map((tab) => (
            <button
              key={tab.id}
              className={`tab ${tab.id === active?.id ? 'active' : ''} ${tab.status} ${tab.id === attentionTabId ? 'attention-tab' : ''}`}
              onClick={() => void api.setActiveTab(tab.id)}
            >
              <span className={`proxy-badge ${tab.proxyType}`}>{tab.proxyType}</span>
              <span className="tab-title">{tab.title}</span>
              <small>{tab.status}</small>
              <span
                className="tab-close"
                title="Close tab"
                onClick={(event) => {
                  event.stopPropagation();
                  void api.closeTab(tab.id);
                }}
              >
                <X size={13} />
              </span>
            </button>
          ))}
        </div>

        {active?.proxyType === 'pgsql' ? (
          <PgsqlPane
            key={active.id}
            tab={active}
            profiles={state.profiles}
            filters={state.filters}
            showRaw={showRaw}
            onToggleRaw={() => setShowRaw((value) => !value)}
            onOpenFilters={() => setShowFilters(true)}
          />
        ) : active?.proxyType === 'command' ? (
          <CommandPane key={active.id} tab={active} />
        ) : (
          <div className="empty-state">No requests. Create a PostgreSQL tab or submit a command from Codex.</div>
        )}
      </main>

      {showFilters && <FilterManager filters={state.filters} onClose={() => setShowFilters(false)} />}
    </div>
  );
}

interface CommonActionState {
  confirmationStep?: 1 | 2;
  showRevision?: boolean;
  showRelease?: boolean;
  actionError?: string;
}

function useCommonActions(tab: ProxyTab) {
  const [state, setState] = useState<CommonActionState>({});
  const requiresDouble = tab.classification === 'write' || (tab.proxyType === 'pgsql' && tab.detectedClassification !== 'read');
  const canRun = !['running', 'released', 'cancelled', 'revision_requested'].includes(tab.status);
  const canCancel = !['released', 'cancelled', 'revision_requested'].includes(tab.status);
  const canRelease = tab.status === 'executed' && Boolean(tab.result);

  async function perform(action: () => Promise<unknown>) {
    setState((current) => ({ ...current, actionError: undefined }));
    try {
      await action();
    } catch (error) {
      setState((current) => ({ ...current, actionError: error instanceof Error ? error.message : String(error) }));
    }
  }

  return {
    state,
    requiresDouble,
    canRun,
    canCancel,
    canRelease,
    openRun: () => requiresDouble
      ? setState((current) => ({ ...current, confirmationStep: 1 }))
      : void perform(() => api.run(tab.id, false)),
    continueRun: () => setState((current) => ({ ...current, confirmationStep: 2 })),
    confirmRun: () => {
      setState((current) => ({ ...current, confirmationStep: undefined }));
      void perform(() => api.run(tab.id, true));
    },
    closeRun: () => setState((current) => ({ ...current, confirmationStep: undefined })),
    cancel: () => void perform(() => api.cancel(tab.id)),
    openRevision: () => setState((current) => ({ ...current, showRevision: true })),
    closeRevision: () => setState((current) => ({ ...current, showRevision: false })),
    revise: (explanation: string) => {
      setState((current) => ({ ...current, showRevision: false }));
      void perform(() => api.revise(tab.id, explanation));
    },
    openRelease: () => setState((current) => ({ ...current, showRelease: true })),
    closeRelease: () => setState((current) => ({ ...current, showRelease: false })),
    confirmRelease: () => {
      setState((current) => ({ ...current, showRelease: false }));
      void perform(() => api.release(tab.id));
    },
  };
}

function CommonToolbar({
  tab,
  actions,
  runDisabled,
  children,
}: {
  tab: ProxyTab;
  actions: ReturnType<typeof useCommonActions>;
  runDisabled?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <>
      <div className="toolbar">
        <button
          className="danger-run"
          disabled={!actions.canRun || runDisabled}
          onClick={actions.openRun}
        >
          <Play size={16} /> Run
        </button>
        <button disabled={!actions.canCancel} onClick={actions.cancel}>
          <Square size={16} /> Cancel
        </button>
        <button disabled={!actions.canCancel} onClick={actions.openRevision}>
          <MessageSquareWarning size={16} /> Cancel with explanation
        </button>
        <button disabled={!actions.canRelease} onClick={actions.openRelease}>
          <Send size={16} /> Send output
        </button>
        {children}
      </div>
      {actions.state.actionError && <div className="action-error">{actions.state.actionError}</div>}
      {actions.state.confirmationStep && (
        <WriteConfirmationModal
          step={actions.state.confirmationStep}
          proxyType={tab.proxyType}
          onCancel={actions.closeRun}
          onContinue={actions.continueRun}
          onConfirm={actions.confirmRun}
        />
      )}
      {actions.state.showRevision && (
        <RevisionModal onCancel={actions.closeRevision} onConfirm={actions.revise} />
      )}
      {actions.state.showRelease && (
        <ReleaseConfirmationModal onCancel={actions.closeRelease} onConfirm={actions.confirmRelease} />
      )}
    </>
  );
}

function ClassificationControl({ tab }: { tab: ProxyTab }) {
  const parserForcesWrite = tab.proxyType === 'pgsql' && tab.detectedClassification !== 'read';
  return (
    <label className="classification-control">
      Declared type
      <select
        value={tab.classification}
        disabled={tab.status === 'running'}
        onChange={(event) => void api.updateClassification(tab.id, event.target.value as 'read' | 'write')}
      >
        <option value="read">Read · one confirmation</option>
        <option value="write">Write · two confirmations</option>
      </select>
      {parserForcesWrite && <small>SQL parser requires write safeguards</small>}
    </label>
  );
}

function Description({ tab }: { tab: ProxyTab }) {
  const [visible, setVisible] = useState(true);
  if (!tab.description) return null;
  return visible ? (
    <div className="request-description">
      <div>
        <strong>What this request does</strong>
        <button onClick={() => setVisible(false)}><X size={14} /> Hide</button>
      </div>
      <p>{tab.description}</p>
    </div>
  ) : (
    <button className="show-description" onClick={() => setVisible(true)}><FileText size={16} /> Show description</button>
  );
}

function PgsqlPane({
  tab,
  profiles,
  filters,
  showRaw,
  onToggleRaw,
  onOpenFilters,
}: {
  tab: PgsqlTab;
  profiles: AppStateSnapshot['profiles'];
  filters: FilterRule[];
  showRaw: boolean;
  onToggleRaw(): void;
  onOpenFilters(): void;
}) {
  const actions = useCommonActions(tab);
  const [editorHeight, setEditorHeight] = useResizableEditor('proxydiablo:pgsql-editor-height', 230);
  const visible = showRaw && tab.result ? tab.result : tab.filtered;
  const filteredColumns = new Set(tab.filtered?.filteredColumns ?? []);
  const filterExemptColumns = new Set((tab.filterExemptColumns ?? []).map((column) => column.toLowerCase()));
  const connectionMissing = !tab.profile.trim() || !tab.database.trim() || !tab.sql.trim();
  const currentProfileExists = profiles.some((profile) => profile.name === tab.profile);

  return (
    <section className="query-pane">
      <div className="query-meta pgsql-meta">
        <label>
          Profile
          <select
            value={tab.profile}
            onChange={(event) => {
              const profile = profiles.find((item) => item.name === event.target.value);
              void api.updateConnection(tab.id, event.target.value, tab.database || profile?.maintenanceDb || 'postgres');
            }}
          >
            <option value="">Select pgAdmin profile</option>
            {tab.profile && !currentProfileExists && <option value={tab.profile}>{tab.profile}</option>}
            {profiles.map((profile) => (
              <option key={profile.id} value={profile.name}>
                {profile.name}{profile.username ? ` · ${profile.username}` : ''}{profile.host ? ` @ ${profile.host}` : ''}
              </option>
            ))}
          </select>
        </label>
        <label>
          Database
          <input
            value={tab.database}
            placeholder="database"
            onChange={(event) => void api.updateConnection(tab.id, tab.profile, event.target.value)}
          />
        </label>
        <ClassificationControl tab={tab} />
      </div>

      <CommonToolbar tab={tab} actions={actions} runDisabled={connectionMissing}>
        <button onClick={() => void api.updatePgsql(tab.id, formatSqlForEditor(tab.sql))}>
          <AlignLeft size={16} /> Format SQL
        </button>
        <button disabled={!tab.result} onClick={onToggleRaw}>
          {showRaw ? <EyeOff size={16} /> : <Eye size={16} />} {showRaw ? 'Show filtered' : 'Show unfiltered'}
        </button>
        <button className="toolbar-last" onClick={onOpenFilters}>
          <Filter size={16} /> Filters ({filters.filter((rule) => rule.enabled).length})
        </button>
      </CommonToolbar>

      <Description tab={tab} />
      <Editor
        label="SQL"
        value={tab.sql}
        height={editorHeight}
        extensions={[sql()]}
        onChange={(value) => void api.updatePgsql(tab.id, value)}
      />
      <GridResizer height={editorHeight} onResize={setEditorHeight} label="Resize SQL editor and result grid" />
      <PgsqlStatus tab={tab} actionError={actions.state.actionError} />
      <ResultGrid
        tabId={tab.id}
        result={visible}
        filteredColumns={filteredColumns}
        filterExemptColumns={filterExemptColumns}
      />
    </section>
  );
}

function CommandPane({ tab }: { tab: CommandTab }) {
  const actions = useCommonActions(tab);
  const [editorHeight, setEditorHeight] = useResizableEditor('proxydiablo:command-editor-height', 190);
  const commandMissing = !tab.command.trim() || !tab.cwd.trim();

  return (
    <section className="query-pane command-pane">
      <div className="query-meta command-meta">
        <label>
          Working directory
          <input
            value={tab.cwd}
            placeholder="/absolute/path"
            disabled={tab.status === 'running'}
            onChange={(event) => void api.updateCommand(tab.id, tab.command, event.target.value)}
          />
        </label>
        <ClassificationControl tab={tab} />
      </div>

      <CommonToolbar tab={tab} actions={actions} runDisabled={commandMissing} />
      <Description tab={tab} />
      <Editor
        label="Command"
        value={tab.command}
        height={editorHeight}
        extensions={[]}
        onChange={(value) => void api.updateCommand(tab.id, value, tab.cwd)}
      />
      <GridResizer height={editorHeight} onResize={setEditorHeight} label="Resize command editor and output" />
      <CommandStatus tab={tab} />
      <CommandOutput result={tab.result} />
    </section>
  );
}

function Editor({
  label,
  value,
  height,
  extensions,
  onChange,
}: {
  label: string;
  value: string;
  height: number;
  extensions: Parameters<typeof CodeMirror>[0]['extensions'];
  onChange(value: string): void;
}) {
  return (
    <div className="editor-wrap">
      <div className="editor-label">{label}</div>
      <CodeMirror
        value={value}
        height={`${height}px`}
        extensions={extensions}
        theme={oneDark}
        basicSetup={{ lineNumbers: true, foldGutter: true }}
        onChange={onChange}
      />
    </div>
  );
}

function useResizableEditor(storageKey: string, initialHeight: number): [number, (height: number) => void] {
  const [height, setHeight] = useState(() => {
    const saved = Number(window.localStorage.getItem(storageKey));
    return Number.isFinite(saved) && saved >= 90 && saved <= 520 ? saved : initialHeight;
  });
  return [height, (nextHeight: number) => {
    const clamped = Math.max(90, Math.min(520, Math.round(nextHeight)));
    setHeight(clamped);
    window.localStorage.setItem(storageKey, String(clamped));
  }];
}

function GridResizer({ height, onResize, label }: { height: number; onResize(height: number): void; label: string }) {
  function startResize(event: React.PointerEvent<HTMLDivElement>) {
    event.preventDefault();
    const startY = event.clientY;
    const startHeight = height;
    document.body.classList.add('resizing-grid');
    const move = (pointerEvent: PointerEvent) => onResize(startHeight + pointerEvent.clientY - startY);
    const stop = () => {
      document.body.classList.remove('resizing-grid');
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('pointercancel', stop);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop, { once: true });
    window.addEventListener('pointercancel', stop, { once: true });
  }

  return (
    <div
      className="grid-resizer"
      role="separator"
      aria-label={label}
      aria-orientation="horizontal"
      aria-valuemin={90}
      aria-valuemax={520}
      aria-valuenow={height}
      tabIndex={0}
      title="Drag up to give more space to output"
      onPointerDown={startResize}
      onKeyDown={(event) => {
        if (event.key === 'ArrowUp') { event.preventDefault(); onResize(height - 20); }
        else if (event.key === 'ArrowDown') { event.preventDefault(); onResize(height + 20); }
        else if (event.key === 'Home') { event.preventDefault(); onResize(90); }
        else if (event.key === 'End') { event.preventDefault(); onResize(520); }
      }}
    ><span /></div>
  );
}

function PgsqlStatus({ tab }: { tab: PgsqlTab; actionError?: string }) {
  return (
    <div className="status-line">
      <span className={`status-pill ${tab.status}`}><i />{tab.status}</span>
      <span className="kind-label">PGSQL · declared {tab.classification} · detected {tab.detectedClassification}</span>
      {tab.result && <span>{tab.result.rowCount} rows · {tab.result.durationMs} ms</span>}
      {tab.error && <span className="error-text">{tab.error}</span>}
    </div>
  );
}

function CommandStatus({ tab }: { tab: CommandTab }) {
  return (
    <div className="status-line">
      <span className={`status-pill ${tab.status}`}><i />{tab.status}</span>
      <span className="kind-label">COMMAND · declared {tab.classification}</span>
      {tab.result && (
        <>
          <span>exit {tab.result.exitCode ?? tab.result.signal ?? 'unknown'}</span>
          <span>{tab.result.durationMs} ms</span>
          <span>{tab.result.outputKind}</span>
        </>
      )}
      {tab.error && <span className="error-text">{tab.error}</span>}
    </div>
  );
}

function CommandOutput({ result }: { result?: CommandResult }) {
  if (!result) return <div className="empty-output">No output. Run the command to inspect it locally.</div>;
  let parsed: unknown;
  if (result.outputKind === 'json' && result.stdout.trim()) {
    try { parsed = JSON.parse(result.stdout); } catch { parsed = undefined; }
  }
  return (
    <div className="command-output">
      <section>
        <header><Braces size={15} /> stdout {result.stdoutTruncated && <em>truncated</em>}</header>
        {parsed !== undefined ? <JsonValue value={parsed} name="root" depth={0} /> : <pre>{result.stdout || '(empty)'}</pre>}
      </section>
      <section className="stderr-output">
        <header><AlertTriangle size={15} /> stderr {result.stderrTruncated && <em>truncated</em>}</header>
        <pre>{result.stderr || '(empty)'}</pre>
      </section>
    </div>
  );
}

function JsonValue({ value, name, depth }: { value: unknown; name: string; depth: number }) {
  if (value !== null && typeof value === 'object') {
    const entries = Array.isArray(value)
      ? value.map((item, index) => [String(index), item] as const)
      : Object.entries(value as Record<string, unknown>);
    return (
      <details className="json-node" open={depth < 2}>
        <summary>{name} <span>{Array.isArray(value) ? `[${entries.length}]` : `{${entries.length}}`}</span></summary>
        <div className="json-children">
          {entries.map(([key, item]) => <JsonValue key={key} name={key} value={item} depth={depth + 1} />)}
        </div>
      </details>
    );
  }
  return <div className="json-leaf"><strong>{name}:</strong> <code>{JSON.stringify(value)}</code></div>;
}

function ResultGrid({
  tabId,
  result,
  filteredColumns,
  filterExemptColumns,
}: {
  tabId: string;
  result?: { columns: { name: string }[]; rows: Record<string, unknown>[] };
  filteredColumns: Set<string>;
  filterExemptColumns: Set<string>;
}) {
  const [selection, setSelection] = useState<CellSelection>();
  const [isSelecting, setIsSelecting] = useState(false);
  if (!result) return <div className="empty-output">No output. Run a query to see results.</div>;

  const visibleRows = result.rows.slice(0, 1000);
  const currentResult = result;
  const selectedCount = selection ? selectedCellCount(selection) : 0;
  async function copySelection() {
    if (!selection || selectedCount === 0) return;
    await copyText(selectionToTsv(currentResult, visibleRows, selection));
  }

  return (
    <div
      className={`grid-wrap ${selectedCount > 0 ? 'has-selection' : ''}`}
      tabIndex={0}
      onMouseUp={() => setIsSelecting(false)}
      onKeyDown={(event) => {
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'c' && selection) {
          event.preventDefault();
          void copySelection();
        }
        if (event.key === 'Escape') { setSelection(undefined); setIsSelecting(false); }
      }}
    >
      {selectedCount > 0 && (
        <div className="grid-selection-bar">
          <span>{selectedCount} selected</span>
          <button onClick={() => void copySelection()}><Copy size={14} /> Copy selected</button>
          <button onClick={() => setSelection(undefined)}><X size={14} /> Clear</button>
        </div>
      )}
      <table className="result-grid">
        <thead>
          <tr>
            <th>#</th>
            {result.columns.map((column) => {
              const isExempt = filterExemptColumns.has(column.name.toLowerCase());
              return (
                <th key={column.name} className={isExempt ? 'exempt-column' : filteredColumns.has(column.name) ? 'filtered-column' : ''}>
                  <div className="column-head">
                    <span>{column.name}</span>
                    <div className="column-actions">
                      <button
                        title={filteredColumns.has(column.name) ? 'Toggle global exact filter off' : 'Add global exact filter'}
                        onClick={() => void api.quickFilter(column.name)}
                      ><Filter size={13} /></button>
                      <button
                        className={isExempt ? 'column-exempt-active' : ''}
                        title={isExempt ? 'Apply filters to this column in this tab' : 'Do not filter this column in this tab'}
                        onClick={() => void api.toggleTabFilterExemption(tabId, column.name)}
                      >{isExempt ? <EyeOff size={13} /> : <Eye size={13} />}</button>
                    </div>
                  </div>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {visibleRows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              <td className="row-num">{rowIndex + 1}</td>
              {result.columns.map((column, columnIndex) => {
                const selected = isCellSelected(selection, rowIndex, columnIndex);
                const exempt = filterExemptColumns.has(column.name.toLowerCase());
                return (
                  <td
                    key={column.name}
                    className={[exempt ? 'exempt-column' : filteredColumns.has(column.name) ? 'filtered-column' : '', selected ? 'selected-cell' : ''].filter(Boolean).join(' ')}
                    onMouseDown={(event) => {
                      if (event.button !== 0) return;
                      event.preventDefault();
                      setIsSelecting(true);
                      setSelection({ anchor: { row: rowIndex, column: columnIndex }, focus: { row: rowIndex, column: columnIndex } });
                    }}
                    onMouseEnter={() => {
                      if (!isSelecting) return;
                      setSelection((current) => current
                        ? { ...current, focus: { row: rowIndex, column: columnIndex } }
                        : { anchor: { row: rowIndex, column: columnIndex }, focus: { row: rowIndex, column: columnIndex } });
                    }}
                  >{formatCell(row[column.name])}</td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

interface CellCoord { row: number; column: number }
interface CellSelection { anchor: CellCoord; focus: CellCoord }

function selectedCellCount(selection: CellSelection): number {
  return (Math.abs(selection.focus.row - selection.anchor.row) + 1)
    * (Math.abs(selection.focus.column - selection.anchor.column) + 1);
}

function selectionBounds(selection: CellSelection) {
  return {
    startRow: Math.min(selection.anchor.row, selection.focus.row),
    endRow: Math.max(selection.anchor.row, selection.focus.row),
    startColumn: Math.min(selection.anchor.column, selection.focus.column),
    endColumn: Math.max(selection.anchor.column, selection.focus.column),
  };
}

function isCellSelected(selection: CellSelection | undefined, row: number, column: number): boolean {
  if (!selection) return false;
  const bounds = selectionBounds(selection);
  return row >= bounds.startRow && row <= bounds.endRow && column >= bounds.startColumn && column <= bounds.endColumn;
}

function selectionToTsv(
  result: { columns: { name: string }[]; rows: Record<string, unknown>[] },
  rows: Record<string, unknown>[],
  selection: CellSelection,
): string {
  const bounds = selectionBounds(selection);
  const lines: string[] = [];
  for (let rowIndex = bounds.startRow; rowIndex <= bounds.endRow; rowIndex += 1) {
    const values: string[] = [];
    for (let columnIndex = bounds.startColumn; columnIndex <= bounds.endColumn; columnIndex += 1) {
      values.push(escapeTsv(formatCell(rows[rowIndex]?.[result.columns[columnIndex].name])));
    }
    lines.push(values.join('\t'));
  }
  return lines.join('\n');
}

function escapeTsv(value: string): string {
  return value.replace(/\t/g, ' ').replace(/\r?\n/g, ' ');
}

async function copyText(value: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(value);
  } catch {
    const area = document.createElement('textarea');
    area.value = value;
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    document.execCommand('copy');
    document.body.removeChild(area);
  }
}

function WriteConfirmationModal({
  step,
  proxyType,
  onCancel,
  onContinue,
  onConfirm,
}: {
  step: 1 | 2;
  proxyType: ProxyTab['proxyType'];
  onCancel(): void;
  onContinue(): void;
  onConfirm(): void;
}) {
  const finalStep = step === 2;
  return (
    <div className="modal-backdrop">
      <div className="warning-modal" role="alertdialog" aria-modal="true" aria-labelledby="write-warning-title">
        <div className="warning-icon"><AlertTriangle size={22} /></div>
        <div>
          <small>Confirmation {step} of 2</small>
          <h2 id="write-warning-title">{finalStep ? 'Final confirmation' : 'Write action detected'}</h2>
          <p>{finalStep
            ? `This ${proxyType} request can modify state. Confirm that you want to run it now.`
            : 'The declared action or the SQL parser says this may write. It requires two explicit confirmations.'}</p>
        </div>
        <div className="warning-actions">
          <button onClick={onCancel}>Go back</button>
          <button className="danger-confirm" onClick={finalStep ? onConfirm : onContinue}>
            {finalStep ? 'Run write action' : 'I understand'}
          </button>
        </div>
      </div>
    </div>
  );
}

function RevisionModal({ onCancel, onConfirm }: { onCancel(): void; onConfirm(explanation: string): void }) {
  const [explanation, setExplanation] = useState('');
  return (
    <div className="modal-backdrop">
      <div className="feedback-modal" role="dialog" aria-modal="true" aria-labelledby="revision-title">
        <h2 id="revision-title">Cancel with explanation</h2>
        <p>Tell Codex what it should change. The current request will stop and your explanation will be returned.</p>
        <textarea
          autoFocus
          value={explanation}
          placeholder="For example: reformulate it so the email field is not returned."
          onChange={(event) => setExplanation(event.target.value)}
        />
        <div className="warning-actions">
          <button onClick={onCancel}>Go back</button>
          <button className="danger-confirm" disabled={!explanation.trim()} onClick={() => onConfirm(explanation)}>
            Cancel and send explanation
          </button>
        </div>
      </div>
    </div>
  );
}

function ReleaseConfirmationModal({ onCancel, onConfirm }: { onCancel(): void; onConfirm(): void }) {
  return (
    <div className="modal-backdrop">
      <div className="warning-modal" role="alertdialog" aria-modal="true" aria-labelledby="release-title">
        <div className="warning-icon"><AlertTriangle size={22} /></div>
        <div>
          <small>Sensitive-data check</small>
          <h2 id="release-title">Are you sure there is no sensitive data?</h2>
          <p>Only send the output after inspecting it. Command output is never filtered automatically.</p>
        </div>
        <div className="warning-actions">
          <button onClick={onCancel}>Review output</button>
          <button className="danger-confirm" onClick={onConfirm}>I confirm — send output</button>
        </div>
      </div>
    </div>
  );
}

function FilterManager({ filters, onClose }: { filters: FilterRule[]; onClose(): void }) {
  const [draft, setDraft] = useState<FilterRule[]>(filters);
  function update(id: string, patch: Partial<FilterRule>) {
    setDraft((rules) => rules.map((rule) => rule.id === id ? { ...rule, ...patch } : rule));
  }
  function addRule() {
    setDraft((rules) => [...rules, {
      id: `rule:${Date.now()}`,
      pattern: '*new*',
      mode: 'glob',
      enabled: true,
      createdAt: new Date().toISOString(),
    }]);
  }
  async function save() { await api.saveFilters(draft); onClose(); }
  return (
    <div className="modal-backdrop">
      <div className="filter-modal">
        <header><h2>PostgreSQL filter rules</h2><button onClick={onClose}>Close</button></header>
        <div className="filter-actions">
          <button onClick={addRule}><Plus size={16} /> Add rule</button>
          <button className="primary-action" onClick={() => void save()}>Save and reapply</button>
        </div>
        <div className="rules-list">
          {draft.map((rule) => (
            <div key={rule.id} className="rule-row">
              <input type="checkbox" checked={rule.enabled} onChange={(event) => update(rule.id, { enabled: event.target.checked })} />
              <select value={rule.mode} onChange={(event) => update(rule.id, { mode: event.target.value as FilterRule['mode'] })}>
                <option value="glob">glob</option><option value="exact">exact</option>
              </select>
              <input value={rule.pattern} onChange={(event) => update(rule.id, { pattern: event.target.value })} />
              <button onClick={() => setDraft((rules) => rules.filter((item) => item.id !== rule.id))}><Trash2 size={15} /></button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function formatCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function formatSqlForEditor(value: string): string {
  if (!value.trim()) return value;
  try {
    return formatSql(value, { language: 'postgresql', keywordCase: 'preserve', linesBetweenQueries: 1 });
  } catch {
    return value;
  }
}

createRoot(document.getElementById('root')!).render(<App />);
