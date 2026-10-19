import fs from 'node:fs';
import path from 'node:path';
import type { ProfileSummary } from '../src/shared/types.js';
import { configDirectory } from './paths.js';
import type { ResolvedConnection } from './pgadmin.js';

export interface EnvironmentEntry {
  name: string;
  host: string;
  port?: number;
  database?: string;
  user: string;
  password?: string;
  passwordEnv?: string;
  sslmode?: string;
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
  return {
    name: text('name', true)!,
    host: text('host', true)!,
    port: port as number | undefined,
    database: text('database', false),
    user: text('user', true)!,
    password: text('password', false),
    passwordEnv: text('passwordEnv', false),
    sslmode: text('sslmode', false),
  };
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

/** Returns undefined when `profile` is not a manual environment, so the caller can fall back to pgAdmin. */
export function resolveEnvironment(profile: string, database: string): ResolvedConnection | undefined {
  const entries = loadEnvironments();
  const index = entries.findIndex((entry) => entry.name === profile);
  if (index < 0) return undefined;
  const entry = entries[index];
  const password =
    sessionPasswords.get(entry.name) ??
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
    sslmode: entry.sslmode,
  };
}

/**
 * Decides whether a failed connection should send the human back to the password prompt:
 * 'missing' when no password was configured, 'rejected' when the one typed in the UI was wrong
 * (that session password is forgotten so it can be typed again). Configured passwords are left alone.
 */
export function passwordPromptReason(profile: string, error: unknown): 'missing' | 'rejected' | undefined {
  const entry = (() => {
    try {
      return loadEnvironments().find((item) => item.name === profile);
    } catch {
      return undefined;
    }
  })();
  if (!entry) return undefined;
  const message = error instanceof Error ? error.message : String(error);
  const code = (error as { code?: unknown })?.code;
  if (code !== '28P01' && !/password/i.test(message)) return undefined;
  if (sessionPasswords.has(entry.name)) {
    sessionPasswords.delete(entry.name);
    return 'rejected';
  }
  if (entry.password || (entry.passwordEnv && process.env[entry.passwordEnv])) return undefined;
  return 'missing';
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
