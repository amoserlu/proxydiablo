# Changelog

All user-facing changes are recorded here. Versions follow semantic versioning;
while the project is pre-1.0, a minor version may include documented compatibility changes.

## [Unreleased]

## [0.2.0] - 2026-11-13

### Added
- Manual PostgreSQL and MySQL/MariaDB environments, with passwords entered in the local UI ([#3](https://github.com/amoserlu/proxydiablo/pull/3), [#5](https://github.com/amoserlu/proxydiablo/pull/5)).
- AWS RDS IAM authentication, including separate signing endpoints for SSH tunnels ([#4](https://github.com/amoserlu/proxydiablo/pull/4)).
- An engine-neutral `sql` CLI alias, per-request column visibility, and optional desktop/sound notifications ([#5](https://github.com/amoserlu/proxydiablo/pull/5)).
- Reviewed error delivery: **Send error + SQL** returns the error and exact SQL as JSON after sensitive-data confirmation. The CLI exits with code 1.
- Versioned GitHub releases, this changelog, and a validated tag-based release workflow.

### Fixed
- A request can execute only once. Completed and failed requests cannot run again or be reset by editing SQL, connection, command, working directory, or classification. The UI and server enforce the same rule.
- Successful output remains available for review and release. Failed commands retain stdout/stderr and exit status for **Send output**. Password entry remains possible when authentication fails before SQL executes.
- Running SQL requests retain their actual outcome when the requesting CLI disconnects.
- Password caches are invalidated when an environment changes; SQL errors mentioning a password column no longer invalidate credentials.
- Qualified profile selectors prevent a manual environment from shadowing a pgAdmin destination.
- MySQL metadata uses prepared statements, including under `NO_BACKSLASH_ESCAPES`.
- PostgreSQL and MySQL IAM connections verify the TLS certificate and signing hostname before sending credentials, including through tunnels.

### Compatibility notes
- Use the `selector` returned by profile discovery: `env:<name>` or `pgadmin:<id>`. Bare names matching manual environments are rejected.
- IAM requires `sslmode: "verify-full"`. Configure `sslrootcert` with the trusted CA bundle when it is not already trusted by the runtime.
- To execute a corrected or repeated query, submit a **new request**. A completed request preserves its original input and output.
- Explicitly released errors now use structured JSON on stdout (exit code 1), rather than plain error text on stderr. Failures before a supervised response still use stderr.

## [0.1.0] - 2026-08-25

Retrospective baseline for commit `adf24f3`; the GitHub release was published on 2026-11-13.

### Added
- Localhost web UI for supervised PostgreSQL queries and shell commands.
- pgAdmin profile discovery and schema introspection.
- Read/write classification, double confirmation for writes, sensitive-column filtering, and explicit output release.
- Multiple request tabs, editable requests before approval, and cancellation with revision feedback.
- Installable Codex skill and installation documentation.

[Unreleased]: https://github.com/amoserlu/proxydiablo/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/amoserlu/proxydiablo/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/amoserlu/proxydiablo/tree/v0.1.0
