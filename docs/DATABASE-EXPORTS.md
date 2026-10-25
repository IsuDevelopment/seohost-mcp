# Private database exports

Version 0.10.0 adds `export_database`. It exports a whole account-owned database to
a private `.sql.gz` artifact. It does not return SQL in MCP results, execute SQL,
import/restore, run WP-CLI or create a complete WordPress site backup.

## Enable explicitly

In private account configuration, set `databaseExports: true` for each permitted
account. This is separate from hosting `writeOperations`: exporting reads the
provider database and writes only a local private artifact, so `mcp:read` suffices.
Existing installations remain disabled until opted in. Annotations mark the tool
non-read-only/non-idempotent because each invocation creates a local artifact.

Set `MCP_DATABASE_EXPORT_DIRECTORY` to an **absolute dedicated private directory
outside every web/document root**, for example `/home/OWNER/private/mcp-db-exports`.
Replace the example privately; do not commit actual account paths. The service
creates the directory with mode 0700, subdirectories with 0700 and files with 0600.
Existing storage must be owned by the runtime user, owner-only and canonical,
without symlink parents. The operator must ensure it is not served over HTTP;
filesystem permissions alone do not prevent a web server running as the same user
from serving a directory. Keep parent directories owner-controlled. Never use
shared storage or multiple app processes: quota/creation locks are process-local.

The Login Key must permit database inventory/details and the modern database
export endpoint. Site selection additionally requires native DirectAdmin WordPress
inventory and config reads. `get_server_capabilities` reports configuration only;
it does not establish provider authorization or validate storage permissions.

## Select the source

Choose one explicit `serverId` and **exactly one** of:

- `database`: select the exact name from `list_databases` on the same account.
- `siteId`: select an existing installation from `list_wordpress_sites`. The server
  refreshes installation ownership, privately reads its database configuration,
  immediately discards credentials and retains only the database name. Automatic
  mapping accepts only loopback/localhost with the default MySQL port. Other hosts,
  custom ports and socket forms fail closed; no remote-to-local match is inferred.

Both paths refresh database inventory and verify matching database details before
exporting. No caller URL, shell command, SQL, hosting path or download destination
is accepted by the tool. Domain names alone do not select an installation: domains
can contain multiple WordPress installs and multisite networks.

**Scope is the entire database**, including non-WordPress tables and any other
installations or multisite sites sharing it. Disclose this before exporting a
selected site. A database export contains sensitive customer data and application
secrets; it is not anonymized. It does not include site files or establish an atomic
snapshot with a separately downloaded file archive. Database transaction consistency
depends on the provider export implementation; no snapshot guarantee is claimed.

H57's native WordPress inventory was previously denied (`wordpress=OFF`); its GUI
manager may be Softaculous. The explicit `database` path avoids native WordPress
inventory. This does not verify export permission. There is no Softaculous fallback,
filesystem config scan or automatic change to account feature flags.

## Download

The tool returns `exportId`, a generic filename, byte count, SHA-256, expiry and
`downloadUrl`. HTTP downloads use `GET /exports/{exportId}` with the **same caller's
Bearer token in the Authorization header**. An export ID or URL alone is not an
access credential; no token is placed in the URL or MCP output. Another Bearer
identity, including the separate write token, cannot download the read caller's
artifact. OAuth follows the existing actor identity rules; revoked/expired tokens
are rejected by ordinary authentication. Disabling account exports revokes download
access immediately. These are authenticated download URLs, not public browser links.
Host/Origin checks, no-store, nosniff and attachment headers apply. Ranges are not
supported. No artifact body, config secrets or provider error body is logged.

For a local download using the existing private `MCP_AUTH_TOKEN` and MCP URL:

```sh
npm run download:database -- --server primary --database account_wp --output ./private-backups/site.sql.gz
# Alternatively, with native WordPress Manager enabled:
npm run download:database -- --server primary --site SITE_ID --output ./private-backups/site.sql.gz
```

