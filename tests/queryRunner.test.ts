import { describe, expect, it } from 'vitest';
import type pg from 'pg';
import { normalizePgResult } from '../server/queryRunner';

describe('normalizePgResult', () => {
  it('uses the tabular result from multi-statement queries', () => {
    const setup = makeResult('SET', [], [], null);
    const select = makeResult('SELECT', [{ name: 'jobid', dataTypeID: 23 }], [{ jobid: 123 }], 1);

    expect(normalizePgResult([setup, select], 42)).toEqual({
      columns: [{ name: 'jobid', dataTypeID: 23 }],
      rows: [{ jobid: 123 }],
      rowCount: 1,
      command: 'SELECT',
      durationMs: 42,
    });
  });
});

function makeResult(
  command: string,
  fields: { name: string; dataTypeID: number }[],
  rows: Record<string, unknown>[],
  rowCount: number | null,
): pg.QueryResult {
  return {
    command,
    fields: fields as pg.FieldDef[],
    rows,
    rowCount,
    oid: 0,
  };
}
