# Security

Never include hosting keys, MCP tokens, OAuth tokens, passwords or unredacted logs in issues.
Report security problems privately to the repository maintainer through the repository's
private security reporting feature when available. Do not publish an exploit against a live account.

HTTP fails closed without a token or complete OAuth configuration. Stdio trusts the local
process owner. Infrastructure tools do not contact hosting accounts. Future hosting abilities
must enforce authorization and explicit server selection independently of MCP annotations.

MCP tokens and DirectAdmin Login Keys are separate credentials. Keep secrets out of git,
public web roots, tool results and client-side JavaScript. This project is an independent
integration, not an official SeoHost or DirectAdmin product.

WordPress log reads require explicit private root allowlists and fresh provider
installation/file metadata. Callers cannot provide file paths or enable debug.
Metadata checks and download are not atomic against concurrent filesystem changes;
use trusted account-owned installations, not hostile tenant isolation. Redaction
is best effort, not a guarantee that output is free of secrets or personal data.
See [WordPress reads](docs/WORDPRESS.md) for limits and provider permissions.

Domain/DNS changes require `mcp:write` or a distinct write Bearer token, an account
operation allowlist and an actor-bound expiring preview. Original read tokens never
gain write access. DNS edits require fresh NS observations matching trusted account
nameservers; recursive-resolver observations are not a DNSSEC/root-delegation proof.
Preview hashes do not prove human consent. Stale checks are optimistic, not atomic
against external panel users. A SQLite account lock and persistent receipt prevent
blind retries after uncertain writes; there is no automatic DNS/hosting rollback.
Keep change state private on local disk and preserve it across deployments. See
[domain/DNS workflow](docs/DOMAIN-DNS.md) for limits and reconciliation.

TLS automation/redirects require explicit parent-domain scope and exact operation
allowlists; they also affect children/aliases. ACME configuration may hold external
DNS credentials: preserve them in memory without persisting/exposing them in plans.
Never use certificate-file or legacy SSL reads that return private keys. HTTPS
enablement checks provider metadata, not live chain trust/proxy settings. Disabling
ACME retains installed certificates/redirects; expiration remains possible. See
[TLS contract](docs/TLS.md).

Site redirect writes accept literal paths and constrained HTTP(S) domain URLs,
never raw rewrite directives. Inventory redacts existing destination credentials,
query and fragment; no destination HTTP request is sent. Source-prefix/shared-root
effects need preview review. Editing is non-atomic delete/add, with no undocumented
overwrite, blind retries or automatic rollback. See [redirect contract](docs/REDIRECTS.md).

Account/database diagnostics project only named non-secret metadata and never
expose SQL, connection credentials or arbitrary-user resource routes. Backup-file
inventory requires narrow private roots and canonical regular-file metadata; it
does not download or restore archives. Log summaries inspect the bounded redacted
tail once, count lines rather than incidents and retain rare critical examples.
Neither heuristic classification nor file presence proves security or restorability.
See [diagnostic contracts](docs/HOSTING-DIAGNOSTICS.md).

Database exports require per-account opt-in and a dedicated canonical owner-only
local directory outside every web root. They contain sensitive SQL even though
MCP returns metadata only. WordPress selection may internally read provider config;
only a loopback database name survives, never config credentials. Fresh account DB
ownership gates export. Download URLs require the same authenticated actor and
expire after one hour; disabling account exports revokes access. Compressed and
decompressed bounds, private file modes, fixed routes, no redirects, ten-artifact
quota and local cleanup limit exposure. Single-process locks and owner-controlled
filesystem are required; no hostile same-UID isolation or multi-worker quota claim.
Operator-managed local copies have independent retention. See
[database exports](docs/DATABASE-EXPORTS.md).

Native desktop OAuth redirects require an explicit loopback enrollment opt-in;
registered callbacks are subsequently matched exactly. Loopback shape is not client
identity. Refresh tokens are hash-only, client/resource/scope-bound, atomically
rotated and replay-detecting; reuse or explicit family revocation invalidates
associated access tokens. Existing read grants cannot gain write scope via refresh.
See [OAuth](docs/OAUTH.md) for bounds and configuration.

## Fresh WordPress stage boundary

The opt-in 0.11.0 workflow adds only fresh local-account installs, with a separate
owner-password browser approval bound to plan/hash/actor/account/expiry. A write
grant or agent-provided approval assertion cannot manufacture that receipt. The
approval page uses Origin/CSRF/session/rate checks and never displays a plan before
owner login. The shared account lock and pre-write checkpoints survive HTTP
disconnects; interrupted/uncertain operations are never retried or cleaned up.

