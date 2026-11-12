import { beforeEach, expect, it, vi } from 'vitest';
import mysql from 'mysql2/promise';
import { runMysqlQuery } from '../server/mysql';
vi.mock('mysql2/promise', () => ({ default: { createConnection: vi.fn() } }));
const connection = { query: vi.fn(), execute: vi.fn(), end: vi.fn(), destroy: vi.fn() };
const config = { id: -1, host: 'fixture.invalid', name: 'fixture', user: 'fixture', database: 'fixture', engine: 'mysql' as const };
beforeEach(() => {
  vi.clearAllMocks();
  connection.query.mockResolvedValue([[], []]);
  connection.execute.mockResolvedValue([[], []]);
  connection.end.mockResolvedValue(undefined);
  vi.mocked(mysql.createConnection).mockResolvedValue(connection as never);
});
it('binds introspection parameters with prepared statements and disables statement chaining', async () => {
  const hostile = "x', NULL); SELECT secret FROM fixture_private #";
  await runMysqlQuery(config, 'SELECT ? AS schema_name', [hostile], true);
  expect(mysql.createConnection).toHaveBeenCalledWith(expect.objectContaining({ multipleStatements: false }));
  expect(connection.execute).toHaveBeenCalledWith('SELECT ? AS schema_name', [hostile]);
  expect(connection.query.mock.calls.map(call => call[0])).toEqual([
    'SET SESSION TRANSACTION READ ONLY', 'START TRANSACTION READ ONLY', 'COMMIT',
  ]);
});
it('keeps explicitly reviewed scripts on the query path', async () => {
  await runMysqlQuery(config, 'SET max_execution_time=1000; SELECT 1', [], true);
  expect(mysql.createConnection).toHaveBeenCalledWith(expect.objectContaining({ multipleStatements: true }));
  expect(connection.query).toHaveBeenCalledWith('SET max_execution_time=1000; SELECT 1');
  expect(connection.execute).not.toHaveBeenCalled();
});
it('rolls back and closes a failed prepared query', async () => {
  connection.execute.mockRejectedValueOnce(new Error('fixture failure'));
  await expect(runMysqlQuery(config, 'SELECT ?', ['fixture'], true)).rejects.toThrow('fixture failure');
  expect(connection.query).toHaveBeenCalledWith('ROLLBACK');
  expect(connection.end).toHaveBeenCalled();
});
