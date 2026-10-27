# Fresh production WordPress on an existing domain

`plan_wordpress_install` adds a distinct production workflow in 0.19.0. Use it for
an existing owned domain whose canonical `<home>/domains/<domain>/public_html`
contains only bounded provider start files and an optional exact managed root
redirect. It is not the staging installer and cannot replace an existing website.

Inputs: explicit `serverId`, `domain`, `adminEmail`; optional `adminName` (siteadmin)
and `title` (WordPress). Requires local-account provisioning, local owner login,
write scope and the separate `install_wordpress` account allowlist entry. Stage
permissions do not grant production installation. Upgrades never enable it.

Planning verifies domain ownership, canonical root, new database absence, local
runtime and pinned stable core. It snapshots all allowed file metadata/SHA-256.
Only the provider template allowlist from WORDPRESS-STAGE.md is accepted, plus a
root `.htaccess` consisting entirely of exact API-matched `Redirect 301/302/303 /`
lines to safe HTTP(S) destinations. WordPress, arbitrary files, custom rewrites,
symlinks and special/hardlinked files are refused. No file contents or passwords
are returned. The immutable plan binds root, administrator, new DB/version and
snapshot; the bilingual owner page explicitly distinguishes production and lists
the existing files and redirect removal scope. Thirty-minute expiry applies.

The owner must approve that exact browser preview. Use the existing
`apply_wordpress_stage` and `get_wordpress_stage` tools with the same actor/account/
plan/hash. Naming is retained for compatibility with shared receipts, account locks,
checkpoints and the protected password page; it does not enable staging policies.

Apply revalidates before writes. Existing files and redirect configuration receive
verified private copies and retained relocated originals under
`.seohost-mcp-stage/recovery/<plan>/`; no deletion. It confirms an empty root and
empty provider redirect inventory, creates one new dedicated database, and uses the
same pinned private archive extraction/candidate/final checksums as staging. No
hosting-domain/subdomain POST or existing database is reused. Config mode 600 and
secret stdin remain mandatory. Production sets `WP_ENVIRONMENT_TYPE=production`,
normal indexing/mail/cron and no stage MU plugin or frontend login restriction.
The temporary install deny guard is lifted only after local verification.

Unknown/partial outcomes keep the shared account reservation. No generic retry,
recovery, overwrite, clone, migration or backup deletion is added. D26–D28 recovery
is limited to its original staging checkpoints. Existing subdomain directories or
unrecognized content stop production planning. This trusts the same local hosting
UID; it does not establish hostile-tenant or alias isolation.

Other domains' redirects use separate reviewed `plan_hosting_change` operations.
Finish/verify the destination before redirecting source domains, to avoid loops or
sending visitors to an incomplete target. Preserve source files/databases and back
up source redirect configuration. Source/target public HTTPS and path behavior must
be verified separately; local installation never proves DNS/TLS readiness.

Verification: 147 tests/types/build pass, including production-only policy, actual
owner browser approval, changed-root refusal, existing-WP/custom-rewrite refusal,
verified redirect/template preservation and real child production settings. Live
production installation is pending a concrete owner-approved plan.


Patch 0.19.1 compares safe Redirect destinations using normalized HTTP(S) URLs,
matching the inventory projection. A bare origin with no trailing slash is equivalent
to its canonical `/` URL. Literal root-source/status/directive checks remain strict,
and the full original `.htaccess` metadata/SHA-256 still binds the approved snapshot.
This fixes a read-only live preview refusal; no target changes occurred. The real
child/production tests cover preservation of the original noncanonical spelling.


0.19.1 deployed from `12e4525`, Deploy `40496535288`, Check `40496520123`;
147 tests/types/build and independent HTTPS/SDK discovery/auth checks passed.
A concrete live production plan passed ownership/root/template/redirect/version/DB
absence checks. Owner approval is pending; no live WordPress/redirect mutation has
run. Required H57-only operations have a verified private configuration backup;
original redirect configurations also have retained verified private copies.
