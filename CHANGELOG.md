# Changelog

All user-facing changes are recorded here. Versions follow semantic versioning;
while the project is pre-1.0, a minor version may include documented compatibility changes.

## [Unreleased]

## [0.2.1] - 2026-11-13

### Fixed
- Initialize the release test configuration directory inside a runner step. GitHub rejected the initial workflow because the runner context is unavailable in job-level environment declarations.
- No application behavior changes from v0.2.0. The v0.2.0 source passed local validation and was published manually; this patch validates automatic publication.

## [0.2.0] - 2026-11-13

### Added
- Reviewed error delivery: **Send error + SQL** returns the error and exact SQL as JSON after sensitive-data confirmation. The CLI exits with code 1.
- Versioned GitHub releases, this changelog, and a validated tag-based release workflow.

### Fixed
- A request can execute only once. Completed and failed requests cannot run again or be reset by editing SQL, connection, command, working directory, or classification. The UI and server enforce the same rule.
- Successful output remains available for review and release. Failed commands retain stdout/stderr and exit status for **Send output**. Password entry remains possible when authentication fails before SQL executes.

### Compatibility notes
- To execute a corrected or repeated query, submit a **new request**. A completed request preserves its original input and output.
- Explicitly released errors now use structured JSON on stdout (exit code 1), rather than plain error text on stderr. Failures before a supervised response still use stderr.

## [0.1.3] - 2026-11-13

Retrospective milestone for [PR #5](https://github.com/amoserlu/proxydiablo/pull/5), at merge commit `defcdc16767cb7bd9f61a2bfbce62b432781fff0`. Includes v0.1.2.

### Added
- MySQL/MariaDB manual environments and the engine-neutral `sql` CLI alias.
- Per-request column visibility controls and optional desktop/sound notifications.
- **Send error** delivers a failed request's error after explicit sensitive-data confirmation.

### Fixed
- MySQL metadata uses prepared statements, including under `NO_BACKSLASH_ESCAPES`.
- MySQL IAM connections verify the TLS certificate and signing hostname before sending credentials, including through tunnels.

### Historical scope
- Errors at this milestone return plain error text; structured error + SQL reports and the execution-once rule arrive in v0.2.0.
- The source still declares package version 0.1.0. This historical tag identifies the exact merged code; use the latest release for current fixes.

## [0.1.2] - 2026-11-13

Retrospective milestone for [PR #4](https://github.com/amoserlu/proxydiablo/pull/4), at merge commit `2db425d23392ad7582c4d9ae6a52710677cab0dd`. Includes v0.1.1.

### Added
- AWS RDS IAM authentication for PostgreSQL environments using the AWS CLI.
- Separate `iamHost` and `iamPort` signing endpoints for connections through SSH tunnels.

### Fixed
- PostgreSQL IAM connections verify the TLS certificate and signing hostname before sending credentials.
- PostgreSQL connections honor `verify-ca` and `verify-full` TLS modes.

### Compatibility notes
- IAM requires `sslmode: "verify-full"`. Configure `sslrootcert` with the trusted CA bundle when it is not already trusted by the runtime.
- The source still declares package version 0.1.0. This historical tag identifies the exact merged code; use the latest release for current fixes.

## [0.1.1] - 2026-11-13

Retrospective milestone for [PR #3](https://github.com/amoserlu/proxydiablo/pull/3), at merge commit `88cbb5c2fd3bd78c2c089177aa16c8258d6db3b1`. Includes v0.1.0.

### Added
- Manual PostgreSQL environments configured in JSON, alongside pgAdmin profiles.
- Local UI password entry and session password caching.

### Fixed
- Running SQL requests retain their actual outcome when the requesting CLI disconnects.
- Password caches are invalidated when an environment changes; SQL errors mentioning a password column no longer invalidate credentials.
- Qualified profile selectors prevent a manual environment from shadowing a pgAdmin destination.

### Compatibility notes
- Use the `selector` returned by profile discovery: `env:<name>` or `pgadmin:<id>`. Bare names matching manual environments are rejected.
- The source still declares package version 0.1.0. This historical tag identifies the exact merged code; use the latest release for current fixes.

## [0.1.0] - 2026-08-25

Retrospective baseline for commit `adf24f3`; the GitHub release was published on 2026-11-13.

### Added
- Localhost web UI for supervised PostgreSQL queries and shell commands.
- pgAdmin profile discovery and schema introspection.
- Read/write classification, double confirmation for writes, sensitive-column filtering, and explicit output release.
- Multiple request tabs, editable requests before approval, and cancellation with revision feedback.
- Installable Codex skill and installation documentation.

[Unreleased]: https://github.com/amoserlu/proxydiablo/compare/v0.2.1...HEAD
[0.2.1]: https://github.com/amoserlu/proxydiablo/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/amoserlu/proxydiablo/compare/v0.1.3...v0.2.0
[0.1.3]: https://github.com/amoserlu/proxydiablo/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/amoserlu/proxydiablo/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/amoserlu/proxydiablo/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/amoserlu/proxydiablo/tree/v0.1.0
