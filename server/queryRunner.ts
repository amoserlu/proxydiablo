import pg from 'pg';
import type { QueryResult } from '../src/shared/types.js';
import type { ResolvedConnection } from './pgadmin.js';

export async function runQuery(conn: ResolvedConnection, sql: string, readOnly: boolean): Promise<QueryResult> {
  return runQueryWithParams(conn, sql, [], readOnly);
}

export async function runReadOnlyQuery(
  conn: ResolvedConnection,
  sql: string,
  params: unknown[] = [],
): Promise<QueryResult> {
  return runQueryWithParams(conn, sql, params, true);
}

async function runQueryWithParams(
  conn: ResolvedConnection,
  sql: string,
  params: unknown[],
  readOnly: boolean,
): Promise<QueryResult> {
  const client = new pg.Client({
    host: conn.host,
    port: conn.port,
    database: conn.database,
    user: conn.user,
    password: conn.password,
    ssl: conn.sslmode && conn.sslmode !== 'disable' ? { rejectUnauthorized: false } : undefined,
    connectionTimeoutMillis: conn.connect_timeout ? Number(conn.connect_timeout) * 1000 : 15000,
  });

  const started = Date.now();
  await client.connect();
  try {
    if (readOnly) {
      await client.query('BEGIN READ ONLY');
      try {
        const result = await client.query(sql, params);
        await client.query('COMMIT');
        return normalizePgResult(result, Date.now() - started);
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw error;
      }
    }
    const result = await client.query(sql, params);
    return normalizePgResult(result, Date.now() - started);
  } finally {
    await client.end().catch(() => undefined);
  }
}

export function normalizePgResult(result: pg.QueryResult | pg.QueryResult[], durationMs: number): QueryResult {
  const normalized = Array.isArray(result) ? pickDisplayResult(result) : result;
  return {
    columns: (normalized.fields ?? []).map((field) => ({ name: field.name, dataTypeID: field.dataTypeID })),
    rows: (normalized.rows ?? []) as Record<string, unknown>[],
    rowCount: normalized.rowCount ?? normalized.rows?.length ?? 0,
    command: normalized.command,
    durationMs,
  };
}

function pickDisplayResult(results: pg.QueryResult[]): pg.QueryResult {
  return (
    [...results].reverse().find((result) => result.fields?.length || result.rows?.length) ??
    results.at(-1) ?? {
      command: 'EMPTY',
      rowCount: 0,
      oid: 0,
      fields: [],
      rows: [],
    }
  );
}
