import { describe, expect, it } from 'vitest';
import { classifySql } from '../src/shared/sqlClassifier';

describe('classifySql', () => {
  it('allows simple reads', () => {
    expect(classifySql('select 1;')).toBe('read');
    expect(classifySql('with x as (select 1) select * from x')).toBe('read');
    expect(classifySql('show search_path')).toBe('read');
  });

  it('allows safe setup statements before one read', () => {
    expect(classifySql("set statement_timeout = '5s'; select 1;")).toBe('read');
    expect(classifySql("SET statement_timeout = '5s'; WITH x AS (SELECT 1) SELECT * FROM x;")).toBe('read');
    expect(classifySql('set local lock_timeout to 1000; show search_path;')).toBe('read');
  });

  it('detects writes', () => {
    expect(classifySql('update users set name = 1')).toBe('write');
    expect(classifySql('delete from users')).toBe('write');
    expect(classifySql('create table x(id int)')).toBe('write');
    expect(classifySql('select * into temp x from y')).toBe('write');
    expect(classifySql("set statement_timeout = '5s'; update users set name = 1")).toBe('write');
  });

  it('treats multi statements and explain analyze as ambiguous', () => {
    expect(classifySql('select 1; select 2;')).toBe('ambiguous');
    expect(classifySql('explain analyze select 1')).toBe('ambiguous');
    expect(classifySql('set role admin; select 1')).toBe('ambiguous');
  });

  it('ignores comments and strings for first token detection', () => {
    expect(classifySql("-- update no\nselect 'delete from x';")).toBe('read');
  });
});
