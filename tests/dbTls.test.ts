import { expect, it } from 'vitest';
import { databaseTls } from '../server/dbTls';
it('requires certificate and hostname verification by default for IAM', () => {
  expect(databaseTls({auth:'rds-iam',host:'db.fixture.invalid'})).toMatchObject({rejectUnauthorized:true,verifyIdentity:true});
});
it.each(['disable','allow','prefer','require','verify-ca'])('rejects IAM sslmode=%s before opening a connection', sslmode => {
  expect(() => databaseTls({auth:'rds-iam',sslmode})).toThrow('requires sslmode=verify-full');
});
it('preserves explicit non-IAM modes and rejects unknown modes', () => {
  expect(databaseTls({sslmode:'disable'})).toBe(false);
  expect(databaseTls({sslmode:'require'})).toMatchObject({rejectUnauthorized:false});
  expect(databaseTls({sslmode:'verify-ca'})).toMatchObject({rejectUnauthorized:true,verifyIdentity:false});
  expect(databaseTls({sslmode:'verify-full'})).toMatchObject({rejectUnauthorized:true,verifyIdentity:true});
  expect(() => databaseTls({sslmode:'typo'})).toThrow('Unsupported');
});
