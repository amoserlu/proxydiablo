# Maintaining releases

`CHANGELOG.md` is the source for GitHub release notes. Add user-facing changes
under `Unreleased` in each change, grouped as Added, Changed, Fixed, or Removed.
Include PR links and migration instructions when behavior or configuration changes.
Do not list unshipped features or claim validation that has not been performed.

To publish a version from the reviewed default branch:

1. Choose a semantic version. Use patch for compatible fixes and minor for new
   features; document compatibility changes explicitly during the pre-1.0 period.
2. Run `npm version 0.2.2 --no-git-tag-version` (replace the example version).
   Move the pending changelog entries to `## [0.2.2] - YYYY-MM-DD`, leave an empty
   `Unreleased` section, and update comparison links at the bottom.
3. Run `node scripts/release-notes.mjs v0.2.2` to check package/lockfile/tag
   consistency and inspect the exact public notes. Run `npm run typecheck`,
   `npm test`, and `npm run build` before committing the release preparation.
4. Merge/push the reviewed release commit to `main`, then tag that exact commit:
   `git tag -a v0.2.2 -m 'Proxy Diablo v0.2.2'` and `git push origin v0.2.2`.
5. The Release workflow validates the tag, runs the tests (including an isolated
   MySQL service), builds the app, and publishes the matching changelog entry.
   Verify the workflow and GitHub release before announcing it.

Never move a published tag or reuse a version for different code. If validation
fails, fix the problem and use a new version. The workflow publishes source
releases; it does not publish npm packages, APT packages, or bundled binaries.
GitHub provides source archives for every release tag.

The initial v0.1.0 release was added retrospectively at its original source
commit. Its changelog date describes that source baseline, not its publication date.

The v0.1.1, v0.1.2, and v0.1.3 tags are retrospective milestones for PRs #3,
#4, and #5. They point to the original merge commits, whose package files still
say 0.1.0. These archival patch numbers fill the historical sequence without
renumbering published versions; they do not imply fix-only changes. They were
published manually with `--latest=false`, before the automated release workflow
existed at those commits. New releases must follow the version matching and
semantic versioning rules above.
