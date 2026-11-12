import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import type { DatabaseEngine, ProfileSummary } from '../src/shared/types.js';
import { listEnvironmentProfiles, resolveEnvironment } from './environments.js';
import { projectDir } from './paths.js';

const execFileAsync = promisify(execFile);

export interface ResolvedConnection {
  id: number;
  name: string;
  host?: string;
  port?: number;
  database: string;
  user?: string;
  password?: string;
  sslmode?: string;
  connect_timeout?: string;
  service?: string;
  /** Absent for pgAdmin profiles, which are always PostgreSQL. */
  engine?: DatabaseEngine;
  auth?: 'password' | 'rds-iam';
}

function pgadminPython(): string {
  return process.env.PROXYDIABLO_PGADMIN_PYTHON ?? '/mnt/c/Program Files/pgAdmin 4/python/python.exe';
}

async function runHelper(args: string[]): Promise<unknown> {
  const helper = path.join(projectDir, 'helpers', 'resolve_pgadmin_profile.py');
  const { stdout } = await execFileAsync(pgadminPython(), [helper, ...args], {
    windowsHide: true,
    maxBuffer: 1024 * 1024 * 10,
  });
  return JSON.parse(stdout);
}

export async function listProfiles(): Promise<ProfileSummary[]> {
  const environments = listEnvironmentProfiles();
  try {
    const data = (await runHelper(['list'])) as { profiles: ProfileSummary[] };
    return [...environments, ...data.profiles.map(profile => ({ ...profile, selector: `pgadmin:${profile.id}`, engine: 'postgresql' as const }))];
  } catch (error) {
    // pgAdmin is optional once manual environments exist.
    if (environments.length) return environments;
    throw error;
  }
}

export async function resolveConnection(profile: string, database: string): Promise<ResolvedConnection> {
  if (profile.startsWith('pgadmin:')) {
    const id = profile.slice(8);
    if (!/^[1-9][0-9]*$/.test(id)) throw new Error('Use a pgadmin:<id> selector from the profile list.');
    return (await runHelper(['resolve', id, database])) as ResolvedConnection;
  }
  const environment = await resolveEnvironment(profile, database);
  if (environment) {
    if (!profile.startsWith('env:')) throw new Error('Ambiguous profile source. Use the env:<name> or pgadmin:<id> selector from the profile list.');
    return environment;
  }
  if (profile.startsWith('env:')) throw new Error('The selected environment no longer exists. Refresh the profile list.');
  return (await runHelper(['resolve', profile, database])) as ResolvedConnection;
}
