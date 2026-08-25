# Filtering

## Status
Implemented.

## Goal
Prevent Codex from seeing sensitive PostgreSQL column values while letting the user view and tune filters locally.

## Requirements
- Filters apply only to PostgreSQL and are global across all profiles and databases.
- Filters support exact column names and glob wildcards with `*` and `?`, case-insensitive.
- Filter rules are persisted in `~/.config/proxydiablo/filters.json`; existing legacy rules are imported once when the new file does not exist.
- Defaults include common sensitive patterns: password, passwd, token, secret, email, mail, phone, telefono, tlf, user, usuario, username, name, nombre, address, direccion, dob, birth, dni, nif, id_number.
- Filtered non-null values are replaced with `[column_name]`.
- Filtered columns are visually highlighted with a distinct color in headers and cells.
- Each result column has a quickfilter action that adds an exact global rule for that column.
- Quickfilter toggles an exact global rule for that column, so accidental filters can be undone quickly.
- Each result column has a per-tab exception action that stops filtering that column only in the current tab/session.
- Per-tab exceptions do not modify global filter rules.
- The filter manager can add, edit, enable, disable, and delete rules.
- Changing filters reapplies them immediately to already executed results.
- Changing per-tab exceptions reapplies filters immediately to the already executed result.
- `Send output` always releases the latest filtered result after a sensitive-data confirmation.
- The local user may view unfiltered output inside the app; Codex must only receive filtered output.
- Command output has no automatic filtering and is outside this feature.

## Acceptance
- A result with `email` shows `[email]` in filtered output and a highlighted column.
- Disabling the `email` rule reapplies the existing result without rerunning SQL.
- Codex release always uses the currently filtered output.
- Re-filtering after execution changes the releasable output without rerunning SQL.
- Exempting `name` in one tab reveals `name` in that tab while `name` remains filtered in other tabs.
