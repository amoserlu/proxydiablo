import type { SqlClassification } from './types.js';

const WRITE_KEYWORDS = new Set([
  'alter',
  'call',
  'comment',
  'copy',
  'create',
  'delete',
  'discard',
  'do',
  'drop',
  'grant',
  'insert',
  'merge',
  'reindex',
  'refresh',
  'reset',
  'revoke',
  'select_into',
  'truncate',
  'update',
  'vacuum',
]);

const READ_KEYWORDS = new Set(['select', 'show', 'values', 'with', 'explain']);

export function classifySql(sql: string): SqlClassification {
  const cleaned = stripCommentsAndStrings(sql).trim();
  if (!cleaned) return 'ambiguous';

  const statements = splitStatements(cleaned);
  if (!statements.length) return 'ambiguous';

  const effectiveStatements = trimReadOnlySetupStatements(statements);
  if (effectiveStatements.length !== 1) return 'ambiguous';

  const normalized = normalizeStatement(effectiveStatements[0]);
  if (!normalized) return 'ambiguous';

  if (/^select\s+.*\s+into\s+/is.test(normalized)) return 'write';
  if (/^explain\s+(analyze|analyse)\b/is.test(normalized)) return 'ambiguous';

  const first = normalized.match(/^[a-z_]+/)?.[0];
  if (!first) return 'ambiguous';
  if (WRITE_KEYWORDS.has(first)) return 'write';
  if (READ_KEYWORDS.has(first)) return 'read';
  return 'ambiguous';
}

export function isWriteLike(classification: SqlClassification): boolean {
  return classification !== 'read';
}

function stripCommentsAndStrings(sql: string): string {
  let out = '';
  let i = 0;
  while (i < sql.length) {
    const ch = sql[i];
    const next = sql[i + 1];
    if (ch === '-' && next === '-') {
      while (i < sql.length && sql[i] !== '\n') i += 1;
      out += ' ';
      continue;
    }
    if (ch === '/' && next === '*') {
      i += 2;
      while (i < sql.length && !(sql[i] === '*' && sql[i + 1] === '/')) i += 1;
      i += 2;
      out += ' ';
      continue;
    }
    if (ch === "'") {
      out += "''";
      i += 1;
      while (i < sql.length) {
        if (sql[i] === "'" && sql[i + 1] === "'") {
          i += 2;
          continue;
        }
        if (sql[i] === "'") {
          i += 1;
          break;
        }
        i += 1;
      }
      continue;
    }
    if (ch === '$') {
      const tag = sql.slice(i).match(/^\$[a-zA-Z_][a-zA-Z0-9_]*\$|^\$\$/)?.[0];
      if (tag) {
        out += tag;
        i += tag.length;
        const end = sql.indexOf(tag, i);
        i = end === -1 ? sql.length : end + tag.length;
        continue;
      }
    }
    out += ch;
    i += 1;
  }
  return out;
}

function splitStatements(sql: string): string[] {
  return sql
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);
}

function trimReadOnlySetupStatements(statements: string[]): string[] {
  const remaining = [...statements];
  while (remaining.length > 1 && isReadOnlySetupStatement(normalizeStatement(remaining[0]))) {
    remaining.shift();
  }
  return remaining;
}

function isReadOnlySetupStatement(statement: string): boolean {
  if (!statement.startsWith('set ')) return false;
  if (/^set\s+(role|session\s+authorization|transaction)\b/i.test(statement)) return false;
  return /^set\s+(local\s+|session\s+)?[a-z_][a-z0-9_.]*\s*(=|to)\s+/i.test(statement);
}

function normalizeStatement(statement: string): string {
  return statement.replace(/\s+/g, ' ').trim().toLowerCase();
}
