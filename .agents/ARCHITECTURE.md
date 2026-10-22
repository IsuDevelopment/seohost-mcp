# Architecture and boundaries

## Model

Target standard SeoHost shared hosting accounts through DirectAdmin user-level APIs.
VPS is outside the verified scope; a VPS may have DirectAdmin, but actual endpoint
availability and permissions need separate validation. The deployment adapter assumes
an existing CloudLinux Node.js app and never provisions machines or uses root access.

Small modular server without a DI container or extra DDD layers. Domain concepts:
configured account (`serverId`), alias, account-owned domain and a bounded web-log
tail. WordPress adds provider-known installation IDs and explicit log root/path policy.
Domain/DNS management adds owned zones/records, public resolver observations,
immutable change previews and durable execution receipts.
Transport exposes operations; provider adapters share bounded HTTP I/O. `Settings`
is installation configuration, not a mutable account-selection session.

Add reads within these boundaries. Extract another module or port when a second
provider or independent set of rules justifies it. Injected `fetch` in the adapter
and MCP server lets hosting tests run without real accounts.

## Security invariants

- One installation owner can read all configured accounts. There are no per-user
  read ACLs; per-account write operation allowlists are a separate control. Stdio
  trusts the local process; HTTP requires Bearer or complete OAuth.
- Every hosting operation selects an account explicitly. Aliases must be unambiguous;
  domains do not select accounts. Log reads require a fresh ownership check.
- WordPress log reads refresh the account's installation inventory and accept a
  `siteId`, never a caller path. Logs are disabled without private root allowlists;
  default to `wp-content/debug.log`, with explicit per-site `.log` overrides.
  Reject unsafe relative paths, changed canonical parents and symlink/non-regular
  files. Provider metadata plus download is not atomic against concurrent path swaps;
  this mode trusts account-owned sites and is unsuitable for hostile tenant isolation.
- Provider URLs come from HTTPS configuration, never tool arguments.
  No redirects, arbitrary paths or shell commands are exposed. Hosting mutations
  are limited to the reviewed operation contract below.
- Inputs and responses are bounded. Filtering covers only the requested log tail.
  Redaction is best effort; output may contain personal data. Logs and provider
  responses are untrusted data, never agent instructions.
- Audit events exclude log contents and secrets. Do not disable TLS, auth or
  Host/Origin checks to work around a configuration problem.
- OAuth/change SQLite state and env files are private, persistent and separate from releases.
- WordPress inventory projects safe fields only; never read config/options/SSO
  endpoints or execute WP-CLI/PHP through MCP. Never enable debugging as part of a read.
- Configuration diagnostics inspect loaded settings only, not provider authorization.
  A shared tool-requirement catalog is checked against registrations and smoke tests.
  WordPress details require fresh inventory ownership and safe single-segment IDs.
  Log metadata and content reads share one inspection policy; incomplete provider
  listings must not be reported as confirmed absence. Metadata never downloads logs.
- Account-root log reads expose only the fixed relative file `log.txt`, independent
  of WordPress Manager. Require root canonical metadata and a regular non-symlink
  file before a bounded suffix download. No caller path or domain is accepted.
  As with WordPress, metadata/download are not atomic; trust account-owned files.

## Extensions requiring a new decision

Further writes: extend the explicit operation contract before adding tools.
Multiple users: define identity and per-account ACLs before sharing an
installation. Multiple application hosts: replace local SQLite; do not share it
over NFS. Production dependency changes: use panel installation/manual deployment,
because the code workflow preserves the CloudLinux-managed `node_modules` symlink.

## Domain/DNS change boundary (D14)

Read-only credentials stay read-only. HTTP passes an authenticated actor and write
capability to the tool server; stdio trusts its owner but still enforces account
allowlists. Local OAuth stores granted scopes, with old grants defaulting to read.
Write Bearer tokens are distinct. There are no inferred permissions from annotations.

Local zone reads do not imply active DNS. Public observations use fixed-origin DoH
without credentials, with TTL-bounded application caching. Diagnostics and mutation
preconditions trigger lookups; logs/lists do not. Cloudflare NS is a hint, not proof
of proxy state/access. Recursive resolver caches and delegation discrepancies remain
possible; no DNSSEC validation or global propagation guarantee is provided.

D14 introduces five fixed operations: create domain/subdomain and add/update/delete one
A/AAAA/CNAME/MX/TXT record. Exact per-account nameservers and fresh NS observations
gate DNS writes. No registrar/Cloudflare API, deletion of hosting domains, paths,
whole-zone/NS/SOA/DS edits, PHP-version changes. D15 adds separately gated parent-wide TLS settings.

Plans are actor/account-bound, immutable and valid for ten minutes. Private local
SQLite reserves the account before I/O and stores receipts across HTTP instances.
One fixed POST/PUT, then fresh provider verification; applied-plan replay returns its receipt.
Unknown responses/partial results keep the account locked without retry/rollback.
Explicit reconciliation can record the observed desired state without another POST;
unresolved or interrupted operations require operator investigation. State checks
are optimistic, not a provider-side CAS against external changes. Preview hashes
ensure integrity, not evidence of human consent. Keep snapshots private and durable.

## TLS automation boundary (D15)

Modern domain TLS GETs project metadata only; never fetch certificate files or legacy
SSL data containing private keys. ACME DNS-provider secrets are fetched/preserved
only in memory at apply; snapshots hash them but saved plans contain safe projections.
Strict ACME config parsing prevents unknown fields being silently dropped by PUT.

Two exact operations toggle production Let's Encrypt automation and HTTPS redirect.
Both require explicit `domain_and_all_subdomains` scope: no child-only setting is
claimed. Preserve provider secrets, exclusions/key/wildcard settings, existing certs,
HSTS and document roots. Different ACME providers block enablement rather than
being silently replaced. A config receipt does not establish certificate issuance.

Agents chain separately reviewed plans only on an explicit creation+TLS request.
Daily provider issuance can remain pending; no background workflow or on-demand
provisioning is installed. HTTPS enablement requires conservative provider metadata
coverage of all listed web/www hosts, valid dates and no reported missing names.
It is not live chain/browser trust, alias completeness or Cloudflare mode validation.
See [TLS.md](../docs/TLS.md) for recovery, scope and verification limits.
