# Implementation Summary

## Status
Proxy Diablo is a local, human-supervised web proxy for PostgreSQL and shell commands.

## Runtime and entrypoints
- Node HTTP service + Vite/React/TypeScript UI at `http://localhost:17871/`, bound only to loopback.
- Per-process token in `~/.config/proxydiablo/bridge.json`; operational logs contain no submitted payloads or captured output.
- `proxydiablo ui`
- `proxydiablo pgsql profiles`
- `proxydiablo pgsql inspect "<profile>" "<database>" --schemas|--tables|--views|--columns|--all [--schema <schema>]`
- `proxydiablo pgsql submit "<profile>" "<database>" --classification read|write --description "..." --sql "..."`
- `proxydiablo command --classification read|write --description "..." --command "..." [--cwd "..."]`

## Safety model
- Every executable request declares `read` or `write` and explains what it does. Uncertain actions are declared `write`.
- Reads require one Run action. Declared writes, detected PostgreSQL writes, and ambiguous SQL require two confirmations.
- Command execution happens in the blocking CLI process with its current environment and working directory. stdout/stderr are captured silently and never logged or returned before human release.
- PostgreSQL row output keeps automatic column filtering. Command output has no automatic filtering.
- Every output release shows a sensitive-data warning and requires explicit confirmation.
- Cancel with explanation returns structured feedback so the caller can reformulate the request without ending the conversation.

## UI and validation
- Mixed PostgreSQL/command tabs, independent statuses, editable payloads, resizable editors, scrollable PostgreSQL grid, JSON tree/text command output, and separate stderr.
- `npm run typecheck`, `npm test`, and `npm run build` validate the implementation.
