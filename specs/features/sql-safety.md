# SQL Safety

## Status
Implemented.

## Goal
Make reads easy and writes intentionally supervised.

## Requirements
- Codex declares every request as `read` or `write`; if uncertain it declares `write`.
- The app independently classifies SQL before execution.
- Initial safe session-setting statements such as `SET statement_timeout = '5s';` may precede one read query and still classify as read-only.
- Read-only SQL executes in a read-only transaction where possible.
- Structure inspection always uses read-only catalog queries.
- SQL declared as write, detected as write, or detected as ambiguous requires two user confirmations before it can run.
- Closing a warning returns to the request without executing it; explicit Cancel ends the request.
- Codex may submit write SQL only when the user explicitly requested a write operation.
- Write results are never released as unfiltered raw data.
- Codex never receives output until the user explicitly confirms the sensitive-data warning and releases filtered output.

## MySQL
- Environments with `engine: "mysql"` are classified with MySQL lexing: `#` comments, `--` comments only when followed by whitespace, backtick identifiers, backslash escapes in quoted strings, and no dollar quoting.
- Statement splitting is evaluated under every combination of backslash escapes and `ANSI_QUOTES`; if they disagree the SQL is ambiguous, because the server's `sql_mode` decides which one applies.
- Executable comments (`/*! ... */`, `/*M! ... */`) make SQL ambiguous.
- Any `INTO` outside strings is a write (`INTO OUTFILE`/`DUMPFILE` writes server files and is not blocked by a read-only transaction).
- Setup statements before one read are limited to `USE <db>` and a single session `SET` assignment; `GLOBAL`/`PERSIST`, comma lists, user variables, `autocommit`, `sql_log_bin` and `transaction_*`/`tx_*` variables are not setup.
- MySQL-only writes: `REPLACE`, `LOAD`, `RENAME`, `LOCK`/`UNLOCK`, `OPTIMIZE`, `REPAIR`, `ANALYZE`, `FLUSH`, `KILL`, `PURGE`, `INSTALL`/`UNINSTALL`, `IMPORT`. `DESC`/`DESCRIBE` are reads.
- Reads run after `SET SESSION TRANSACTION READ ONLY` inside `START TRANSACTION READ ONLY`, so writes stay blocked even after an implicit or explicit commit.
- The engine is re-read from the environment at approval time and the SQL re-classified before confirmations are checked.

## Acceptance
- `select 1;` runs without write warnings.
- `SET statement_timeout = '5s'; WITH x AS (SELECT 1) SELECT * FROM x;` runs without write warnings.
- `update table set x = 1;` displays two warnings before execution.
- Rejecting either warning prevents execution and notifies the waiting CLI as cancelled.
- On a MySQL environment, `select $a$; drop table users; $a$` and `select 1 /*! ; drop table users */` are ambiguous and need two confirmations.
