import { describe, expect, it } from 'vitest';
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
