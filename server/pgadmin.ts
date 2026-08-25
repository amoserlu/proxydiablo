import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import type { ProfileSummary } from '../src/shared/types.js';
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
  const data = (await runHelper(['list'])) as { profiles: ProfileSummary[] };
  return data.profiles;
}

export async function resolveConnection(profile: string, database: string): Promise<ResolvedConnection> {
  return (await runHelper(['resolve', profile, database])) as ResolvedConnection;
}
