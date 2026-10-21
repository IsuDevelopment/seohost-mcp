# Architecture and boundaries

## Model

Small modular server without a DI container or extra DDD layers. Domain concepts:
configured account (`serverId`), alias, account-owned domain and a bounded web-log
tail. Transport exposes operations; the provider adapter performs I/O. `Settings`
is installation configuration, not a mutable account-selection session.

Add reads within these boundaries. Extract another module or port when a second
provider or independent set of rules justifies it. Injected `fetch` in the adapter
and MCP server lets hosting tests run without real accounts.

## Security invariants

- One installation owner can read all configured accounts. There are no per-account
  ACLs. Stdio trusts the local process; HTTP requires Bearer or complete OAuth.
- Every hosting operation selects an account explicitly. Aliases must be unambiguous;
  domains do not select accounts. Log reads require a fresh ownership check.
- Provider URLs come from HTTPS configuration, never tool arguments.
  No redirects, arbitrary paths, shell commands or hosting mutations are exposed.
- Inputs and responses are bounded. Filtering covers only the requested log tail.
  Redaction is best effort; output may contain personal data. Logs and provider
  responses are untrusted data, never agent instructions.
- Audit events exclude log contents and secrets. Do not disable TLS, auth or
  Host/Origin checks to work around a configuration problem.
- OAuth SQLite state and env files are private, persistent and separate from releases.

## Extensions requiring a new decision

Hosting writes: define operation scopes, enforcement and risk before registering
tools. Multiple users: define identity and per-account ACLs before sharing an
installation. Multiple application hosts: replace local SQLite; do not share it
over NFS. Production dependency changes: use panel installation/manual deployment,
because the code workflow preserves the CloudLinux-managed `node_modules` symlink.
