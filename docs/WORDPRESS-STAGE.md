# Fresh WordPress stage

A **fresh single-site** workflow provisions a new protected WordPress installation. Cloning, promotion, imports,
multisite, existing-target replacement and backup deletion remain unavailable.
This implements only the fresh-target part of [migration requirements](WORDPRESS-MIGRATIONS.md).

## Normal fresh installation (0.18.0)

One exact owner approval now covers hosting creation, preservation of provider-created
start files, a dedicated database and verified WordPress installation. The target
hostname/container must be absent at plan and apply. After a confirmed create, only
index.html, 400/401/403/404/500/503.shtml, cgi-bin and cgi-bin/.htaccess are eligible:
256 KiB/file, 2 MiB total, account-owned regular files/directories, no links. Save
SHA-256-verified private copies and retain relocated originals under the job reference
before requiring an empty root. Unexpected files stop before database creation.
Existing plans without this explicit preservation policy retain the empty-root rule.

The normal installer streams the exact pinned WordPress.org tar.gz into private
storage (HTTPS, no redirects, 64 MiB/180 seconds), verifies its official MD5, validates
safe archive paths/types and extracts with system tar. Candidate official WP checksums
must pass before exclusive target writes; final tree equality and WP checksums must
pass before config/install. This avoids H57's observed WP-CLI long-name truncation.
In 0.20.0, archive/candidate copies are removed only after verified success;
the manifest remains private in `.seohost-mcp-stage/core-repair/<job>/`;
provider template backups remain in `.seohost-mcp-stage/recovery/<job>/`. No deletion.
The same validators still support the narrowly gated legacy recovery below.

Creation POSTs allow 60 seconds and are never retried. Unknown results retain the
account lock; a later inventory observation alone does not prove why a POST failed.
`get_wordpress_stage.result.detail` gives a safe failure explanation without raw
provider bodies, child output or passwords. Keep a stdio process alive throughout
background apply, poll about every 10 seconds, and stop on applied/unknown/failed.
Public DNS/TLS/HTTP checks remain separate from successful local installation.

The release history below describes the behavior at each earlier version; this
section defines the current normal flow. Verification uses local fixtures, including
real tar/child processes; the new flow has not been run against another live target.

## Tools and approval

| Tool | Inputs | Effect |
| --- | --- | --- |
| `plan_wordpress_stage` | Explicit `serverId`, owned parent `domain`, exact `label`, `adminEmail`; optional `placement` (independent_domain), `adminName` (stageadmin), `title` | Validates absence, local runtime/account and canonical root; pins a stable WordPress version and chooses a new database. Returns an immutable 30-minute plan and owner confirmation link. No target writes. |
| `plan_wordpress_stage_recovery` | Explicit `serverId`, original `fromPlanId` | Reconciles an approved unknown independent-domain creation and captures exact provider-template metadata/hashes. Returns a new 30-minute owner review; original reservation remains held. |
| `continue_wordpress_stage_install` | Same `serverId`, approved recovery `planId`/`previewHash` | Verify retained backups and an existing empty DB, then perform only the remaining install under the same job/receipt/reservation. No creation POST. |
| `apply_wordpress_stage` | Same actor/account, `planId`, `previewHash` | Requires a separate owner browser approval. Reserves the shared account lock, starts a background worker and returns immediately. |
| `get_wordpress_stage` | Same actor/account and `planId` | Reports persistent phase/result, including partial and unknown outcomes. No automatic retry, deletion or reconciliation; only D26 separately reviewed recovery below. Write authorization is required; disabled provisioning does not prevent receipt inspection. |

All five tools require write authorization. Plans/apply additionally require `create_wordpress_stage` plus the hosting operation
for the reviewed placement: `create_domain` for the default independent domain,
`create_subdomain` for explicit nested subdomain placement.
A preview hash, the agent's assertion of approval or a write token cannot create
an owner approval receipt. The operator must open the returned `/wordpress-stage/<id>`
link, log in with the existing **MCP owner** credentials, inspect the exact preview
(including the private document root), and approve it. Do not automate this login.
The conversational agent also asks for the reviewed operation and waits for the
owner's response before applying. This page does not execute hosting writes.

The page uses bounded form bodies, same-origin POSTs, HttpOnly/SameSite cookies,
single-use cookie-bound challenges, persistent login throttling and a separate
receipt tied to plan/hash/actor/account. Anonymous requests never display the
plan's hostname, email, database or path. Approval expires with the plan; deny
revokes an earlier approval while the plan is still ready. No approval MCP tool
exists. Only local-owner authentication is currently supported for this page.

