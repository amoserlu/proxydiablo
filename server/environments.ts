import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import type { ProfileSummary } from '../src/shared/types.js';
import { configDirectory } from './paths.js';
import type { ResolvedConnection } from './pgadmin.js';

const execFileAsync = promisify(execFile);

export type EnvironmentAuth = 'password' | 'rds-iam';

export interface EnvironmentEntry {
  name: string;
  host: string;
  port?: number;
  database?: string;
  user: string;
  password?: string;
  passwordEnv?: string;
  sslmode?: string;
  auth?: EnvironmentAuth;
  awsProfile?: string;
  region?: string;
}

export class AwsLoginRequiredError extends Error {
  constructor(readonly environment: string, detail: string) {
    super(`AWS credentials for environment "${environment}" are not usable. ${detail}`);
    this.name = 'AwsLoginRequiredError';
  }
}

export class PasswordRequiredError extends Error {
  constructor(readonly environment: string) {
    super(`A password is required for environment "${environment}". Enter it in the Proxy Diablo UI, or configure passwordEnv, PGPASSWORD or ~/.pgpass.`);
    this.name = 'PasswordRequiredError';
  }
}

const sessionPasswords = new Map<string, string>();

export function environmentsPath(): string {
  return process.env.PROXYDIABLO_ENVIRONMENTS ?? path.join(configDirectory, 'environments.json');
}

export function loadEnvironments(): EnvironmentEntry[] {
  const file = environmentsPath();
  let raw: string;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw new Error(`Cannot read environments file ${file}.`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Environments file ${file} is not valid JSON.`);
  }
  const list = (parsed as { environments?: unknown })?.environments;
  if (!Array.isArray(list)) throw new Error(`Environments file ${file} must contain an "environments" array.`);
  const seen = new Set<string>();
  return list.map((item, index) => {
    const entry = parseEntry(item, index);
    if (seen.has(entry.name)) throw new Error(`Environments file has a duplicate name "${entry.name}".`);
    seen.add(entry.name);
    return entry;
  });
}

function parseEntry(item: unknown, index: number): EnvironmentEntry {
  const record = (item ?? {}) as Record<string, unknown>;
  const where = `environments[${index}]`;
  const text = (key: string, required: boolean): string | undefined => {
    const value = record[key];
    if (value === undefined || value === null || value === '') {
      if (required) throw new Error(`${where}.${key} is required.`);
      return undefined;
    }
    if (typeof value !== 'string') throw new Error(`${where}.${key} must be a string.`);
    return value;
  };
  const port = record.port;
  if (port !== undefined && (typeof port !== 'number' || !Number.isInteger(port) || port < 1 || port > 65535)) {
    throw new Error(`${where}.port must be an integer between 1 and 65535.`);
  }
  const auth = (text('auth', false) ?? 'password') as EnvironmentAuth;
  if (auth !== 'password' && auth !== 'rds-iam') throw new Error(`${where}.auth must be "password" or "rds-iam".`);
  const entry: EnvironmentEntry = {
    name: text('name', true)!,
    host: text('host', true)!,
    port: port as number | undefined,
    database: text('database', false),
    user: text('user', true)!,
    password: text('password', false),
    passwordEnv: text('passwordEnv', false),
    sslmode: text('sslmode', false),
    auth,
    awsProfile: text('awsProfile', false),
    region: text('region', false),
  };
  if (auth === 'rds-iam') {
    if (entry.password || entry.passwordEnv) throw new Error(`${where}: rds-iam environments cannot define a password.`);
    if (!entry.region && !regionFromHost(entry.host)) {
      throw new Error(`${where}.region is required (it could not be derived from the host).`);
    }
  }
  return entry;
}

export function listEnvironmentProfiles(): ProfileSummary[] {
  return loadEnvironments().map((entry, index) => ({
    id: -(index + 1),
    name: entry.name,
    host: entry.host,
    port: entry.port,
    username: entry.user,
    maintenanceDb: entry.database,
  }));
}

export function setSessionPassword(name: string, password: string): void {
  if (!loadEnvironments().some((entry) => entry.name === name)) throw new Error(`Unknown environment "${name}".`);
  if (!password) throw new Error('A password is required.');
  sessionPasswords.set(name, password);
}

export function clearSessionPasswords(): void {
  sessionPasswords.clear();
}

export function isEnvironmentName(name: string): boolean {
  try {
    return loadEnvironments().some((entry) => entry.name === name);
  } catch {
    return false;
  }
}

/** RDS and Aurora hostnames embed their region: <id>.<hash>.<region>.rds.amazonaws.com */
export function regionFromHost(host: string): string | undefined {
  return host.match(/\.([a-z]{2}(?:-[a-z]+)+-\d)\.rds\.amazonaws\.com(?:\.cn)?$/)?.[1];
}

function awsCli(): string {
  return process.env.PROXYDIABLO_AWS_CLI ?? 'aws';
}

/** Follows source_profile links in ~/.aws/config to the profile that owns the SSO session. */
export function ssoLoginProfile(profile: string | undefined): string | undefined {
  if (!profile) return undefined;
  const configFile = process.env.AWS_CONFIG_FILE ?? path.join(os.homedir(), '.aws', 'config');
  let text: string;
  try {
    text = fs.readFileSync(configFile, 'utf8');
  } catch {
    return undefined;
  }
  const sections = new Map<string, Record<string, string>>();
  let current: Record<string, string> | undefined;
  for (const line of text.split(/\r?\n/)) {
    const header = line.match(/^\s*\[(?:profile\s+)?([^\]]+)\]\s*$/);
    if (header) {
      current = {};
      sections.set(header[1].trim(), current);
      continue;
    }
    const pair = line.match(/^\s*([A-Za-z_]+)\s*=\s*(.*?)\s*$/);
    if (pair && current) current[pair[1]] = pair[2];
  }
  let name = profile;
  for (let hops = 0; hops < 5; hops += 1) {
    const section = sections.get(name);
    if (!section) return undefined;
    if (section.sso_session || section.sso_start_url) return name;
    if (!section.source_profile) return undefined;
    name = section.source_profile;
  }
  return undefined;
}

async function mintIamToken(entry: EnvironmentEntry): Promise<string> {
  const region = entry.region ?? regionFromHost(entry.host)!;
  const args = [
    'rds', 'generate-db-auth-token',
    '--hostname', entry.host,
    '--port', String(entry.port ?? 5432),
    '--region', region,
    '--username', entry.user,
    ...(entry.awsProfile ? ['--profile', entry.awsProfile] : []),
  ];
  try {
    const { stdout } = await execFileAsync(awsCli(), args, { timeout: 30_000, maxBuffer: 1024 * 1024 });
    const token = stdout.trim();
    if (!token) throw new Error('empty token');
    return token;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      throw new AwsLoginRequiredError(entry.name, 'The aws CLI was not found; install AWS CLI v2 and make sure it is on PATH.');
    }
    const stderr = String((error as { stderr?: unknown }).stderr ?? '');
    const login = ssoLoginProfile(entry.awsProfile);
    if (/sso|token|expired|credentials|login/i.test(stderr)) {
      const command = login ? `aws sso login --profile ${login}` : 'aws sso login';
      throw new AwsLoginRequiredError(entry.name, `Run \`${command}\` in this shell environment and retry.`);
    }
    throw new AwsLoginRequiredError(entry.name, 'The aws CLI could not generate a database token (check awsProfile, region and permissions).');
  }
}

