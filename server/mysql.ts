import mysql from 'mysql2/promise';
import type { ExecuteValues, FieldPacket } from 'mysql2';
import type { InspectRequest, InspectResult, QueryResult } from '../src/shared/types.js';
import type { ResolvedConnection } from './pgadmin.js';

const SYSTEM_SCHEMAS = "('information_schema', 'mysql', 'performance_schema', 'sys')";

export async function runMysqlQuery(
  conn: ResolvedConnection,
  sql: string,
  params: unknown[],
  readOnly: boolean,
): Promise<QueryResult> {
  const started = Date.now();
  const connection = await mysql.createConnection({
    host: conn.host,
    port: conn.port,
    database: conn.database || undefined,
    user: conn.user,
    password: conn.password,
    ssl: conn.sslmode && conn.sslmode !== 'disable' ? { rejectUnauthorized: false } : undefined,
    connectTimeout: conn.connect_timeout ? Number(conn.connect_timeout) * 1000 : 15000,
    // Reviewed scripts may chain setup statements before the query, as they can with PostgreSQL.
    multipleStatements: params.length === 0,
    // Return values as stored instead of converting them through the local timezone or a JS number.
    dateStrings: true,
    supportBigNumbers: true,
    bigNumberStrings: true,
    // RDS IAM tokens are sent with mysql_clear_password, which is only safe because rds-iam forces SSL.
    enableCleartextPlugin: conn.auth === 'rds-iam',
  });

  // Introspection binds values on the server: text interpolation is unsafe under
  // NO_BACKSLASH_ESCAPES. Reviewed scripts without parameters keep multi-statement support.
  const execute = () => (params.length ? connection.execute(sql, params as ExecuteValues) : connection.query(sql));
  try {
    if (readOnly) {
      // The session setting keeps statements read-only even if something ends the transaction early.
      await connection.query('SET SESSION TRANSACTION READ ONLY');
      await connection.query('START TRANSACTION READ ONLY');
      try {
        const [rows, fields] = await execute();
        await connection.query('COMMIT');
        return normalizeMysqlResult(rows, fields, Date.now() - started);
      } catch (error) {
        await connection.query('ROLLBACK').catch(() => undefined);
        throw error;
      }
    }
    const [rows, fields] = await execute();
    return normalizeMysqlResult(rows, fields, Date.now() - started);
  } finally {
    await connection.end().catch(() => connection.destroy());
  }
}

interface MysqlResultSet {
  rows: unknown;
  fields: FieldPacket[] | undefined;
}

export function normalizeMysqlResult(rows: unknown, fields: unknown, durationMs: number): QueryResult {
  const display = pickDisplayResult(splitResults(rows, fields));
  if (Array.isArray(display.rows)) {
    return {
      columns: (display.fields ?? []).map((field) => ({ name: field.name, dataTypeID: field.columnType })),
      rows: display.rows as Record<string, unknown>[],
      rowCount: display.rows.length,
      command: 'SELECT',
      durationMs,
    };
  }
  const header = (display.rows ?? {}) as { affectedRows?: number };
  return { columns: [], rows: [], rowCount: header.affectedRows ?? 0, command: 'OK', durationMs };
}

/** Multi-statement queries return one entry per statement, with an array (or undefined) per entry in fields. */
function splitResults(rows: unknown, fields: unknown): MysqlResultSet[] {
  const multi = Array.isArray(rows) && Array.isArray(fields) && fields.length > 0 &&
    fields.length === rows.length && fields.every((entry) => entry === undefined || Array.isArray(entry));
  if (!multi) return [{ rows, fields: fields as FieldPacket[] | undefined }];
  return (rows as unknown[]).map((entry, index) => ({ rows: entry, fields: (fields as (FieldPacket[] | undefined)[])[index] }));
}

function pickDisplayResult(results: MysqlResultSet[]): MysqlResultSet {
  return [...results].reverse().find((result) => Array.isArray(result.rows)) ?? results.at(-1) ?? { rows: undefined, fields: [] };
}

/**
 * In MySQL a database is a schema, so tables, views and columns default to the connected database
 * instead of every schema on the server. Pass `schema` to look at another one.
 */
export async function inspectMysqlStructure(connection: ResolvedConnection, request: InspectRequest): Promise<InspectResult> {
  const wantsAll = request.kinds.includes('all');
  const schema = request.schema ?? null;
  const read = (sql: string, params: unknown[] = []) => runMysqlQuery(connection, sql, params, true);
  const result: InspectResult = {
    profile: connection.name || request.profile,
    database: connection.database,
    schema: request.schema,
  };

  if (wantsAll || request.kinds.includes('schemas')) {
    const query = await read(`
      select schema_name as \`schema\`
      from information_schema.schemata
      where schema_name not in ${SYSTEM_SCHEMAS}
      order by schema_name
    `);
    result.schemas = query.rows.map((row) => String(row.schema));
  }
  if (wantsAll || request.kinds.includes('tables')) {
    result.tables = (await read(`
      select table_schema as \`schema\`, table_name as \`name\`, 'table' as \`type\`
      from information_schema.tables
      where table_type in ('BASE TABLE', 'SYSTEM VERSIONED') and table_schema = coalesce(?, database())
      order by table_schema, table_name
    `, [schema])).rows;
  }
  if (wantsAll || request.kinds.includes('views')) {
    result.views = (await read(`
      select table_schema as \`schema\`, table_name as \`name\`, 'view' as \`type\`
      from information_schema.tables
      where table_type = 'VIEW' and table_schema = coalesce(?, database())
      order by table_schema, table_name
    `, [schema])).rows;
  }
  if (request.kinds.includes('columns')) {
    result.columns = (await read(`
      select table_schema as \`schema\`, table_name as \`table\`, column_name as \`column\`,
             ordinal_position as ordinal_position, data_type as data_type, is_nullable as is_nullable
      from information_schema.columns
      where table_schema = coalesce(?, database())
      order by table_schema, table_name, ordinal_position
    `, [schema])).rows.map((row) => ({ ...row, ordinal_position: Number(row.ordinal_position) })); // MariaDB returns a BIGINT string
  }
  return result;
}
