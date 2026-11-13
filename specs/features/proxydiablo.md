# Proxy Diablo

## Goal
Provide one local, supervised web interface through which Codex can propose PostgreSQL, MySQL or shell actions without receiving credentials or output before the human approves it.

## Request model
- A request has a proxy type (`pgsql` or `command`), exact payload, human-readable description, and declared classification (`read` or `write`).
- A SQL request also identifies the pgAdmin profile or manual environment and the database; the environment's `engine` selects PostgreSQL or MySQL. The server independently classifies SQL and applies write safeguards if either classification is unsafe or ambiguous.
- A command request executes only in its waiting CLI process, preserving that process's environment and chosen working directory.

## Human controls
- Read: one Run action. Write/ambiguous: two confirmations.
- Cancel ends the request without returning output.
- Cancel with explanation stops the request and returns the explanation as `revision_requested`.
- Send output always asks the human to confirm there is no sensitive data.
- Header toggles, off by default and remembered per browser, announce each new agent request with a chime and/or a browser notification; requests already open when the page loads are not announced.
- Send error message, enabled only after a request fails, returns the error as an `error` response after the same sensitive-data confirmation; error text is never filtered.

## Output isolation
- Command stdout/stderr are captured silently with bounded buffers. They are not written to terminal or server logs and remain visible only in the local UI until release.
- Valid JSON stdout is rendered as a collapsible tree; other stdout and stderr use separate console views with exit, signal, duration, and truncation metadata.
- SQL output is filtered before release. Command output is never automatically filtered.
