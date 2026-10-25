# WordPress staging and promotion

## Objective

Cover owner-supplied stage creation, live-to-stage clones and stage-to-live full
promotion, with fresh user confirmation for every operation and retained verified
database/files backups before overwrite. Contract: [WORDPRESS-MIGRATIONS.md](../../docs/WORDPRESS-MIGRATIONS.md).

## Accepted context

- Empty stage = owner-supplied exact subdomain + fresh WP + new dedicated DB.
- Existing target stage/live data requires an explicit wipe/overwrite confirmation.
- Database backup is mandatory; keep source and old destination backup sets until
  the owner decides whether to delete them after the operation. No automatic TTL.
- Owner reports full key permissions. Diagnose hosting feature availability before
  suggesting permission changes. Native H57 WordPress remains historically OFF.
- CLI requests: per-installation/site plugin list, multisite sites, user list,
  serialization-aware migration search-replace with dry-run and explicit scope.

## Completed foundation

Candidate 0.10.0 implements whole owned database gzip exports with private temporary
storage, actor-authenticated downloads and local checksum-verifying download helper.
Local verification: `npm run check` passes (93/93 tests, types/build); changed
Markdown links and diff whitespace pass. These one-hour artifacts are not retained
migration backups. D22 adds only owner-confirmed fresh-stage tools and fixed installation CLI steps.
Clone/promotion and general CLI tools remain unavailable. Version 0.10.0 was deployed on 2026-10-23 (see STATUS); no live
migration, database export/import or backup deletion was performed.

## Remaining work / next step

Verify real provider availability for export and harmless typed CLI reads; research
installation/cutover alternatives if native WordPress is unavailable. Then implement
retained backup sets, owner approval enforcement and checkpointed workflow plans
before any target mutation. Follow the ordered steps and limits in the contract.
Do not infer confirmation of a real migration from this development discussion.