Provider hostname, OS account/home, canonical document roots, target absence and
new DB identity gate fixed shell-free WP-CLI steps. Secrets use stdin, a restricted
child environment and owner-only retained files outside web roots; no raw stdout,
provider DB response or passwords reach MCP. No existing directory or database
is reused, no imports/deletions occur, and parent TLS/DNS policy is untouched.
Private paths and binaries are operator configuration, never tool inputs. This
trusts the local same-UID account and Apache-compatible installation deny rules;
it is not isolation against hostile code running under that UID. Local success
is not public DNS/TLS/HTTP verification. See [workflow limits](docs/WORDPRESS-STAGE.md).

Owner HTML forms use an origin-only `strict-origin` referrer policy, retaining
same-origin POST identity without leaking plan/query paths. `Origin: null` is
still rejected; never allow it to compensate for `no-referrer` on login pages.

Stage owner browser login can be remembered for an absolute eight hours (D23).
Only a hash of the random cookie token is persisted; origin and current owner
credentials bind verification. HTTPS uses host-only Secure/HttpOnly/SameSite=Strict
cookies scoped to the stage routes. Logout requires same-origin POST and CSRF and
revokes the server session. Review forms retain single-use five-minute challenges;
each approval rechecks the owner session. Login is not plan approval, OAuth consent
or a write grant. Existing plan receipts remain valid after browser logout.

D24 permits the authenticated stage owner page to reveal only a completed
installation's generated WordPress admin password. This supersedes the browser
non-disclosure part of D22; no MCP/password-output or database-password access is
added. Retained files must match the receipt identity and pass bounded owner-only,
regular-file/no-symlink checks. Ready/unknown/failed plans disclose no password.
Applied receipts may be opened after their former apply deadline; ready approval
and reservation still expire normally. Static inline CSS requires its exact CSP
hash, keeping scripts, external resources and unsafe-inline blocked.

D25 adds independent-domain stage placement with create_domain gating. Legacy
plans keep nested targets; placement/root remain immutable and actual provider
roots must match before file operations. A domain container must not preexist and
newly populated provider templates still stop writes. Separate directories do not
isolate same-UID sites. Polish/English rendering does not authorize anything;
language query links retain session/CSRF, exact-Origin checks and no-store/CSP.

D26 permits a separately owner-approved recovery only from the exact original
unknown independent-domain creation checkpoint. It requires the original owner
receipt, matching actor/account/target and a new unexpired snapshot approval. The
reservation transfers atomically; no other account write can enter a gap. Fresh
domain/root/DB-absence and fixed allowlisted template hashes/metadata are rechecked.
No arbitrary WordPress/site files are accepted. Regular UID-owned single-link files
are read with no-follow/nonblocking and 256 KiB/file, 2 MiB total bounds. Private
verified copies precede relocation of originals; nothing is deleted automatically.
A changed target or any failed recovery retains an unknown lock and cannot use this
recovery path again. Password files stay private and are never MCP payloads.

D27 permits only the remaining WP installation of the same already approved recovery
stopped at unconfirmed DB creation. Existing actor/account/hash/browser receipt,
private backup hashes, canonical empty root, zero tables/views/routines/events/triggers,
one exact localhost-only user and credential proof gate a CAS on the existing lock.
There is no new consent scope, lock gap, domain/DB POST, password change or arbitrary
resume. A fixed PHP/mysqli read-only count query uses clean environment, secret stdin,
a 15-second timeout and 4 KiB output bound; no caller PHP/SQL or raw errors are exposed.
Documented absolute Unix-socket response descriptions are accepted but never used as
caller-selected connection or filesystem paths; actual DB proof targets localhost.

D28 is restricted to the already approved job's verifying_core/WP_CLI_FAILED.
Prepared root requires the exact deny guard and no config, MU plugins or drop-ins.
A bounded cached pinned archive is copied privately and verified against official
HTTPS MD5; safe relative regular/directory entries, fixed system tar, candidate
checksums and whole-tree SHA-256 comparisons gate repair. Correct files are never
overwritten; only missing official files are created, and exact byte-matching
100-byte-truncated artifacts are retained privately. Final core checksums remain
mandatory. Same-UID concurrent hostile mutation is outside the account trust model.
