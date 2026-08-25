# Structure Inspection

## Status
Implemented.

## Goal
Allow Codex to inspect database structure without human approval because structure metadata is not table row data.

## Commands
```bash
proxydiablo pgsql profiles
proxydiablo pgsql inspect "<profile>" "<database>" --schemas
proxydiablo pgsql inspect "<profile>" "<database>" --tables --schema public
proxydiablo pgsql inspect "<profile>" "<database>" --views --schema public
proxydiablo pgsql inspect "<profile>" "<database>" --columns --schema public
proxydiablo pgsql inspect "<profile>" "<database>" --all
```

## Requirements
- Profile listing MUST include id, name, host/service, port, username, and maintenance database.
- Profile listing MUST NOT include passwords or decrypted secrets.
- Inspection MUST resolve credentials inside the app/bridge process, not in Codex.
- Inspection MUST query only catalog or `information_schema` metadata.
- Inspection MUST run in a read-only transaction.
- Inspection MUST support schemas, tables, views, columns, and all structure.
- Inspection MUST support optional `--schema` filtering.
- Inspection MUST not open a query tab or require human approval.
- Inspection MUST not steal focus.

## Acceptance
- `proxydiablo pgsql profiles` returns JSON profile metadata.
- `proxydiablo pgsql inspect "<profile>" "<db>" --schemas` returns non-system schemas.
- `proxydiablo pgsql inspect "<profile>" "<db>" --tables --schema public` returns tables only for `public`.
- `proxydiablo pgsql inspect "<profile>" "<db>" --columns --schema public` returns column metadata only, not row values.
