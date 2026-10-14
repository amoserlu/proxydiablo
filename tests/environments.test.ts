import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  clearSessionPasswords,
  listEnvironmentProfiles,
  loadEnvironments,
  looksLikeMissingPassword,
  resolveEnvironment,
  setSessionPassword,
} from '../server/environments';
import { resolveConnection } from '../server/pgadmin';

let dir: string;

function writeFile(content: unknown): void {
  fs.writeFileSync(path.join(dir, 'environments.json'), typeof content === 'string' ? content : JSON.stringify(content));
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'proxydiablo-env-'));
  process.env.PROXYDIABLO_ENVIRONMENTS = path.join(dir, 'environments.json');
  clearSessionPasswords();
});

afterEach(() => {
  delete process.env.PROXYDIABLO_ENVIRONMENTS;
  delete process.env.DIABLO_TEST_PASSWORD;
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('manual environments', () => {
  it('treats a missing file as no environments', () => {
    expect(loadEnvironments()).toEqual([]);
    expect(listEnvironmentProfiles()).toEqual([]);
  });

  it('lists environments as profiles without exposing passwords', () => {
    writeFile({ environments: [{ name: 'staging', host: 'db.example.com', port: 6432, database: 'app', user: 'ro', password: 'secret' }] });
    const [profile] = listEnvironmentProfiles();
    expect(profile).toMatchObject({ name: 'staging', host: 'db.example.com', port: 6432, username: 'ro', maintenanceDb: 'app' });
    expect(JSON.stringify(profile)).not.toContain('secret');
  });

  it('rejects malformed files with a clear message', () => {
    writeFile('{nope');
    expect(() => loadEnvironments()).toThrow('not valid JSON');
    writeFile({ environments: [{ name: 'x', host: 'h' }] });
    expect(() => loadEnvironments()).toThrow('environments[0].user is required');
    writeFile({ environments: [{ name: 'x', host: 'h', user: 'u', port: 99999 }] });
    expect(() => loadEnvironments()).toThrow('port');
    writeFile({ environments: [{ name: 'x', host: 'h', user: 'u' }, { name: 'x', host: 'h', user: 'u' }] });
    expect(() => loadEnvironments()).toThrow('duplicate');
  });

  it('returns undefined for unknown names so pgAdmin can handle them', () => {
    writeFile({ environments: [] });
    expect(resolveEnvironment('prod', 'app')).toBeUndefined();
  });

  it('uses the requested database, falling back to the environment default', () => {
    writeFile({ environments: [{ name: 'dev', host: 'h', user: 'u', database: 'main' }] });
    expect(resolveEnvironment('dev', 'other')?.database).toBe('other');
    expect(resolveEnvironment('dev', '')?.database).toBe('main');
  });

  it('prefers session password, then passwordEnv, then the file password', () => {
    writeFile({ environments: [{ name: 'dev', host: 'h', user: 'u', password: 'from-file', passwordEnv: 'DIABLO_TEST_PASSWORD' }] });
    expect(resolveEnvironment('dev', 'd')?.password).toBe('from-file');
    process.env.DIABLO_TEST_PASSWORD = 'from-env';
    expect(resolveEnvironment('dev', 'd')?.password).toBe('from-env');
    setSessionPassword('dev', 'from-session');
    expect(resolveEnvironment('dev', 'd')?.password).toBe('from-session');
  });

  it('refuses a session password for an unknown environment', () => {
    writeFile({ environments: [] });
    expect(() => setSessionPassword('ghost', 'pw')).toThrow('Unknown environment');
  });

  it('flags only password-looking failures on environments without a password', () => {
    writeFile({ environments: [{ name: 'dev', host: 'h', user: 'u' }, { name: 'pw', host: 'h', user: 'u', password: 'x' }] });
    const sasl = new Error('SASL: SCRAM-SERVER-FIRST-MESSAGE: client password must be a string');
    expect(looksLikeMissingPassword('dev', sasl)).toBe(true);
    expect(looksLikeMissingPassword('dev', new Error('connect ECONNREFUSED'))).toBe(false);
    expect(looksLikeMissingPassword('pw', sasl)).toBe(false);
    expect(looksLikeMissingPassword('pgadmin-profile', sasl)).toBe(false);
  });

  it('resolveConnection serves environments without calling pgAdmin', async () => {
    writeFile({ environments: [{ name: 'dev', host: 'h', user: 'u' }] });
    await expect(resolveConnection('dev', 'd')).resolves.toMatchObject({ name: 'dev', host: 'h', database: 'd' });
  });
});