## Explicit installation configuration

After deploying compatible code, merge this optional account field into private
configuration and restart **only this MCP application**:

```json
{
  "wordpressProvisioning": {
    "home": "/home/your-account",
    "phpBinary": "/opt/alt/php83/usr/bin/php",
    "wpCli": "/usr/local/bin/wp"
  },
  "writeOperations": ["create_domain", "create_wordpress_stage"]
}
```

Preserve existing write operations; the example is not a replacement account file.
Back up private configuration outside web roots before changing it. On code rollback
to an older strict schema, restore compatible configuration; preserve operation
state/locks and retained credentials. Local OAuth owner login must be configured.
No dependency or SSH key is added. PHP/WP-CLI paths are operator configuration,
never MCP arguments. Validate these paths on each installation.

This first adapter runs only on the same hosting account as the MCP process.
The configured home must equal its canonical OS home, the provider hostname must
equal the OS hostname, and the Login Key username must match the OS user. Remote
accounts, including another server with the same username, are refused. It does
not SSH from H57 to other accounts or execute arbitrary provider commands.

## Fresh-target boundaries

Before planning and again before mutation, verify parent domain ownership, absence
of the requested hostname in domain/subdomain inventories, absence of the exact
new directory and absence of the newly chosen database. The documented DirectAdmin
`CMD_API_DOMAIN?action=document_root` map must confirm the default parent root.
New plans default to a separate domain container at
`<home>/domains/<hostname>/public_html`; explicit `placement=subdomain` uses the
legacy direct child of the parent root. Every existing directory component must
be canonical, owned and non-symlink. No caller root override exists.
Even an existing **empty** target directory is refused. No existing target means
there is no old-target database/files backup to create; this absence is recorded.
No source data is copied. Existing data requires a different, unimplemented workflow.

Create one separate domain (or explicit legacy subdomain) through the fixed legacy
API, re-read its actual document root
and require that exact empty local directory. If provider templates populate it or
its mapping differs, stop and report partial completion. Never silently remove a
provider placeholder, reuse a nonempty directory or redirect the parent root.
Create a separate new database/user through the fixed modern endpoint, localhost
access only, and verify identity and zero tables. No DB delete/reuse/repair is exposed.

WP-CLI runs without a shell, with fixed operations, an isolated CLI configuration,
no inherited app/token environment and no third-party CLI packages. Download the
**pinned stable** core from WordPress.org with TLS verification and verify checksums;
never use `--force`, `--insecure`, nightly, caller URLs, eval or arbitrary commands.
Passwords use stdin prompts, never process arguments, MCP results or raw diagnostics.
A temporary web deny rule protects installation; success replaces it with directory
listing protection. Server support for Apache-compatible `.htaccess` is required.
Only the fresh downloaded installation is bootstrapped; this is not a sandbox for
hostile same-UID site code or concurrent external filesystem changes.

The fresh stage uses HTTPS URLs, disables indexing and WP cron, blocks outbound WP
mail, disables the file editor and requires login for frontend pages via an owned
MU plugin. No email is sent containing credentials. These controls do not disable
all possible server-level outbound network activity. No live integrations are copied.
No parent-wide certificate, HTTPS redirect or external DNS settings are changed.

## Persistence, credentials and recovery

Shared `data/changes.sqlite` reserves the account against concurrent hosting writes.
The background worker checkpoints before each mutation: subdomain, empty-root
verification, database, core download/checksums, configuration, stage policy,
installation and local verification. HTTP disconnects never restart the job.
A process interruption leaves the `applying` reservation for operator investigation.
Failure after provider writes is `unknown`; preserve the lock and inspect the
checkpoint, provider inventory and filesystem before deciding on recovery.
No automatic retries, resumes, rollback or cleanup of created resources occur.
D26 adds only the explicit separately reviewed recovery described below.

Generated database/admin passwords are retained in the owner-only account directory
`.seohost-mcp-stage/<credential-reference>.json` (directory 700, file 600), outside
web roots. MCP returns a reference, never the contents. The owner retrieves them
privately through existing hosting/SSH access. CLI cache/config are also private.
Do not print these files in agent tools, logs or public issue/review documents.
They are recovery credentials, not source/target backups. No automatic deletion.

