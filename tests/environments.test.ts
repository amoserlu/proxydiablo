import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  clearSessionPasswords,
  listEnvironmentProfiles,
  loadEnvironments,
  looksLikeMissingPassword,
  regionFromHost,
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

  it('returns undefined for unknown names so pgAdmin can handle them', async () => {
    writeFile({ environments: [] });
    expect(await resolveEnvironment('prod', 'app')).toBeUndefined();
  });

  it('uses the requested database, falling back to the environment default', async () => {
    writeFile({ environments: [{ name: 'dev', host: 'h', user: 'u', database: 'main' }] });
    expect((await resolveEnvironment('dev', 'other'))?.database).toBe('other');
    expect((await resolveEnvironment('dev', ''))?.database).toBe('main');
  });

  it('prefers session password, then passwordEnv, then the file password', async () => {
    writeFile({ environments: [{ name: 'dev', host: 'h', user: 'u', password: 'from-file', passwordEnv: 'DIABLO_TEST_PASSWORD' }] });
    expect((await resolveEnvironment('dev', 'd'))?.password).toBe('from-file');
    process.env.DIABLO_TEST_PASSWORD = 'from-env';
    expect((await resolveEnvironment('dev', 'd'))?.password).toBe('from-env');
    setSessionPassword('dev', 'from-session');
    expect((await resolveEnvironment('dev', 'd'))?.password).toBe('from-session');
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

describe('rds-iam environments', () => {
  const host = 'db.cluster-abc123.eu-west-2.rds.amazonaws.com';

  function fakeAws(script: string): string {
    const file = path.join(dir, 'aws');
    fs.writeFileSync(file, `#!/usr/bin/env bash\n${script}\n`, { mode: 0o755 });
    process.env.PROXYDIABLO_AWS_CLI = file;
    return file;
  }

  afterEach(() => {
    delete process.env.PROXYDIABLO_AWS_CLI;
    delete process.env.AWS_CONFIG_FILE;
  });

  it('derives the region from an RDS hostname', () => {
    expect(regionFromHost(host)).toBe('eu-west-2');
    expect(regionFromHost('localhost')).toBeUndefined();
  });

  it('requires a region when it cannot be derived and forbids passwords', () => {
    writeFile({ environments: [{ name: 'i', host: 'localhost', user: 'u', auth: 'rds-iam' }] });
    expect(() => loadEnvironments()).toThrow('region is required');
    writeFile({ environments: [{ name: 'i', host, user: 'u', auth: 'rds-iam', password: 'x' }] });
    expect(() => loadEnvironments()).toThrow('cannot define a password');
    writeFile({ environments: [{ name: 'i', host, user: 'u', auth: 'magic' }] });
    expect(() => loadEnvironments()).toThrow('auth must be');
  });

  it('mints a token with the aws CLI and forces SSL', async () => {
    writeFile({ environments: [{ name: 'iam', host, user: 'dev', auth: 'rds-iam', awsProfile: 'cec_developer', database: 'app' }] });
    fakeAws('echo "TOKEN:$*"');
    const connection = await resolveEnvironment('iam', '');
    expect(connection?.sslmode).toBe('require');
    expect(connection?.password).toBe(
      `TOKEN:rds generate-db-auth-token --hostname ${host} --port 5432 --region eu-west-2 --username dev --profile cec_developer`,
    );
  });

  it('tells the user which profile to log in with when the SSO session expired', async () => {
    writeFile({ environments: [{ name: 'iam', host, user: 'dev', auth: 'rds-iam', awsProfile: 'cec_developer' }] });
    const config = path.join(dir, 'aws-config');
    fs.writeFileSync(config, '[profile aircury_cec_developer]\nsso_session=Aircury\n\n[profile cec_developer]\nsource_profile=aircury_cec_developer\n');
    process.env.AWS_CONFIG_FILE = config;
    fakeAws('echo "Error loading SSO Token: Token for x does not exist" >&2; exit 255');
    await expect(resolveEnvironment('iam', '')).rejects.toThrow('aws sso login --profile aircury_cec_developer');
  });

  it('explains a missing aws CLI', async () => {
    writeFile({ environments: [{ name: 'iam', host, user: 'dev', auth: 'rds-iam' }] });
    process.env.PROXYDIABLO_AWS_CLI = path.join(dir, 'no-such-aws');
    await expect(resolveEnvironment('iam', '')).rejects.toThrow('aws CLI was not found');
  });

  it('never asks for a password for IAM environments', () => {
    writeFile({ environments: [{ name: 'iam', host, user: 'dev', auth: 'rds-iam' }] });
    expect(looksLikeMissingPassword('iam', new Error('client password must be a string'))).toBe(false);
  });
});
