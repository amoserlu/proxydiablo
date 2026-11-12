import mysql from 'mysql2/promise';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inspectMysqlStructure } from '../server/mysql';
// Opt-in fixture only: docker MySQL bound to loopback, no production credentials.
const port = Number(process.env.PROXYDIABLO_TEST_MYSQL_PORT);
const database = `proxy_review_${process.pid}`;
const config = { host: '127.0.0.1', port, user: 'root', password: 'review-fixture-only' };
const conn = { ...config, id: -1, name: 'fixture', database, engine: 'mysql' as const };
let admin: mysql.Connection;
describe.skipIf(!port)('MySQL metadata under NO_BACKSLASH_ESCAPES', () => {
  beforeAll(async () => {
    admin = await mysql.createConnection(config);
    const [rows] = await admin.query('SELECT @@sql_mode AS mode');
    expect((rows as {mode: string}[])[0].mode).toContain('NO_BACKSLASH_ESCAPES');
    await admin.query(`CREATE DATABASE \`${database}\``);
    await admin.query(`CREATE TABLE \`${database}\`.fixture_private (secret varchar(100))`);
    await admin.execute(`INSERT INTO \`${database}\`.fixture_private VALUES (?)`, ['SYNTHETIC_PRIVATE_ROW']);
  });
  afterAll(async () => {
    if (!admin) return;
    await admin.query(`DROP DATABASE IF EXISTS \`${database}\``);
    await admin.end();
  });
  it.each(['tables', 'views', 'columns'] as const)('does not execute SQL supplied as a %s schema', async kind => {
    const schema = `x', NULL); SELECT secret AS table_schema, secret AS table_name FROM ${database}.fixture_private #`;
    const result = await inspectMysqlStructure(conn, { profile: 'fixture', database, kinds: [kind], schema });
    expect(result[kind]).toEqual([]);
    expect(JSON.stringify(result)).not.toContain('SYNTHETIC_PRIVATE_ROW');
  });
  it('still inspects ordinary schema and column names', async () => {
    const result = await inspectMysqlStructure(conn, { profile: 'fixture', database, kinds: ['tables', 'columns'], schema: database });
    expect(result.tables).toEqual([expect.objectContaining({ name: 'fixture_private' })]);
    expect(result.columns).toEqual([expect.objectContaining({ column: 'secret' })]);
  });
});
