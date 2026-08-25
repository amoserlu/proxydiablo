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

## Acceptance
- `select 1;` runs without write warnings.
- `SET statement_timeout = '5s'; WITH x AS (SELECT 1) SELECT * FROM x;` runs without write warnings.
- `update table set x = 1;` displays two warnings before execution.
- Rejecting either warning prevents execution and notifies the waiting CLI as cancelled.
