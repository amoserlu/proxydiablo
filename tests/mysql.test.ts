import { describe, expect, it } from 'vitest';
import { normalizeMysqlResult } from '../server/mysql';

const idField = { name: 'id', columnType: 8 };

describe('normalizeMysqlResult', () => {
  it('maps a result set', () => {
    expect(normalizeMysqlResult([{ id: '1' }], [idField], 7)).toEqual({
      columns: [{ name: 'id', dataTypeID: 8 }],
      rows: [{ id: '1' }],
      rowCount: 1,
      command: 'SELECT',
      durationMs: 7,
    });
  });

  it('keeps the columns of an empty result set', () => {
    expect(normalizeMysqlResult([], [idField], 1)).toMatchObject({ columns: [{ name: 'id' }], rows: [], rowCount: 0 });
  });

  it('reports affected rows for statements without a result set', () => {
    expect(normalizeMysqlResult({ affectedRows: 3, insertId: 0 }, undefined, 1)).toMatchObject({
      columns: [],
      rows: [],
      rowCount: 3,
      command: 'OK',
    });
  });

  it('uses the last result set of a multi-statement query', () => {
    const header = { affectedRows: 0, insertId: 0 };
    expect(normalizeMysqlResult([header, [{ id: '2' }], header], [undefined, [idField], undefined], 1)).toMatchObject({
      rows: [{ id: '2' }],
      rowCount: 1,
      command: 'SELECT',
    });
    expect(normalizeMysqlResult([header, { affectedRows: 4 }], [undefined, undefined], 1)).toMatchObject({ rowCount: 4 });
  });
});
