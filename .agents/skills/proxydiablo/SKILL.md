---
name: proxydiablo
description: "Use when Codex must run PostgreSQL through pgAdmin profiles or execute a local shell command through the Proxy Diablo web UI with human approval, silent output capture, sensitive-data release confirmation, and revision feedback."
---

# Proxy Diablo

Use Proxy Diablo for supervised PostgreSQL data access and local command execution. Keep credentials and unreleased output outside the Codex tool transcript.

## Choose the proxy type first

Before composing a request, choose exactly one type:

- Use `pgsql` for pgAdmin profile discovery, PostgreSQL structure inspection, and SQL execution.
- Use `command` for local programs, HTTP/API calls, cloud CLIs, and other shell operations.

Do not route a shell command through the PostgreSQL proxy or bypass Proxy Diablo with direct PostgreSQL access.

## Classify and describe every executable request

Before submission:

1. Classify the exact SQL or command as `read` or `write`.
2. Use `read` only when it does not change database rows, files, remote resources, configuration, sessions, or other state.
3. Use `write` for any state change. If behavior is difficult to determine or conditional, use `write`.
4. Provide a concise description of what will run, what it reads or changes, and the intended output.

A read requires one human Run action. A declared write requires two. PostgreSQL is also parsed independently; detected writes and ambiguous SQL require two confirmations even if declared `read`.

## Commands

Open the local UI:

```bash
proxydiablo ui
```

PostgreSQL metadata may be read directly because it contains structure, not row values:

```bash
proxydiablo pgsql profiles
proxydiablo pgsql inspect "<pgadmin profile>" "<database>" --schemas
proxydiablo pgsql inspect "<pgadmin profile>" "<database>" --tables --schema public
proxydiablo pgsql inspect "<pgadmin profile>" "<database>" --views --schema public
proxydiablo pgsql inspect "<pgadmin profile>" "<database>" --columns --schema public
proxydiablo pgsql inspect "<pgadmin profile>" "<database>" --all
```

Submit SQL and wait for human action:

```bash
proxydiablo pgsql submit "<pgadmin profile>" "<database>" \
  --classification read \
  --description "Read the latest ten orders and return their status." \
  --sql "select id, status from public.orders order by created_at desc limit 10;"
```

Submit a local command and wait for human action:

```bash
proxydiablo command \
  --classification read \
  --description "Call the local Xero endpoint and return a narrowed JSON response." \
  --command "curl --silent --show-error http://localhost:3000/xero | jq '{status, items}'" \
  --cwd "/absolute/project/path"
```

If `proxydiablo` is not in `PATH`, use the repository launcher at `<proxydiablo-repository>/bin/proxydiablo` or install it as documented in the project README.

## Protect secrets and unreleased output

- Never place a secret value in SQL, a command string, a description, or CLI arguments. Reference an existing environment variable, credential store, profile, or authenticated session without expanding the secret in Codex's shell command.
- Never add tracing, verbose flags, debug output, `tee`, or redirections that could expose stdout/stderr before release.
- Command execution occurs in the blocking CLI process with its environment and selected working directory. stdout and stderr are captured silently and shown only in the localhost UI.
- Do not try to obtain command output through process inspection, temporary files, service logs, terminal capture, or a second invocation.
- Narrow command output proactively when practical, for example with `jq`, because command output has no automatic filtering.
- PostgreSQL row output is filtered by the local app. Treat filtered placeholders as final and never reconstruct them.
- Use only output returned by the blocking command after the human presses `Send output` and confirms that it contains no sensitive data.

If released output appears to contain a password, token, private key, session cookie, personal data, or another secret, immediately warn the user. Do not quote or repeat the sensitive value, do not continue analyzing it beyond what is needed to identify the risk, and recommend revocation or rotation when it may be an active credential.

## Handle the human response

The blocking command returns one of these outcomes:

- `released`: use only the released result. For PostgreSQL, mention any `filteredColumns`. For commands, interpret JSON when `outputKind` is `json`; otherwise use stdout/stderr and exit metadata.
- `revision_requested`: follow the explanation, reformulate only what is needed, reclassify the new request, and submit it again in the same conversation. Do not require the user to restate the task.
- `cancelled`: stop and do not resubmit.
- `error`: explain the failure without seeking hidden output or bypassing the proxy.

Never interpret `revision_requested` as permission to broaden scope. If the feedback requires a new material choice, ask the user.

## PostgreSQL boundaries

- Never ask for, print, store, infer, or expose PostgreSQL passwords.
- Inspect only profiles and structures needed for the request; do not explore unrelated databases or schemas.
- A read may begin with safe session settings before one `SELECT`, `WITH`, `SHOW`, `VALUES`, or non-analyze `EXPLAIN` statement.
- Submit write SQL only for a user-requested write operation.
