# WordPress staging and promotion contract

Owner requirements accepted on 2026-10-23. **Clone/promotion remain backlog.**
Version 0.11.0 implements the fresh-target subset through the separately approved
[WordPress stage workflow](WORDPRESS-STAGE.md); 0.10.0 adds private database exports. Do not present domain creation, an export or a URL replacement as a
completed migration. The owner reports full API key permissions; investigate
provider feature availability/contracts when operations fail, rather than asking
for broader key permissions again.

## Required workflows

| Workflow | Explicit inputs | Required result |
| --- | --- | --- |
| Clone existing live to stage | Source account/installation, destination account, exact owner-supplied stage subdomain | Stage WordPress files including media, copied database, destination-only credentials and correct URLs; live preserved. |
| Create empty stage | Destination account, exact owner-supplied subdomain, fresh WP/admin setup | Subdomain, fresh WordPress and a new dedicated database; no source data copied. The owner confirmed this meaning of “empty.” |
| Promote stage to live | Source stage, destination account and exact live installation/domain | Full source files/media and database moved by copying and verifying; URLs/config point to live. Keep source stage unless separately authorized for deletion. |

Do not derive or create a stage hostname automatically. An example such as
`stg-project.example.com` is illustrative, not authorization to provision it.
Account selection is always explicit; domains alone do not select hosting accounts.

## Mandatory confirmation before every operation

All three workflows require a fresh explicit **user confirmation** before making
hosting changes, including new/empty targets. General requests to support
migrations, previous consent, an operation allowlist, write scope, preview hashes,
automatic agent reasoning or this document do not replace that confirmation.

The review must show source, destination, accounts, exact hostname, detected
destination installation/files/database, table/site/network scope, URL replacement,
planned backup coverage and whether data will be overwritten. Existing stage or
live data requires a prominent explicit overwrite/wipe confirmation for that
specific target. Never silently reuse a nonempty directory/database. Live overwrite
must call out loss of destination-only orders, forms, user/content changes and
other data since the stage snapshot. Full replacement does not merge that data.

Bind approval to an immutable plan, actor, source/target state fingerprints and
expiry. Revalidate before each destructive phase; changed target/source/plan scope
requires another preview and user confirmation. A string/hash echoed by an AI
client does not prove human consent. Before exposing apply, implement and test a
concrete owner-approval receipt mechanism; until then, migration apply is blocked.
The conversational agent must always ask for the specific reviewed operation and
wait for the user's answer. Development authorization does not approve any concrete installation/migration.

## Mandatory retained backups

Before any overwrite or destructive write, create and verify a backup set in a
configured **private backups root outside web roots**, covering:

- The source database and WordPress files/media when cloning/promoting.
- The existing destination database and WordPress files/media, even if the target
  is a previous stage. Preserve relevant prior configuration needed for recovery.
- For a genuinely new target, record verified absence rather than inventing an
  “old data” backup. Existing unexpected files still require backup and confirmation.

**Database backup is mandatory.** If export, archival, capacity reservation,
completion or integrity verification fails, stop before changing the target.
Creation of a file or a metadata listing alone is insufficient verification.
Plan a consistent backup window for active sites; separate live DB/file copies
do not guarantee a coherent snapshot, and WooCommerce/media activity may require
a reviewed maintenance/write-freeze window. Never freeze live automatically.

Migration backups have **no automatic expiry or deletion**. They remain until the
owner explicitly decides to remove each identified backup set. The temporary
one-hour artifacts in `DATABASE-EXPORTS.md` are **not migration backups**. A future
migration operation may reuse the bounded export stream, but must publish to a
separate retained-backup store with its own durable manifest before proceeding.
Exceeding export bounds or storage capacity blocks the operation; never skip backup
to make a migration fit. Remote hosted backups must also be private and verified.

Manifests hold backup IDs, actor/account/source/target identity, roles (source or
preexisting target), timestamps, coverage, file counts/sizes/checksums, consistency
conditions and validation results. Preserve essential secret-bearing configuration
only inside the protected backup, never in model-visible manifests/logs. Retention
is independent of successful migration, failure, cleanup and code deployments.

At completion or failure, report what changed, verification results, each backup
ID/role/coverage/location reference/size and what remains pending. Explicitly tell
the owner that backups were retained and ask whether to keep or remove the listed
sets. No affirmative answer means **keep**. Backup deletion is a separate exact-ID
preview, user confirmation and receipt; it must never be bundled with migration
success or generic temporary-file cleanup. The owner may choose to keep backups.

## Execution and verification boundaries

Use a durable operation state machine, immutable previews, approval receipts and
source/destination account reservations. States must distinguish awaiting approval,
backing up, backup verified, preparing target, copying/importing, URL rewriting,
verification, completed, failed and uncertain outcomes. Persist checkpoint/receipt
before writes; no blind retries after timeout. Cross-account reservations need a
fixed acquisition order to prevent deadlocks. Preserve backup records on failure.

Prefer building in a separate owned temporary directory and a fresh dedicated
database, then switching the target only through an established provider contract.
Do not assume a documented atomic cutover exists. Do not wipe a shared database
or parent domain root for one installation. If isolation or exact scope cannot be
established, block and report the concrete limitation. Define maintenance windows,
the supported source/target platform combinations and recovery before live apply.

Copy WordPress files, themes/plugins and uploads, not only media. Adapt destination
database credentials and URL/network configuration without exposing secrets.
Exclude unrelated directories and backups; validate symlinks, archive member paths,
canonical targets and private root boundaries. Cross-account transfer cannot be
implemented by assuming same-account copy supports another account.

Use fixed serialization-aware `search-replace` operations with a reviewed dry-run,
old/new values and table/site/network selection. Do not use a plain SQL/text replace
on PHP serialized values. Multisite needs network/domain/path/config handling;
one `siteurl` update is insufficient. Establish explicit multisite support before
accepting a network promotion; do not silently treat it as a single site.

Stage policy needs deliberate non-indexing/access protection and isolation of
outgoing email, payments, webhooks and scheduled integrations copied from live.
Do not claim robots.txt/noindex alone protects customer data. Avoid silently
changing provider parent-wide TLS/redirect settings for one stage hostname; D15's
separate parent-wide consent remains required.

Verify destination ownership, file/media coverage, database import/table state,
expected URL replacements and HTTP/application behavior before reporting success.
Keep partial completion and unknown outcomes explicit. Restore/rollback is another
potentially destructive operation requiring its own preview/confirmation; do not
automatically overwrite a live site during recovery.

## API research and next implementation steps

Existing private H57 Swagger documents database create/clone/export/import,
filemanager copy/upload/archive/extract and native WordPress install/config APIs.
These are distinct provider contracts, not implemented MCP operations. The import
route's `clean` flag explicitly clears a database; never enable it by default or
use it before approved scope and verified retained backups. Archive extraction's
overwrite behavior and safe cutover must be verified before use. A visible API
route does not establish that SeoHost exposes the runtime feature.

1. Finish/check the private database export foundation and its provider availability.
2. Establish native installation alternatives and a fixed CLI adapter for plugin,
   user/multisite inventories plus reviewed search-replace; verify actual execute/SSH
   behavior with harmless reads, no generic shell tool.
3. Implement retained backup-set creation/verification, inventory and separately
   approved deletion, with failure tests proving no overwrite can bypass backup.
4. Implement immutable migration planning and owner confirmation/receipt enforcement.
5. Build/test fresh stage and clone workflows, then full live promotion with explicit
   overwrite review, checkpointed failure reporting and post-operation backup report.

No migration, CLI execution, live wipe, database import, backup deletion, account
feature change or deployment was performed while recording this contract.
