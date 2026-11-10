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

describe('classifySql for MySQL', () => {
  const mysql = (sql: string) => classifySql(sql, 'mysql');

  it('allows simple reads', () => {
    expect(mysql('select 1;')).toBe('read');
    expect(mysql('show tables')).toBe('read');
    expect(mysql('describe users')).toBe('read');
    expect(mysql('desc users')).toBe('read');
    expect(mysql('explain select * from users')).toBe('read');
    expect(mysql('select /*+ MAX_EXECUTION_TIME(1000) */ id from users')).toBe('read');
    expect(mysql("select * from users where name = 'it\\'s' and note = \"a;b\"")).toBe('read');
    expect(mysql('select `a;b`, `into` from users')).toBe('read');
  });

  it('allows one session setting or USE before one read', () => {
    expect(mysql('SET SESSION max_execution_time = 5000; SELECT 1;')).toBe('read');
    expect(mysql("set @@session.sql_mode = 'ANSI_QUOTES'; select 1")).toBe('read');
    expect(mysql('USE app; SELECT * FROM users;')).toBe('read');
  });

  it('does not treat global, multi-assignment, user-variable or transaction settings as setup', () => {
    expect(mysql('SET GLOBAL max_connections = 1; SELECT 1')).toBe('ambiguous');
    expect(mysql('SET @@global.max_connections = 1; SELECT 1')).toBe('ambiguous');
    expect(mysql('SET max_execution_time = 1, GLOBAL max_connections = 1; SELECT 1')).toBe('ambiguous');
    expect(mysql('SET @x = 1; SELECT @x')).toBe('ambiguous');
    expect(mysql('SET autocommit = 1; SELECT 1')).toBe('ambiguous');
    expect(mysql('SET SESSION transaction_read_only = 0; SELECT 1')).toBe('ambiguous');
    expect(mysql('SET SESSION TRANSACTION READ WRITE; SELECT 1')).toBe('ambiguous');
  });

  it('detects MySQL writes', () => {
    expect(mysql('replace into users values (1)')).toBe('write');
    expect(mysql("load data infile '/tmp/x' into table users")).toBe('write');
    expect(mysql('rename table a to b')).toBe('write');
    expect(mysql('lock tables users read')).toBe('write');
    expect(mysql('optimize table users')).toBe('write');
    expect(mysql("select * from users into outfile '/tmp/users'")).toBe('write');
    expect(mysql("with x as (select 1) select * from x into dumpfile '/tmp/x'")).toBe('write');
    expect(mysql('USE app; DELETE FROM users')).toBe('write');
  });

  it('treats explain analyze and multi statements as ambiguous', () => {
    expect(mysql('EXPLAIN ANALYZE SELECT 1')).toBe('ambiguous');
    expect(mysql('select 1; select 2')).toBe('ambiguous');
  });

  it("lexes '#' comments and only treats '-- ' with whitespace as a comment", () => {
    expect(mysql('# delete from users\nselect 1')).toBe('read');
    expect(mysql('select 1 -- ; delete from users')).toBe('read');
    expect(mysql('select 1--1; delete from users')).toBe('ambiguous');
  });

  it('refuses to classify executable comments as read', () => {
    expect(mysql('select 1 /*! ; drop table users */')).toBe('ambiguous');
    expect(mysql('select 1 /*!50000 , sleep(10) */')).toBe('ambiguous');
    expect(mysql('select 1 /*M! ; drop table users */')).toBe('ambiguous');
  });

  it('is ambiguous when the statement split depends on backslash escapes or ANSI_QUOTES', () => {
    const backslash = "select 'x\\''; drop table users; -- '";
    expect(classifySql(backslash)).toBe('read');
    expect(mysql(backslash)).toBe('ambiguous');
    expect(mysql("select 'x\\'' , \"y\\\" ; drop table users; -- \"")).toBe('ambiguous');
  });

  it('does not use PostgreSQL dollar quoting', () => {
    const dollar = 'select $a$; drop table users; $a$';
    expect(classifySql(dollar)).toBe('read');
    expect(mysql(dollar)).toBe('ambiguous');
  });
});
