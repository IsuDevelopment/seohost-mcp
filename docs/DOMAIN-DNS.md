# Domains, DNS diagnostics and reviewed changes

Version 0.6.0 separates local hosting configuration, public DNS observations and
planned writes. Every tool requires an explicit configured `serverId`. H57 is the
live-verified installation; H93 remains deferred.

## Reads

| Tool | Inputs | Result / limits |
| --- | --- | --- |
| `get_domain_info` | `serverId`, `domain` | Fresh ownership, PHP/SSL/redirect flags, IP and provider quota/bandwidth display values. No usernames/paths; document root is explicitly not queried. Display values do not establish remaining account capacity. |
| `list_dns_records` | `serverId`, `domain` | Local DirectAdmin zone, account/domain-bound opaque record IDs, names, values, TTL and snapshot version. No public lookup. This zone may be inactive. |
| `check_dns` | `serverId`, `domain`, optional `name` (`@` by default), `fresh` | Local/public comparison, observed NS, provider hint, A/AAAA/CNAME/MX/TXT/CAA and basic SPF/DMARC observations. The queried name must belong to this hosted domain. |

Public observations use the fixed Google Public DNS HTTPS JSON endpoint, without
hosting credentials. Results are from one recursive resolver, not a trace from the
root, authoritative direct queries, global propagation proof, DNSSEC validation or
a complete mail-delivery audit. Google receives queried names; EDNS client subnet is disabled. Positive answers
are cached in memory by name/type for their minimum TTL, capped at five minutes;
TTL zero, negative answers and failures are not cached. `fresh=true` bypasses only
this application cache: upstream resolver caches still apply. Failure is reported
as unverified, never converted into a missing record. No diagnostic HTTP request
is made to an IP/URL returned by DNS.

Run lookups for DNS diagnostics and before changes. Domain/log/subdomain listing
and log reads do not trigger them. Cloudflare-standard NS names are an inference
about DNS hosting, not proof of proxy state or access to a Cloudflare account.
A local/public mismatch can be intentional, especially with a proxy. Do not
automatically "repair" it.

## Authorization and account setup

Read access remains `mcp:read` or the existing `MCP_AUTH_TOKEN`. Existing OAuth
tokens never gain write access after an upgrade. Writes and change previews require:

1. Local/external OAuth with both `mcp:read mcp:write`, granted in a new explicit
   owner consent, or a separate private `MCP_WRITE_AUTH_TOKEN` (at least 32 characters,
   different from the read token). Local OAuth advertises write scope when an
   account has enabled operations. Stdio trusts its process owner but still enforces
   account operation policy.
2. Exact operations enabled in that account's private configuration:

```json
{
  "writeOperations": ["create_domain", "create_subdomain", "add_dns_record", "update_dns_record", "delete_dns_record"],
  "dnsNameservers": ["ns1.hosting.example", "ns2.hosting.example"]
}
```

These are account fields alongside `baseUrl` and credential environment names;
they are not a separate config file. Defaults are empty/disabled. Obtain trusted
nameservers from operator/provider account settings, not arbitrary zone records.
For a manual rollback to code older than 0.6.0, restore the compatible private
configuration backup or remove these new account fields first; older strict schemas
reject them. Preserve change receipts/locks even when rolling back application code.
Restart after configuration changes. DNS add/edit/delete require a fresh public NS
answer matching this exact configured set at both preview and apply. Unknown,
failed or externally hosted DNS is blocked. Subdomain/domain hosting creation can
still prepare local configuration while clearly warning that external DNS will
need a separate provider change. These tools do not edit Cloudflare or registrar
delegation. Give Login Keys only the required provider commands; MCP scopes alone
do not narrow the upstream key itself.

## Preview, review, apply

```json
{"name":"plan_hosting_change","arguments":{"serverId":"primary","change":{"operation":"create_subdomain","domain":"example.com","label":"staging"}}}
{"name":"plan_hosting_change","arguments":{"serverId":"primary","change":{"operation":"add_dns_record","domain":"example.com","record":{"type":"A","name":"staging","value":"192.0.2.10","ttl":300}}}}
```

