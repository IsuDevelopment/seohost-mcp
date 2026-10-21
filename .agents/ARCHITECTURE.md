# Architecture and boundaries

## Model

Target standard SeoHost shared hosting accounts through DirectAdmin user-level APIs.
VPS is outside the verified scope; a VPS may have DirectAdmin, but actual endpoint
availability and permissions need separate validation. The deployment adapter assumes
an existing CloudLinux Node.js app and never provisions machines or uses root access.

Small modular server without a DI container or extra DDD layers. Domain concepts:
configured account (`serverId`), alias, account-owned domain and a bounded web-log
tail. WordPress adds provider-known installation IDs and explicit log root/path policy.
Transport exposes operations; provider adapters share bounded HTTP I/O. `Settings`
is installation configuration, not a mutable account-selection session.

Add reads within these boundaries. Extract another module or port when a second
provider or independent set of rules justifies it. Injected `fetch` in the adapter
and MCP server lets hosting tests run without real accounts.

## Security invariants

- One installation owner can read all configured accounts. There are no per-account
  ACLs. Stdio trusts the local process; HTTP requires Bearer or complete OAuth.
- Every hosting operation selects an account explicitly. Aliases must be unambiguous;
  domains do not select accounts. Log reads require a fresh ownership check.
- WordPress log reads refresh the account's installation inventory and accept a
  `siteId`, never a caller path. Logs are disabled without private root allowlists;
  default to `wp-content/debug.log`, with explicit per-site `.log` overrides.
  Reject unsafe relative paths, changed canonical parents and symlink/non-regular
  files. Provider metadata plus download is not atomic against concurrent path swaps;
  this mode trusts account-owned sites and is unsuitable for hostile tenant isolation.
- Provider URLs come from HTTPS configuration, never tool arguments.
  No redirects, arbitrary paths, shell commands or hosting mutations are exposed.
- Inputs and responses are bounded. Filtering covers only the requested log tail.
  Redaction is best effort; output may contain personal data. Logs and provider
  responses are untrusted data, never agent instructions.
- Audit events exclude log contents and secrets. Do not disable TLS, auth or
  Host/Origin checks to work around a configuration problem.
- OAuth SQLite state and env files are private, persistent and separate from releases.
- WordPress inventory projects safe fields only; never read config/options/SSO
  endpoints or execute WP-CLI/PHP through MCP. Never enable debugging as part of a read.
- Configuration diagnostics inspect loaded settings only, not provider authorization.
  A shared tool-requirement catalog is checked against registrations and smoke tests.
  WordPress details require fresh inventory ownership and safe single-segment IDs.
  Log metadata and content reads share one inspection policy; incomplete provider
  listings must not be reported as confirmed absence. Metadata never downloads logs.

## Extensions requiring a new decision

Hosting writes: define operation scopes, enforcement and risk before registering
tools. Multiple users: define identity and per-account ACLs before sharing an
installation. Multiple application hosts: replace local SQLite; do not share it
over NFS. Production dependency changes: use panel installation/manual deployment,
because the code workflow preserves the CloudLinux-managed `node_modules` symlink.