/** Returns undefined when `profile` is not a manual environment, so the caller can fall back to pgAdmin. */
export async function resolveEnvironment(profile: string, database: string): Promise<ResolvedConnection | undefined> {
  const entries = loadEnvironments();
  const index = entries.findIndex((entry) => entry.name === profile);
  if (index < 0) return undefined;
  const entry = entries[index];
  const iam = entry.auth === 'rds-iam';
  const password = iam
    ? await mintIamToken(entry)
    : sessionPasswords.get(entry.name) ??
      (entry.passwordEnv ? process.env[entry.passwordEnv] : undefined) ??
      entry.password;
  return {
    id: -(index + 1),
    name: entry.name,
    host: entry.host,
    port: entry.port,
    database: database || entry.database || '',
    user: entry.user,
    password,
    sslmode: iam ? entry.sslmode ?? 'require' : entry.sslmode,
  };
}

/** True when a failed connection to an environment without any configured password looks like a missing password. */
export function looksLikeMissingPassword(profile: string, error: unknown): boolean {
  const entry = (() => {
    try {
      return loadEnvironments().find((item) => item.name === profile);
    } catch {
      return undefined;
    }
  })();
  if (!entry || entry.auth === 'rds-iam') return false;
  if (sessionPasswords.has(entry.name) || entry.password || (entry.passwordEnv && process.env[entry.passwordEnv])) return false;
  const message = error instanceof Error ? error.message : String(error);
  return /password/i.test(message);
}

/** Calls onChange whenever the environments file is created, edited or removed (polling survives atomic replaces). */
export function watchEnvironments(onChange: () => void, intervalMs = 1000): () => void {
  const file = environmentsPath();
  const listener = (current: fs.Stats, previous: fs.Stats) => {
    if (current.mtimeMs !== previous.mtimeMs || current.size !== previous.size) onChange();
  };
  fs.watchFile(file, { interval: intervalMs, persistent: false }, listener);
  return () => fs.unwatchFile(file, listener);
}