A successful receipt verifies the local installation, core version and site URL,
with indexing disabled. Public DNS, certificate trust and HTTPS/HTTP behavior are
reported **unverified**, not as a fully reachable deployment. Check these separately;
use the existing reviewed DNS/TLS workflows where their authorization/scope applies.
An unavailable external DNS integration or parent-wide TLS consent is not bypassed.

## Provider evidence

H57 has WP-CLI 2.12.0; local OS/provider identity and the document-root read matched.
Native DirectAdmin WordPress inventory remains denied. Softaculous has a documented
API and end-user CLI, and its CLI file is readable on H57. However, documented
`--list_ins --sid=26 --resp=json` returned exit 255 without output under the available
PHP 8.2, 8.3 and 8.5 runtimes (ionCube is present). Earlier API list actions returned
non-JSON. Neither proves a working integration or identifies missing key rights.
No proprietary sources were read; no permissions/security settings were weakened.
Ask the host for the supported end-user API/CLI authentication/runtime contract.
Softaculous remains a separate potential adapter; manual WP-CLI installs are not
claimed to appear automatically in its manager.

Sources: [DirectAdmin document-root map](https://docs.directadmin.com/directadmin/general-usage/directadmin-binary.html),
[WP-CLI install](https://developer.wordpress.org/cli/commands/core/install/),
[config/password prompts](https://developer.wordpress.org/cli/commands/config/create/),
[core download and bounds](https://developer.wordpress.org/cli/commands/core/download/),
[Softaculous API](https://www.softaculous.com/docs/api/api/),
[end-user installation listing CLI](https://www.softaculous.com/docs/cli/list-installations-from-cli/),
[installation CLI](https://www.softaculous.com/docs/cli/install-script-from-cli/).

Production 0.11.0 was deployed on 2026-10-25 from `ceab05b` through successful
Deploy MCP run `40188810485` (Check `40188798012`). All 111 tests/types/build pass.
The owner separately approved H57-only opt-in, backed-up private configuration and
single-app restart. Production discovery/auth checks and actual stdio MCP planning
passed. The confirmation page loads without anonymous plan disclosure. No real
installation has run yet; subdomain/DB mutations and full install remain fixture-
tested until a concrete owner-confirmed operation completes. No live clone/promotion
or Softaculous adapter is claimed. Keep the stdio process alive while polling an
applied background job; do not restart/redeploy during an active installation.

### Browser form compatibility (0.11.1)

Approval and OAuth pages use `Referrer-Policy: strict-origin`: browsers retain the
real Origin on same-origin HTML form POSTs, without disclosing URL paths/plan IDs
in referrers. `no-referrer` made native form submissions send `Origin: null`,
which correctly failed the server Origin check even with valid credentials. Do
not fix this by allowing null/wildcard/cross-site origins or weakening CSRF.
This was reproduced with a real browser and dummy local owner credentials before
the patch; after the patch the same form reaches the exact-plan review. Tests
assert both form policies and continued null/cross-site Origin rejection.
Expired plans still require a new preview; per-plan form challenges remain single-use
and expire after five minutes. Reopen the fresh link if a form has been idle too long.

Patch 0.11.1 deployment `40193850271` from `75c40d6` passed on 2026-10-25
(Check `40193837644`, 112 tests/types/build). The earlier attempt stopped before
production changes because CI exposed a startup export-housekeeping race; that
race is also fixed and regression-tested. The expired preview was replaced with
a fresh plan; no real installation or owner consent was executed by the agent.

## Remembered owner login (0.12.0)

After one successful login, this browser remembers the MCP owner for an absolute
8 hours. These are existing MCP credentials, not the new WordPress administrator.
The readable preview lists the website, account, administrator, pinned core,
dedicated database, protection and pending public DNS/TLS verification. The target
directory is prominent in the preview; the requesting client is in an expandable section.

Every plan still requires its own explicit approval and conversational confirmation;
being signed in never approves or applies a plan. Each form has a separate five-minute,
single-use cookie-bound challenge. Expiry, logout or changed owner credentials/origin
prevent an already open form from approving. Logout revokes this browser session;
it does not revoke previously recorded plan approvals or execute hosting changes.

The random session secret is sent only in a host-only HttpOnly, SameSite=Strict
cookie scoped to `/wordpress-stage`, with Secure on HTTPS. SQLite stores only its
SHA-256 hash, expiry and binding to the public origin/current owner credentials.
Sessions do not slide or become OAuth grants; at most 100 active sessions are stored.
The owner can sign out on the review/result page or `/wordpress-stage/logout`.

Release 0.12.0 deployed from `c5fe087` through successful Deploy `40201063221`
(Check `40201053559`, 117 tests/types/build). Real browser session reuse/logout was
verified only with dummy local credentials; production owner login and actual
installation are still awaiting the owner's action. No hosting target was created.

## Readable database names and owner result (0.13.0)

New plans use `<account>_<hostname_slug>_<8_hex_chars>` for the database and its
user. Dots/hyphens become underscores; long hostnames are truncated to a conservative
32-character total budget. The account prefix is preserved and an overly long prefix
is refused. The suffix avoids collisions; fresh provider absence checks still apply.
This is an application naming policy, not a claim that every provider uses the same
limit. Cached H57 Swagger specifies strings without name limits; provider acceptance
remains live-unverified. Existing databases/plans are never renamed. The current
workflow still provisions only subdomains; root-domain installation is unavailable.

After local completion, `result.ownerResultUrl` points to the same owner page. A valid
remembered session or fresh MCP owner login is required. Expand **Show WordPress
administrator password** to save the generated installation password. Later changes
inside WordPress are not tracked. The database password remains private; passwords
never appear in MCP responses, logs, plans or SQLite receipts. Before installation
there is no generated password to display. Failed/unknown jobs do not expose one.

Credential reads verify the configured private directory, file ownership/mode,
regular-file/no-symlink status, size and exact installation identity. The page sends
no-store and restrictive CSP. Minimal responsive CSS is authorized by a static SHA-256
style hash; no external assets/scripts or unsafe-inline permission. Applied receipts
remain viewable after the apply deadline, until normal receipt housekeeping removes
them (seven days on subsequent plan creation); retained private files are not deleted.
The browser login challenge stays five minutes; approval/apply rules are unchanged.

Release 0.13.0 deployed from `4076a87` through successful Deploy `40203604423`
(Check `40203593539`, 120 tests/types/build). Independent SDK confirmed health,
30 tools and read-token write rejection. Browser verification used dummy local
credentials and a simulated completed result only; real installation remains pending.

Patch 0.13.1 uses the owner's pink gradient for primary buttons/brand text and
matching neutral/focus colors. Static hash-authorized CSS and behavior are unchanged.
At that release the adapter supported only `<parent public_html>/<label>`. Version
0.14.0 adds the separate-domain mode described below. Never change a reviewed
document root implicitly.

## Separate domains and Polish UI (0.14.0)

New plans default to `placement=independent_domain`: the hostname is added as a
separate DirectAdmin domain, with `<home>/domains/<hostname>/public_html`. Parent
ownership and absence from both domain/subdomain inventory still gate planning.
The entire new domain container must be absent, even if an old one is empty. Apply
uses the documented `POST /CMD_API_DOMAIN` create operation with shared account
quota/bandwidth, PHP/SSL on and CGI off; it verifies inventory and the exact computed
document-root map before files/DB installation. This creates local hosting/DNS
configuration, not domain registration, public DNS repair or a certificate. No
parent root, certificate or TLS settings are changed. Same hosting UID/account is
retained: a separate directory does not establish future provider isolation.

`placement=subdomain` remains explicit for the old nested path. Persisted plans
without placement keep the old behavior and permissions; they are not relocated.
The selected placement and directory are prominent in owner review and covered by
the immutable preview hash. A new placement needs a new plan/approval.
`get_server_capabilities.stagePlacementsConfigured` reports configured modes only.
H57 already allowed create_domain; this change does not expand private allowlists.

The stage owner UI defaults to Polish; **English** links use `?lang=en`. Switching
language changes presentation only, keeps authentication, and never approves a plan.
Dates use the selected locale and Europe/Warsaw. Login, preview, result, logout and
safe errors are localized. MCP data/docs stay in English. Same-Origin/CSRF/expiry,
no-store and static style-hash CSP remain enforced. At 0.14.0 provider-populated files stopped installation. New 0.18.0 plans
include the bounded preservation policy above; no placeholder is deleted.

Sources: [DirectAdmin domain creation](https://docs.directadmin.com/developer/api/legacy-api.html#user-apis),
[computed document roots](https://docs.directadmin.com/directadmin/general-usage/directadmin-binary.html#show-documentroots).

Release 0.14.0 deployed from `cb606e8` through successful Deploy `40208957293`
(Check `40204918957`, 123 tests/types/build). SDK/public checks verified version,
30 tools, configured placements, read-token write rejection, Polish/English pages
and static CSS hash. Real H57 preflight produced an unapproved independent-domain
plan with the intended separate root and absent target. No domain/DB/WP installation
was executed; post-create mapping and real provider write acceptance remain unverified.

### First live apply (2026-10-26)

The first separately approved independent-domain creation returned an unconfirmed
outcome. The worker stopped before DB/WP and retained the unknown account lock.
Read-only reconciliation confirmed domain presence and the exact reviewed computed
root; database inventory confirmed the new DB absent. DirectAdmin populated the
root with index.html, six error pages and cgi-bin. Thus both uncertain-write recovery
and provider-template handling need explicit review before continuing. No POST was
resent, placeholder removed, lock released or credential file disclosed. The cause
of the unconfirmed POST is not established by inventory evidence.

## Controlled pre-database recovery (0.15.0, D26)

This is an explicit exception to the previous no-resume boundary, not automatic
retry. Only an original browser-approved independent-domain plan stopped at
`creating_independent_domain` with unknown/WRITE_OUTCOME_UNKNOWN is accepted. Same
actor/account, original target/hash/receipt and current operation allowlists apply.
The domain must now exist with the exact computed root and no parent-subdomain
conflict; complete bounded DB inventory must prove the chosen dedicated DB absent.
Only known provider templates are allowed: index.html, 400/401/403/404/500/503.shtml,
cgi-bin and its .htaccess. No wp-config, WordPress tree, arbitrary files, symlinks,
special files or hardlinked files. Bounds: 256 KiB/file, 2 MiB total; UID, inode,
mode, size, mtime and SHA-256 form the reviewed immutable snapshot.

Call plan_wordpress_stage_recovery and have the owner inspect the new browser page
and approve that exact snapshot. Use apply_wordpress_stage with its new plan ID/hash.
New consent does not fabricate or reuse the original approval. The original unknown
lock persists while planning. Apply atomically records the parent as failed with
RECOVERY_SUPERSEDED and reconciledByRecoveryPlan, and reserves the new plan. Concurrent
or stale recoveries fail; no lock gap or repeated domain POST exists.

The worker preserves existing generated credentials internally and writes the new
owner-only credential reference. It rechecks actual state/snapshot, creates private
storage at `<home>/.seohost-mcp-stage/recovery/<recovery-plan-id>/`, and saves manifest,
verified-copy and originals subdirectories. All regular copies are mode 600 under
mode-700 directories and verified before any public relocation. The complete source
snapshot is rechecked before relocation and before each top-level move; originals
are renamed privately with relocation.json journaling. Public root must then be empty.
No template, backup or credential is automatically deleted. Missing DB/WP steps run
under the existing fixed adapter; owner result reveals only the WP admin password.

A changed snapshot, uncertain DB write or partial relocation becomes unknown and
keeps the transferred reservation. There is no second-generation recovery, generic
existing-site install, manual lock-reset tool or arbitrary resume checkpoint. Failed
recovery needs operator investigation. Public DNS/TLS remains separate and unverified.

Release 0.15.0 deployed from `95821d2` through successful Deploy `40308153399`
(Check `40308094388`, 130 tests/types/build). Independent SDK verified version,
31 tools and read-token write rejection. Production recovery planning succeeded
against the existing unknown checkpoint, matching root and absent DB; template
hashes were captured. No backup relocation or DB/WP continuation ran yet; the new
snapshot still awaits its separate browser receipt.

## Verified empty-database install continuation (0.16.0, D27)

Live H57 API metadata confirmed Unix-socket SQL connections. The earlier DB-create
adapter incorrectly required TCP; it now accepts the documented absolute local Unix
socket description as well as exact loopback TCP addresses. This response address
is never used to read a file or choose a connection destination. Existing request
identity/password/localhost-host checks remain. A successful create is additionally
verified through the same bounded empty-DB proof used by continuation.

The first approved recovery preserved/verified all eight template files and relocated
originals; domain/root and backup checks passed. The dedicated DB exists with zero
tables and one matching localhost-only user, but creation was not confirmed by the
old adapter. It remains unknown at creating_database; no WP install ran at that point.
The original create response is unavailable, so its entire failure cause is not proven
solely by later server metadata.

`continue_wordpress_stage_install` accepts only that checkpoint of an already started
and owner-approved recovery, with the same actor/account/hash/receipt and private
credential reference. It does not create another plan or broaden approved effects.
Original ready-plan expiry still gates initial reservation; it does not cancel a
started job. Fresh proofs verify private manifest, copies and originals against the
approved template snapshot; the exact empty mapped root; zero tables/views/routines/
events/triggers; one exact DB user restricted to localhost without conflicting hosts;
and retained credential access through fixed local PHP/mysqli. The only SQL is a
fixed read-only metadata count; no caller SQL/PHP, content reads or raw errors. Secret
stdin, clean environment, 15-second timeout and 4 KiB child output apply.

After proofs, an atomic CAS changes the same unknown reservation to applying. The
worker rechecks proofs and runs only the already authorized WordPress install. It
never repeats domain/DB creation, rewrites credentials, relocates files again or
releases the lock. Wrong phase/hash/actor/receipt, nonempty/foreign DB, changed backup
or failed credentials prevent starting. A later partial install keeps unknown and
cannot use this continuation again; no arbitrary resume or generic takeover exists.

## Pinned core extraction repair (0.17.0, D28)

The same approved recovery can also continue only at verifying_core/WP_CLI_FAILED.
Live H57 evidence: the pinned archive contains full long paths, while the extracted
files have paths truncated at 100 archive bytes. No configuration or WP tables exist.
Original templates remain privately verified. This is a correction of the job's own
incomplete fresh download, not arbitrary existing-site repair or a new consent scope.

Before install, prove the existing template backups, mapped root deny guard, absent
config/MU plugins/drop-ins and empty local DB credentials. Copy the original pinned
cache archive privately (64 MiB limit), compare WordPress.org's HTTPS MD5, validate
up to 10,000 safe relative wordpress/ archive entries with only regular/directory
types, and extract via fixed /bin/tar outside web roots. Never accept caller URLs or
archives. The candidate must pass official WP checksums before any target repair.
Trees are bounded to 10,000 entries, 32 MiB/file and 256 MiB total. Existing files must
match candidate SHA-256 or the exact truncated path/bytes of a candidate entry.
Unknown/edited content is refused. Save manifests, rename proven truncated artifacts
privately and create only missing files exclusively; no existing correct file is
overwritten or backup deleted. The complete repaired tree and final WP checksums
must pass before config/install. Partial repair stays unknown with its reservation.
The same-UID account trust boundary remains; this does not sandbox hostile tenants.

Sources: [WP-CLI download](https://developer.wordpress.org/cli/commands/core/download/),
[checksum verification](https://developer.wordpress.org/cli/commands/core/verify-checksums/).

The pinned core validator accepts normal comma-containing font paths and individual
files up to 32 MiB (the live pinned build contains a 13.4 MB JS worker). The same
approved job may re-run a pre-write core validator refusal at verifying_created_database;
all guards, archive/candidate/tree proofs and reservation requirements still apply.
No prepared or partially modified repair checkpoint is retried automatically.

Release 0.17.1 deployed from `c36262b` through successful Deploy `40315925731`
(Check `40315903466`, 139 tests/types/build). The same approved recovery completed:
39 missing pinned files restored, 33 proven truncated artifacts retained privately,
full candidate/final checksums passed, config/private credentials preserved, and
WordPress 7.1.3 installed with the reviewed URL and indexing disabled. No domain or
DB POST was repeated. Reservation released on applied success. Independent public
HTTPS confirmed frontend 403/noindex,nofollow (expected protection) and wp-login 200.
Private provider templates/copies/originals are retained; no backup was deleted.
The owner result page is available for password retrieval in the owner browser.


Release 0.18.0 deployed from `641446d` through successful Deploy `40318949846`
(Check `40318886786`, 144 tests/types/build). Independent HTTPS/SDK checks verified
0.18.0, 32 tools, configured placements, unauthenticated 401 and read-token write
rejection. No active/unknown stage jobs existed before restart. No new target or
live installation was used for validation; the prior completed stage was untouched.


D31/0.20.0 supersedes historical source/candidate archive retention only after a
verified successful install. Original templates, truncated artifacts, manifests
and credential files remain. Failed/unknown jobs keep recovery inputs; cleanup
failure never changes a completed installation to unknown. See MAINTENANCE.md.
