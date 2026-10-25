# Fresh WordPress stage

Version 0.11.0 adds a **fresh single-site** workflow. Cloning, promotion, imports,
multisite, existing-target replacement and backup deletion remain unavailable.
This implements only the fresh-target part of [migration requirements](WORDPRESS-MIGRATIONS.md).

## Tools and approval

| Tool | Inputs | Effect |
| --- | --- | --- |
| `plan_wordpress_stage` | Explicit `serverId`, owned parent `domain`, exact `label`, `adminEmail`; optional `adminName` (stageadmin), `title` | Validates absence, local runtime/account and canonical root; pins a stable WordPress version and chooses a new database. Returns an immutable 30-minute plan and owner confirmation link. No target writes. |
| `apply_wordpress_stage` | Same actor/account, `planId`, `previewHash` | Requires a separate owner browser approval. Reserves the shared account lock, starts a background worker and returns immediately. |
| `get_wordpress_stage` | Same actor/account and `planId` | Reports persistent phase/result, including partial and unknown outcomes. No resume, retry, deletion or automatic reconciliation. Write authorization is required; disabled provisioning does not prevent receipt inspection. |

All three require write authorization. Plans/apply additionally require both
`create_subdomain` and `create_wordpress_stage` in the account's write operations.
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
  "writeOperations": ["create_subdomain", "create_wordpress_stage"]
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
Only a new direct child of that root is supported; every existing directory
component must be canonical, owned and non-symlink. No caller root override exists.
Even an existing **empty** target directory is refused. No existing target means
there is no old-target database/files backup to create; this absence is recorded.
No source data is copied. Existing data requires a different, unimplemented workflow.

Create one subdomain through the fixed legacy API, re-read its actual document root
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
directory and requesting client are available in an expandable section.

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
