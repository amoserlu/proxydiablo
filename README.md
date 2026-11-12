<p align="center">
  <img src="public/app-icon.png" alt="Proxy Diablo" width="112" height="112">
</p>

# Proxy Diablo

Proxy Diablo is a localhost-only, human-in-the-loop proxy for PostgreSQL, MySQL/MariaDB and shell commands. An AI agent can propose an exact action, but a person must review and approve execution in the browser before any result is released.

## Safety model

- The service binds only to `127.0.0.1` and uses per-process authentication.
- Every action includes a description and a `read` or `write` classification.
- Reads require one approval; writes and ambiguous SQL require two.
- Command output is captured silently and never written to service logs.
- SQL results support automatic sensitive-column filtering.
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

## Manual environments

Besides pgAdmin profiles, Proxy Diablo reads PostgreSQL and MySQL environments from a JSON file. The default location is `~/.config/proxydiablo/environments.json`; set `PROXYDIABLO_ENVIRONMENTS` to use another path.

```json
{
  "environments": [
    {
      "name": "staging",
      "host": "db.staging.example.com",
      "port": 5432,
      "database": "app",
      "user": "readonly",
      "passwordEnv": "STAGING_DB_PASSWORD",
      "sslmode": "require"
    }
  ]
}
```

`name`, `host` and `user` are required; `engine` is `postgresql` (default) or `mysql`, `port` defaults to 5432 or 3306 by engine, and `database` is the default when a request omits one. Environments appear in `proxydiablo pgsql profiles` and the UI profile list, ahead of pgAdmin profiles, and pgAdmin is optional when at least one environment exists.

Password resolution order: a password typed in the UI for this session, the variable named by `passwordEnv`, the `password` field, then the standard `PGPASSWORD` / `~/.pgpass` lookup. If the server rejects the connection for lack of a password, the tab asks for one in the UI. It is kept in memory only and never written to disk. Prefer `passwordEnv` or the UI prompt over `password`.

### MySQL and MariaDB

Set `engine` to `mysql` for MySQL 8+ or MariaDB servers; everything else (password prompt, `passwordEnv`, `sslmode`, `rds-iam`) works the same. The `pgsql` CLI commands and the `sql` alias serve both engines; the environment decides which driver runs.

```json
{
  "name": "shop-staging",
  "engine": "mysql",
  "host": "mysql.staging.example.com",
  "database": "shop",
  "user": "readonly",
  "passwordEnv": "SHOP_DB_PASSWORD"
}
```

- Reads run with `SET SESSION TRANSACTION READ ONLY` and `START TRANSACTION READ ONLY`, so DML and DDL fail even if a script commits midway.
- SQL is classified with MySQL lexing (`#` and `-- ` comments, backticks, backslash escapes). Executable comments (`/*! */`, `/*M! */`), splits that depend on `NO_BACKSLASH_ESCAPES`/`ANSI_QUOTES`, `INTO OUTFILE`/`DUMPFILE`, and `SET GLOBAL` are never treated as reads.
- `inspect` treats the database as the schema: tables, views and columns default to the connected database; `--schema` selects another one and `--schemas` lists the databases the user can see.
- Dates are returned as stored (no timezone conversion) and `BIGINT`/`DECIMAL` values as strings, like PostgreSQL `int8`/`numeric`.
- `PGPASSWORD` and `~/.pgpass` do not apply; use `passwordEnv` or the UI prompt.

### AWS IAM database authentication

For RDS/Aurora databases (PostgreSQL or MySQL) that use IAM auth, set `auth` to `rds-iam` and name the AWS CLI profile. No password is stored anywhere: a fresh token is generated for every connection with `aws rds generate-db-auth-token` and SSL defaults to `require`.

```json
{
  "name": "cec-prod",
  "host": "cec-prod.cryqwkvystyi.eu-west-2.rds.amazonaws.com",
  "database": "cec",
  "user": "my.name@example.com",
  "auth": "rds-iam",
  "awsProfile": "cec_developer"
}
```

`region` is derived from `iamHost` (when present) or `host`, and is required when it cannot be derived. For a tunnel, keep `host`/`port` as the local transport address and set `iamHost`/`iamPort` to the real RDS endpoint and database port. For example, use `host: "localhost", port: 15432, iamHost: "db.abc.eu-west-2.rds.amazonaws.com", iamPort: 5432`. When `iamHost` is set, `iamPort` defaults to the engine's port (5432 for PostgreSQL, 3306 for MySQL); otherwise it defaults to the connection port. The token must be signed for the real database endpoint, never the local tunnel address.

Role chains (`role_arn`, `source_profile`, `external_id`) and SSO sessions are handled by the AWS CLI through the profile. When the session has expired the error names the profile to log in with, for example `aws sso login --profile aircury_cec_developer`. Requires AWS CLI v2 (`PROXYDIABLO_AWS_CLI` overrides the executable).

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

Profile discovery returns an origin-qualified `selector`: use `env:<name>` for a manual environment or `pgadmin:<id>` for a pgAdmin profile. The UI uses these selectors automatically. Bare names matching a manual environment are rejected so they cannot silently shadow a pgAdmin destination. Selectors for manual environments remain stable when the file is reordered; a removed environment never falls back to pgAdmin.