The result includes `planId`, `previewHash`, `expiresAt`, before/after and warnings.
Show that concrete preview before executing unless the owner already authorized
that exact change. A supplied hash is an integrity check, not proof of human consent.
Apply with the same caller/account and both returned identifiers:

```json
{"name":"apply_hosting_change","arguments":{"serverId":"primary","planId":"<returned-plan-id>","previewHash":"<returned-preview-hash>"}}
{"name":"get_hosting_change","arguments":{"serverId":"primary","planId":"<returned-plan-id>"}}
```

Supported changes:

- `create_domain`: `domain`. Creates hosting/local-zone configuration with PHP/SSL
  enabled, CGI off and shared account quota/bandwidth. Not registration, external
  DNS configuration, a PHP-version change or certificate issuance.
- `create_subdomain`: existing parent `domain`, one `label`. No caller document-root
  override. Ownership, existing domains/subdomains and final inventory are checked.
- `add_dns_record`: `domain`, `record`.
- `update_dns_record`: `domain`, fresh `recordId` from this zone, replacement `record`
  preserving its type.
- `delete_dns_record`: `domain`, fresh `recordId`. Deletes that exact provider
  selector, not an entire record type or zone.

Writable types: A, AAAA, CNAME, MX, TXT. Record fields: `type`, `name` (relative,
`@`, or an in-zone FQDN), `value`, optional `ttl` (60–604800 seconds). Absolute
external owner names, invalid addresses, apex CNAMEs and CNAME coexistence are
rejected. CNAME targets are absolute hostnames; MX value is `priority hostname`.
TXT writes accept one plain-text string of at most 255 UTF-8 bytes; the adapter
quotes it. Multi-string TXT/DKIM editing, SRV/CAA/NS/SOA/DS writes, domain/subdomain
deletion, whole-zone reset and DNSSEC changes are unavailable. Explicit TTL writes
require provider per-record TTL support. Omitted TTL retains the old record TTL for edits. New records use 3600 seconds
when per-record TTL is supported, otherwise the observed zone TTL.

## State, retries and recovery

Previews expire after ten minutes and are bound to the authenticated actor and
account. Provider state is re-read before apply. Stale state fails before a POST;
prepare a new preview. This is optimistic validation, not a provider-side atomic
compare-and-swap: an external panel user can still race the operation.

`MCP_CHANGE_STATE_FILE` defaults to private `data/changes.sqlite` (mode 600).
It contains previews/snapshots, receipts and account locks, so preserve it with
OAuth state across deployments; do not publish it. It uses local-disk SQLite,
not NFS/multi-host storage. Up to 200 retained changes are allowed; expired ready
previews and success/failure receipts older than seven days are pruned. Unknown
or interrupted operations are retained and continue to block that account.

A transaction reserves the account before network I/O. One provider POST is sent,
without redirects or automatic retry. Fresh provider reads verify the expected
result; public propagation remains unverified. Repeating an applied plan returns
its saved receipt, without repeating the write.

A timeout, ambiguous error, partial edit or failed post-write verification produces
`WRITE_OUTCOME_UNKNOWN`. Further writes to that account remain blocked. Inspect
the receipt and state. `get_hosting_change` with `reconcile=true` only re-reads the
provider: if the desired state is observed exactly, it records that observation,
keeps the original response marked unknown and releases the lock. It never resends
a write. Unmatched outcomes or an interrupted `applying` state require operator
investigation, including whether another process is still running. Never clear
receipts/locks just to retry. There is no automatic rollback of hosting/DNS writes.

Provider success responses, error envelopes, selectors and TTL behavior are tested
with fixtures. Live read checks are separate from mutation verification; no real
production domain or DNS change is created solely to test this feature.

Sources: [DirectAdmin domain/subdomain API](https://docs.directadmin.com/developer/api/legacy-api.html),
[DNS add/edit/select](https://docs.directadmin.com/changelog/version-1.24.2.html),
[MX full-record format](https://docs.directadmin.com/changelog/version-1.44.0.html),
[SeoHost active DNS zones](https://seohost.pl/pomoc/konfiguracja-rekordow-dns-domeny),
[Google DNS JSON API](https://developers.google.com/speed/public-dns/docs/doh/json).