Create the local destination directory privately and keep it outside public roots.
The helper refuses existing files/symlinks, uses mode 0600, accepts downloads only
from the same MCP origin/fixed route, refuses redirects, checks size/SHA-256 and
removes partial local output on failure. It never prints SQL or credentials. It
requires an exported account opt-in, not write scope. Stdio tool calls additionally
return the private local path for copying without an HTTP server. Do not put the
returned path into public documents. Local copies are the owner's responsibility
and are not deleted when the server-side artifact expires.

## Bounds, retention and failures

- Maximum **100 MiB compressed**, **1 GiB expanded**, **10 retained artifacts** per
  configured directory; one export at a time across all accounts using it.
- Metadata reads keep their existing ten-second bounds. Provider export timeout is
  120 seconds; gzip validation has a separate 30-second bound. Clients/reverse
  proxies need adequate timeouts (the download helper allows 180 seconds for the
  MCP call). No hosting operation is retried automatically.
- Stream directly to a private partial file; validate declared/actual byte count,
  gzip CRC/trailer and bounded decompression before publishing metadata. This checks
  transport/container completeness, not database restorability or SQL semantics.
- Download access expires **one hour after publication**, including after restart.
  HTTP/stdio entrypoints clean expired artifacts at startup and every minute while
  running; creation also prunes expired files. Interrupted partial artifacts are
  removed after one hour. Stopped apps do not run cleanup; expiry still applies
  when they restart. Investigate fixed safe cleanup-error messages on disk failures.
- Artifact files are separate from releases, OAuth and change state. Do not include
  them in deployments, Git, web roots or public archives. Unknown filenames in this
  dedicated directory are not automatically deleted. Operator access is trusted;
  this is not isolation against a hostile same-UID process.

## Verification

Local tests cover fresh ownership/mapping, remote host refusal, config opt-ins,
private modes, symlinks, secret-free results, redirect/error rejection, declared and
streamed limits, decompression limits, truncated gzip/streams, quota/concurrency,
expiry/revocation, stateless artifact reuse, authenticated HTTP/SDK export/download,
and the local helper's checksum/save/overwrite behavior.

On 2026-10-23, the public H57 `/static/swagger.json` was re-read with TLS verification
and confirmed the export and WordPress config contracts used here. No live account
database contents or WordPress configuration were fetched for development. Actual export availability, MIME behavior and a real export remain unverified.
The owner reports full Login Key permissions; operation failures must be diagnosed
as provider feature/contract/runtime failures without assuming a key needs more rights.

## Migration backup distinction

These one-hour exports are temporary download artifacts. They must **not** be used
as the retained safety backups required before stage/live overwrite. The accepted
[migration contract](WORDPRESS-MIGRATIONS.md) requires verified source and old-target
database/files backup sets, fresh user confirmation for every operation and no
automatic backup deletion. Migration tools and retained backup sets are not yet
implemented.

## Requested WP-CLI follow-up

The owner requested plugin inventories per installation/site, multisite site lists,
user lists and `search-replace` for staging-to-live migrations. These are **not tools
in 0.10.0**. Before building an adapter, verify allowed `/api/execute` commands or
SSH/WP-CLI availability and targeting independently of native WordPress Manager.
Use typed fixed operations, bounded/projected information, pagination and explicit
single-site/network selection; never expose arbitrary command strings or flags.
User email/login information needs a deliberate response contract.

Migration writes need their own operation allowlist and reviewed plan: backup,
serialization-aware dry-run, exact old/new values and table/site/network scope,
then separately authorized execution and verification. Do not accept `eval`, raw
SQL, arbitrary `--require`/`--exec` or shell syntax. A changed database URL alone
does not migrate DNS, TLS, files or every multisite configuration setting.

Housekeeping and export reservations are distinct: a new export waits for an
already-running local cleanup rather than receiving a false EXPORT_BUSY. Cleanup
skips active exports; genuinely concurrent exports still fail busy. This ordering
is covered by a deterministic startup-race regression test (0.11.1).
