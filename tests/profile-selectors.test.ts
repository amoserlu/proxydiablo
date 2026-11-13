import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { listProfiles, resolveConnection } from '../server/pgadmin';
import { clearSessionPasswords, passwordPromptReason, resolveEnvironment, setSessionPassword } from '../server/environments';
let dir: string;
const write = (names = ['shared']) => fs.writeFileSync(path.join(dir, 'environments.json'), JSON.stringify({ environments: names.map(name => ({name, host: `${name}.manual.invalid`, user: 'fixture'})) }));
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'proxy-selector-test-'));
  const helper = path.join(dir, 'helper');
  fs.writeFileSync(helper, `#!/usr/bin/env node\nconst p={id:1,name:'shared',host:'pgadmin.fixture.invalid',database:'fixture'}; console.log(JSON.stringify(process.argv[3]==='list'?{profiles:[p]}:p));\n`, {mode: 0o700});
  vi.stubEnv('PROXYDIABLO_PGADMIN_PYTHON', helper);
  vi.stubEnv('PROXYDIABLO_ENVIRONMENTS', path.join(dir, 'environments.json'));
  write();clearSessionPasswords();
});
afterEach(() => { clearSessionPasswords();vi.unstubAllEnvs();fs.rmSync(dir,{recursive:true}); });
it('provides different stable selectors for equally named sources and resolves each destination', async () => {
  const profiles = await listProfiles();
  expect(profiles.map(p => p.selector)).toEqual(['env:shared', 'pgadmin:1']);
  expect((await resolveConnection(profiles[0].selector!, 'fixture')).host).toBe('shared.manual.invalid');
  expect((await resolveConnection(profiles[1].selector!, 'fixture')).host).toBe('pgadmin.fixture.invalid');
  await expect(resolveConnection('shared', 'fixture')).rejects.toThrow('Ambiguous');
});
it('never falls back to another source when a qualified environment is removed', async () => {
  write([]);
  await expect(resolveConnection('env:shared', 'fixture')).rejects.toThrow('no longer exists');
});
it('keeps environment identity stable when entries are reordered', async () => {
  write(['other', 'shared']);
  expect((await resolveConnection('env:shared', 'fixture')).host).toBe('shared.manual.invalid');
  write(['shared', 'other']);
  expect((await resolveConnection('env:shared', 'fixture')).host).toBe('shared.manual.invalid');
});
it('uses qualified environment selectors for password prompts without capturing pgAdmin requests', () => {
  setSessionPassword('env:shared', 'fixture');
  expect(resolveEnvironment('env:shared', 'fixture')?.password).toBe('fixture');
  const failure = Object.assign(new Error('password rejected'), {code:'28P01'});
  expect(passwordPromptReason('pgadmin:1', failure)).toBeUndefined();
  expect(passwordPromptReason('env:shared', failure)).toBe('rejected');
});
