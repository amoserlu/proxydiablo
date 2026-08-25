<p align="center">
  <img src="public/app-icon.png" alt="Proxy Diablo" width="112" height="112">
</p>

# Proxy Diablo

Proxy Diablo is a localhost-only, human-in-the-loop proxy for PostgreSQL and shell commands. An AI agent can propose an exact action, but a person must review and approve execution in the browser before any result is released.

## Safety model

- The service binds only to `127.0.0.1` and uses per-process authentication.
- Every action includes a description and a `read` or `write` classification.
- Reads require one approval; writes and ambiguous SQL require two.
- Command output is captured silently and never written to service logs.
- PostgreSQL results support automatic sensitive-column filtering.
- Results are returned only after an explicit sensitive-data confirmation.
- **Cancel with explanation** lets the reviewer request a safer or narrower revision.

## Requirements

- Node.js 20.19 or newer (or Node.js 22.12+)
- Linux or WSL
- Optional: pgAdmin 4 on Windows for PostgreSQL profile integration

## Install

```bash
git clone https://github.com/amoserlu/proxydiablo.git
cd proxydiablo
npm ci
npm run build

mkdir -p ~/.local/bin
ln -sf "$PWD/bin/proxydiablo" ~/.local/bin/proxydiablo
ln -sf "$PWD/bin/proxydiablo-ui" ~/.local/bin/proxydiablo-ui
```

Ensure `~/.local/bin` is in `PATH`, then open the UI:

```bash
proxydiablo ui
```

The app is served at [http://localhost:17871](http://localhost:17871).

## Install the Codex skill

The included skill teaches Codex how to use Proxy Diablo without exposing credentials or unreleased output. Install the application first, then ask Codex:

```text
$skill-installer install the proxydiablo skill from https://github.com/amoserlu/proxydiablo/tree/main/.agents/skills/proxydiablo
```

Alternatively, after cloning the repository, install it manually for the current user:

```bash
mkdir -p ~/.agents/skills
ln -sfn "$PWD/.agents/skills/proxydiablo" ~/.agents/skills/proxydiablo
```

Codex detects the skill automatically. If it does not appear in `/skills`, restart Codex. Invoke it explicitly with `$proxydiablo` or let Codex select it when a task requires supervised PostgreSQL or local command execution.

## Usage

Run a supervised local command:

```bash
proxydiablo command \
  --classification read \
  --description "Generate a small local JSON response without changing state." \
  --command "node -e 'process.stdout.write(JSON.stringify({ok:true}))'" \
  --cwd "$PWD"
```

List and inspect pgAdmin profiles without exposing saved passwords:

```bash
proxydiablo pgsql profiles
proxydiablo pgsql inspect "<profile>" "<database>" --tables --schema public
```

Submit SQL for supervised execution:

```bash
proxydiablo pgsql submit "<profile>" "<database>" \
  --classification read \
  --description "Return the latest ten order statuses." \
  --sql "SELECT id, status FROM public.orders ORDER BY created_at DESC LIMIT 10;"
```

The pgAdmin helper defaults to the standard Windows pgAdmin installation. Override it when necessary with `PROXYDIABLO_PGADMIN_PYTHON` and `PROXYDIABLO_PGADMIN_DB`.

## Development

```bash
npm run typecheck
npm test
npm run build
```

Implementation details and safety contracts are documented in [`specs/`](specs/).

## License

[MIT](LICENSE)
