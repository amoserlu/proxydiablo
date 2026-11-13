import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../server/pgadmin', () => ({ listProfiles: vi.fn(), resolveConnection: vi.fn(async () => ({ name: 'fixture' })) }));
vi.mock('../server/queryRunner', () => ({ runQuery: vi.fn() }));
vi.mock('../server/environments', () => ({ profileEngine: () => 'postgresql', passwordPromptReason: vi.fn(), setSessionPassword: vi.fn() }));
import { ProxyService, SensitiveOutputConfirmationRequiredError } from '../server/service';
import { runQuery } from '../server/queryRunner';
import { passwordPromptReason } from '../server/environments';
import { canEditRequest, canRunRequest } from '../src/shared/requestLifecycle';

const request = { profile: 'fixture', database: 'fixture', sql: 'insert into t values (1)', description: 'Fixture write', classification: 'write' as const };
const result = { columns: [], rows: [], rowCount: 1, command: 'INSERT', durationMs: 1 };
beforeEach(() => vi.resetAllMocks());

describe('single execution per request', () => {
  it('ignores double approvals and edits during execution, then keeps the original output for release', async () => {
    let finish!: (value: typeof result) => void;
    vi.mocked(runQuery).mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    const service = new ProxyService();
    const { tabId, response } = service.startPgsqlSubmission(request);
    const running = service.approveTab(tabId, true);
    await Promise.resolve();
    for (const phase of ['running', 'executed']) {
      if (phase === 'executed') { finish(result); await running; }
      service.updatePgsql(tabId, 'delete from t');
      service.updateConnection(tabId, 'other', 'other');
      service.updateClassification(tabId, 'read');
      await service.approveTab(tabId, true);
      const tab = service.snapshot().tabs[0];
      expect(tab).toMatchObject({ ...request, status: phase });
      expect(canEditRequest(tab)).toBe(false);
      expect(canRunRequest(tab)).toBe(false);
      expect(runQuery).toHaveBeenCalledTimes(1);
    }
    service.releaseTab(tabId, true);
    await expect(response).resolves.toMatchObject({ status: 'released', result: { rowCount: 1 } });
    service.updatePgsql(tabId, 'select 2');
    await service.approveTab(tabId, true);
    expect(service.snapshot().tabs[0].status).toBe('released');
    expect(runQuery).toHaveBeenCalledTimes(1);
  });

  it('keeps a failed SQL request immutable and returns its exact SQL only with confirmed error release', async () => {
    vi.mocked(runQuery).mockRejectedValueOnce(new Error('fixture query error'));
    const service = new ProxyService();
    const { tabId, response } = service.startPgsqlSubmission(request);
    let delivered = false;
    void response.then(() => { delivered = true; });
    await service.approveTab(tabId, true);
    service.updatePgsql(tabId, 'select changed');
    service.updateConnection(tabId, 'other', 'other');
    await service.approveTab(tabId, true);
    expect(runQuery).toHaveBeenCalledTimes(1);
    expect(service.snapshot().tabs[0]).toMatchObject({ status: 'error', sql: request.sql });
    expect(delivered).toBe(false);
    expect(() => service.sendError(tabId, false)).toThrow(SensitiveOutputConfirmationRequiredError);
    service.sendError(tabId, true);
    await expect(response).resolves.toEqual({ status: 'error', tabId, proxyType: 'pgsql', sql: request.sql, error: 'fixture query error' });
    service.updatePgsql(tabId, 'select changed');
    await service.approveTab(tabId, true);
    expect(service.snapshot().tabs[0].status).toBe('error_sent');
    expect(runQuery).toHaveBeenCalledTimes(1);
  });

  it.each([0, 1])('does not issue a second command after exit code %s, even after editing', async (exitCode) => {
    const service = new ProxyService();
    const tab = service.createCommandTab({ command: 'fixture-command', cwd: '/tmp', description: 'Fixture', classification: 'read' });
    await service.approveTab(tab.id, false);
    service.storeCommandResult(tab.id, { stdout: 'fixture', stderr: exitCode ? 'failure' : '', exitCode, signal: null, durationMs: 1, stdoutTruncated: false, stderrTruncated: false, outputKind: 'text' });
    service.updateCommand(tab.id, 'changed-command', '/');
    service.updateClassification(tab.id, 'write');
    await service.approveTab(tab.id, true);
    expect(service.commandInstruction(tab.id, 1)).toBeUndefined();
    expect(service.snapshot().tabs[0]).toMatchObject({ status: 'executed', command: 'fixture-command', cwd: '/tmp', classification: 'read', result: { exitCode } });
    service.releaseTab(tab.id, true);
    service.updateCommand(tab.id, 'changed-command', '/');
    await service.approveTab(tab.id, true);
    expect(service.commandInstruction(tab.id, 1)).toMatchObject({ type: 'released', seq: 2 });
  });

  it.each(['cancel', 'revise'] as const)('cannot revive a request after %s', async (action) => {
    const service = new ProxyService();
    const tab = service.createPgsqlTab(request);
    if (action === 'cancel') service.cancelTab(tab.id);
    else service.requestRevision(tab.id, 'Please revise');
    service.updatePgsql(tab.id, 'select 1');
    service.updateConnection(tab.id, 'other', 'other');
    await service.approveTab(tab.id, true);
    expect(runQuery).not.toHaveBeenCalled();
    expect(canRunRequest(service.snapshot().tabs[0])).toBe(false);
  });

  it('still allows supplying a password when authentication failed before SQL execution', async () => {
    vi.mocked(runQuery).mockRejectedValueOnce(new Error('authentication failed')).mockResolvedValueOnce(result);
    vi.mocked(passwordPromptReason).mockReturnValueOnce('missing');
    const service = new ProxyService();
    const tab = service.createPgsqlTab(request);
    await service.approveTab(tab.id, true);
    expect(service.snapshot().tabs[0]).toMatchObject({ status: 'waiting_user', passwordRequiredFor: 'fixture' });
    await service.approveTab(tab.id, true);
    expect(runQuery).toHaveBeenCalledTimes(1);
    service.provideEnvironmentPassword(tab.id, 'fixture-only');
    await service.approveTab(tab.id, true);
    expect(service.snapshot().tabs[0].status).toBe('executed');
  });
});
