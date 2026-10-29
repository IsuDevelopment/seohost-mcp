# Temporary files and retained state

Version 0.20.0 removes disposable deployment/install artifacts after successful
verification. This policy does not delete website backups or installation passwords.

## Deployments

The workflow still transfers to `~/.seohost-mcp-deploy/<run>-<attempt>/`. A private
filesystem lock also serializes manual deploy invocations. After restart, expected
HTTPS version, unauthenticated rejection and configured MCP smoke checks pass:

1. Write the successful release marker in the app directory.
2. Copy/checksum-verify the previous-code rollback archive to
   `<app>/.mcp-rollback/rollback.tar.gz` with private permissions. Keep one such
   archive plus release metadata, replacing it only after another verified success.
3. Validate all numeric transfer directories, then delete those temporary trees.
   Unknown folders, especially historical configuration backups, are not selected.
4. Release the lock and remove the transfer parent only if empty.

The cleanup refuses symlinks/special files, foreign ownership, hardlinked files,
private-state filenames and oversized inventories. Paths and release identity are
fixed/bounded; no generic cleanup endpoint exists. Previous-code archives exclude
env, account config, SQLite state and the hosting-managed dependencies.

Failed restart/verification restores code and retains transfer/rollback evidence.
Cleanup is outside the rollback trap: a housekeeping failure reports failure but
never rolls a healthy app back. A stale filesystem lock needs operator investigation;
never clear one without establishing that no deployment is still running. This
trusts the same local UID and is not hostile-tenant filesystem isolation.

## WordPress installation

Only after all local install/checksum checks succeed, remove that job's private
`core-repair/<id>/source.tar.gz` and `extracted/` temporary copies. Keep manifest,
truncated originals/directories, provider template backups and credential files.
An unsafe/failed cleanup is deferred and reported by `temporaryArtifactsRemoved=false`;
it must not turn a completed website installation into an uncertain operation.
`coreManifestReference` identifies retained evidence; `coreArchiveReference` is null
when its disposable archive was removed. Unknown/failed installation evidence is
not automatically swept, and no public cleanup tool is added.

Existing verified completed jobs and an old fixed WP-CLI core cache may be cleaned
by an audited operator action after checking receipts and account reservations.
No runtime credential, OAuth/SQLite state, website file or retained original is a
cache. Small website/redirect backups stay until separately authorized for deletion.

## One-time historical cleanup

The owner authorized removal of obsolete artifacts on 2026-10-29. Inspect current
runtime paths, live release, reservations, ownership/types and sizes before deleting
old deploy trees or superseded MCP config/reset backups. Never infer that a hidden
folder is disposable from its name alone. Report actual removed size/count and any
retained runtime/backup directories; preserve private data outside Git and web roots.


Verified on 2026-10-29: 0.20.0 deployed from `a09b4d0`, Deploy `40840433809`,
Check `40840382646`; 150 tests/types/build passed. The live deployment pruned its
own transfer and 19 historical releases, retaining one private 163,267-byte code
archive without runtime state. The audited historical cleanup removed four stale
config/reset trees and completed-job core copies/cache (7,571 files). Combined disk
reclaimed was roughly 365 MB. Stage runtime/originals (~4.9 MiB), redirect backups
(16 KiB), credentials, all sites/databases and Redis remain. MCP discovery/auth,
production HTTP, both source 301s and protected staging checks passed afterward.
