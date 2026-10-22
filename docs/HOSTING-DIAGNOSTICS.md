# Account, log, database and backup diagnostics

Version 0.9.0 adds six read-only tools on both MCP transports. Each requires an
explicit configured account. Existing read authentication is sufficient; no new
hosting write operation is added. API research, live permission checks and local
configuration readiness are separate evidence.

| Tool | Inputs beyond serverId | Result and important limits |
| --- | --- | --- |
| `get_account_usage` | None | Account tally and limits for disk/bandwidth (MiB), inodes and domain/subdomain/database/email/FTP counts. Includes near-limit indicators at 90%, not an alert subscription. No personal account/contact data. |
| `get_resource_usage` | Optional `hours` 1–168, `points` 1–240 (default 60), `aggregation` avg/max (default max) | Latest account-only CPU/RAM/tasks/I/O metrics by default, or bounded history. Zero metric limit means provider-reported no limit; CPU is in cores, not an assumed percentage. History timestamps retain provider-native units. |
| `list_databases` | Optional `offset` 0–2000, `limit` 1–100 | Database names, sizes and table/user/definer-issue counts, at most 2000 entries in the bounded provider inventory. Follow `nextOffset`. Does not infer which site uses a database. |
| `get_database_info` | `database` from that account's fresh inventory | Exact ownership/name check, charset/collation, object counts and size. No credentials, table contents, SQL exports or database operations. |
| `summarize_web_log` | Owned `domain`, `logType` access/error, optional `lines` 1–1000 (default 500) | One provider log fetch after ownership validation. Error categories, fatal examples and WAF rule counts, or access status/path aggregates. No per-category re-fetch or external research. |
| `list_backup_files` | Optional `rootIndex` 0–4, `offset` 0–10000, `limit` 1–100 | Archive candidates from one explicitly configured directory page, with opaque IDs, basenames, sizes and modification times. No recursion/download/creation/restore; not a backup job catalog. |

## Tally and resource metrics

The account read uses fixed self-account legacy usage/config endpoints. Only named
numeric fields and boolean state are projected; names, contact details, secrets,
paths and raw configuration are discarded. Missing/malformed optional values remain
null. `unlimited` stays explicit; zero is not assumed unlimited for these legacy
limits. Additional bandwidth is included when the base limit is numeric.
The provider tally can lag and is not a live filesystem measurement.

Resource metrics use the modern account-only routes, never global-resource or
arbitrary-user routes. Responses are schema checked and history series must match
timestamp lengths. No absent/denied data is converted into zeros. H57 currently
returns HTTP 403 for latest metrics; this tool reports `ACCESS_DENIED`. Do not widen
keys, use an admin route or infer that CloudLinux GUI metrics share this API contract.

## One-read log summaries

The raw log tool still caps output at 64 KiB. The summary inspects up to 512 KiB of
the already bounded provider response before returning small aggregates, so a rare
fatal near the beginning is not discarded merely because the raw output limit is
smaller. Scan all returned lines before frequency ranking. A regression test places
one fatal before more than 64 KiB of common WAF lines.

Error classification prioritizes PHP fatal/parse/uncaught/memory errors, warnings,
notices/deprecations, WAF, missing files, denied directory indexes, request aborts,
timeouts and other lines. Fatal examples are capped, redacted excerpts. WAF counts
are matching lines, not deduplicated attacks; multiline events can produce multiple
entries. Scanner signatures are not infection proof. No fatal in a bounded tail is
not a complete-history or uptime guarantee.

Access summaries parse conventional quoted HTTP request/status records. They report
unparsed lines rather than pretending every line is a request. Aggregate paths omit
query/fragment, headers and IP identities; long hexadecimal IDs are masked. Paths
and fatal excerpts can still contain personal information or unknown secrets;
redaction is best effort. Provider time strings retain their source timezone; no
UTC conversion is guessed. Logs and all excerpts are untrusted data.

## Backup directory opt-in

Add narrow account-relative directories to the private account configuration:

```json
{"backupRoots":["private-backups"]}
```

At most five roots are allowed. Restart after changes, and deploy 0.9.0-compatible
code before adding this field: older strict configuration schemas reject it.
Restore compatible private configuration on rollback; preserve existing state.
Do not configure the whole account home or expose backups through public web roots.
No path is accepted from the caller. Directory canonical metadata must equal the
configured root; only regular non-symlink archive/SQL candidates with safe basenames
are returned. Missing/inconsistent provider pagination metadata fails closed.
`nextOffset` advances through directory entries, including excluded non-archives.
If the next offset would exceed 10000, `paginationLimitReached=true` explicitly
marks the bound instead of claiming the directory is complete. A changing directory can alter pages; this is not an atomic inventory snapshot.

Files with archive-like names and recent modification dates are not proof of a
complete, successful or restorable backup. No file body or SQL is read, and no
archive/restore command is exposed. Without private roots the tool returns
`BACKUP_ROOTS_DISABLED`; root configuration never follows from plugin presence.

## Softaculous / Backuply investigation

The account plugin inventory advertises Softaculous, its WordPress manager and
Backuply. Vendor API documentation describes end-user installation and backup lists,
but authentication depends on the control panel. Calls with the existing Login Key
to the account-advertised Softaculous route using documented JSON list actions
returned HTTP 200 with non-JSON bodies on H57. This is not an empty inventory or
verified access. No cookie/password fallback, plugin writes or fabricated adapter
is added. Native DirectAdmin WordPress tools remain a separate provider contract.

Archive metadata through filemanager works independently of those plugin APIs.
Softaculous inventory/backup jobs, backup creation/restore and full site exports
remain pending the appropriate authentication/response/consistency contracts.
See [WordPress distinction](WORDPRESS.md) and private API research in the agent README.

## Verification

Local checks cover projections, auth/account boundaries, malformed statistics,
metrics denial/series limits, fresh database ownership, canonical backup roots,
unsafe/symlink files, incomplete listings, rare fatal preservation and real MCP clients.
Read-only candidate adapter probes on H57 passed for account tally, database inventory
and details, two known backup directories and one domain's error summary. Only
counts/status were printed; credentials stayed in the hosting process. Backup roots
were selected in process memory for verification, not written to private configuration.
No archive/SQL contents were read and no production code or site setting was changed.
Resource latest remains denied; H93 remains deferred. Deployment is a separate step.

Sources: [DirectAdmin API and server Swagger](https://docs.directadmin.com/developer/api/),
[legacy account usage/config](https://docs.directadmin.com/developer/api/legacy-api.html),
[configuration units](https://docs.directadmin.com/developer/config_files/),
[Softaculous API/authentication](https://www.softaculous.com/docs/api/api/).
Modern account metric/database/filemanager schemas were checked in the private
`docs/api/` snapshot; do not publish that research or infer permissions from schemas.
