import type { DatabaseEngine, SqlClassification } from './types.js';

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

const MYSQL_WRITE_KEYWORDS = new Set([
  'analyze',
  'flush',
  'import',
  'install',
  'kill',
  'load',
  'lock',
  'optimize',
  'purge',
  'rename',
  'repair',
  'replace',
  'uninstall',
  'unlock',
]);

const MYSQL_READ_KEYWORDS = new Set(['desc', 'describe']);

/** Session variables a read must not change: they could take later statements out of the read-only transaction. */
const MYSQL_PROTECTED_VARIABLES = /^(autocommit|completion_type|sql_log_bin|transaction_[a-z_]*|tx_[a-z_]*)$/;

export function classifySql(sql: string, engine: DatabaseEngine = 'postgresql'): SqlClassification {
  if (engine !== 'mysql') return classifyStatements(stripCommentsAndStrings(sql), 'postgresql');

  // How MySQL splits statements depends on the session sql_mode (NO_BACKSLASH_ESCAPES, ANSI_QUOTES),
  // which can differ per server or be changed by the script itself. Lex under every combination and
  // only trust a classification they all agree on.
  const results = new Set<SqlClassification>();
  for (const singleQuoteBackslash of [true, false]) {
    for (const doubleQuoteBackslash of [true, false]) {
      const lexed = stripMysqlCommentsAndStrings(sql, singleQuoteBackslash, doubleQuoteBackslash);
      if (lexed.executableComment) return 'ambiguous';
      results.add(classifyStatements(lexed.text, 'mysql'));
    }
  }
  return results.size === 1 ? [...results][0] : 'ambiguous';
}

function classifyStatements(stripped: string, engine: DatabaseEngine): SqlClassification {
  const cleaned = stripped.trim();
  if (!cleaned) return 'ambiguous';

  const statements = splitStatements(cleaned);
  if (!statements.length) return 'ambiguous';

  const effectiveStatements = trimReadOnlySetupStatements(statements, engine);
  if (effectiveStatements.length !== 1) return 'ambiguous';

  const normalized = normalizeStatement(effectiveStatements[0]);
  if (!normalized) return 'ambiguous';

  if (/^select\s+.*\s+into\s+/is.test(normalized)) return 'write';
  if (/^explain\s+(analyze|analyse)\b/is.test(normalized)) return 'ambiguous';
  if (engine === 'mysql') {
    // INTO OUTFILE/DUMPFILE writes server files and is not stopped by a read-only transaction,
    // and it can follow a WITH or TABLE statement, so any INTO outside strings counts as a write.
    if (/\binto\b/.test(normalized)) return 'write';
    if (/^(explain|describe|desc)\b.*\banaly[sz]e\b/.test(normalized)) return 'ambiguous';
  }

  const first = normalized.match(/^[a-z_]+/)?.[0];
  if (!first) return 'ambiguous';
  if (WRITE_KEYWORDS.has(first) || (engine === 'mysql' && MYSQL_WRITE_KEYWORDS.has(first))) return 'write';
  if (READ_KEYWORDS.has(first) || (engine === 'mysql' && MYSQL_READ_KEYWORDS.has(first))) return 'read';
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

/**
 * MySQL lexing: '#' comments, '-- ' comments only when followed by whitespace, backtick identifiers,
 * no dollar quoting, and optional backslash escapes inside quoted strings. Executable comments
 * (MySQL '/*!', MariaDB '/*M!') run their contents, so they are reported instead of stripped.
 */
function stripMysqlCommentsAndStrings(
  sql: string,
  singleQuoteBackslash: boolean,
  doubleQuoteBackslash: boolean,
): { text: string; executableComment: boolean } {
  let out = '';
  let executableComment = false;
  let i = 0;
  while (i < sql.length) {
    const ch = sql[i];
    const next = sql[i + 1];
    const dashComment = ch === '-' && next === '-' && (i + 2 >= sql.length || /[\s\x00-\x1f]/.test(sql[i + 2]));
    if (ch === '#' || dashComment) {
      while (i < sql.length && sql[i] !== '\n') i += 1;
      out += ' ';
      continue;
    }
    if (ch === '/' && next === '*') {
      if (sql[i + 2] === '!' || (sql[i + 2] === 'M' && sql[i + 3] === '!')) executableComment = true;
      i += 2;
      while (i < sql.length && !(sql[i] === '*' && sql[i + 1] === '/')) i += 1;
      i += 2;
      out += ' ';
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      const backslash = ch === "'" ? singleQuoteBackslash : ch === '"' ? doubleQuoteBackslash : false;
      out += ch + ch;
      i += 1;
      while (i < sql.length) {
        if (backslash && sql[i] === '\\') {
          i += 2;
          continue;
        }
        if (sql[i] === ch && sql[i + 1] === ch) {
          i += 2;
          continue;
        }
        if (sql[i] === ch) {
          i += 1;
          break;
        }
        i += 1;
      }
      continue;
    }
    out += ch;
    i += 1;
  }
  return { text: out, executableComment };
}

function splitStatements(sql: string): string[] {
  return sql
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);
}

function trimReadOnlySetupStatements(statements: string[], engine: DatabaseEngine): string[] {
  const remaining = [...statements];
  while (remaining.length > 1 && isReadOnlySetupStatement(normalizeStatement(remaining[0]), engine)) {
    remaining.shift();
  }
  return remaining;
}

function isReadOnlySetupStatement(statement: string, engine: DatabaseEngine): boolean {
  if (engine === 'mysql') return isMysqlReadOnlySetupStatement(statement);
  if (!statement.startsWith('set ')) return false;
  if (/^set\s+(role|session\s+authorization|transaction)\b/i.test(statement)) return false;
  return /^set\s+(local\s+|session\s+)?[a-z_][a-z0-9_.]*\s*(=|to)\s+/i.test(statement);
}

/** One session-scoped assignment (no GLOBAL/PERSIST, no comma lists, no user variables) or a USE. */
function isMysqlReadOnlySetupStatement(statement: string): boolean {
  if (/^use\s+\S+$/.test(statement)) return true;
  const match = statement.match(/^set\s+(?:session\s+|local\s+|@@session\.|@@local\.|@@)?([a-z_][a-z0-9_]*)\s*:?=\s*[^,]*$/);
  return Boolean(match) && !MYSQL_PROTECTED_VARIABLES.test(match![1]);
}

function normalizeStatement(statement: string): string {
  return statement.replace(/\s+/g, ' ').trim().toLowerCase();
}
