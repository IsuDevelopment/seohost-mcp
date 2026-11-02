# Free certificates and HTTPS

Version 0.7.0 introduced `get_tls_info` and two operations through the existing
`plan_hosting_change` → `apply_hosting_change` contract. All calls select an explicit
account and an owned **parent domain**. Standard SeoHost shared hosting is the target.

## Read and configure

```json
{"name":"get_tls_info","arguments":{"serverId":"primary","domain":"example.com","hostname":"stage.example.com"}}
{"name":"plan_hosting_change","arguments":{"serverId":"primary","change":{"operation":"set_free_certificate","domain":"example.com","enabled":true,"scope":"domain_and_all_subdomains"}}}
{"name":"plan_hosting_change","arguments":{"serverId":"primary","change":{"operation":"set_https_redirect","domain":"example.com","enabled":true,"scope":"domain_and_all_subdomains"}}}
```

`hostname` is optional and must be the parent or a listed subdomain. It reports
coverage; it does not narrow a write. Both changes require `mcp:write` (or the
separate write Bearer) and their exact operation in the account's private
`writeOperations`. Keep existing operations; add only those the owner authorizes:

```json
{"writeOperations":["set_free_certificate","set_https_redirect"]}
```

Restart after private configuration changes. Defaults remain disabled. Existing
read grants do not gain write access. Before rolling back to 0.6.0, restore compatible
configuration without these new operation names; preserve receipts and locks.

- `set_free_certificate`, `enabled=true`: enable production Let's Encrypt automatic
  issuance/renewal. Existing ZeroSSL/staging configuration blocks enabling rather
  than silently switching providers. An empty provider becomes explicit production
  Let's Encrypt. SSL support must already be enabled (new hosted domains enable it).
- `enabled=false`: disable domain ACME issuance/renewal. Retain installed certificates,
  TLS support, redirects and HSTS. A retained certificate can eventually expire.
- `set_https_redirect`: toggle DirectAdmin's parent-domain `force_ssl` setting.
  It does not modify document roots, `private_html` symlinks, HSTS or certificates.
  Disabling redirects leaves browser HSTS policies effective.

These are **parent-wide settings**, affecting current/future children and provider
aliases. No child-only toggle is implemented. A request for one subdomain does not
implicitly authorize changing siblings: explain the concrete parent-wide scope first.
No explicit certificate/key deletion, paid certificate purchase, DNS-provider credential edits,
CA account management or global/server certificate operation is exposed.

## Creation with certificates

When the user explicitly requests a new domain/subdomain with a free certificate
and HTTPS, the agent chains separate reviewed plans:

1. Create hosting with the existing create operation; confirm its receipt.
2. Inspect `get_tls_info` on the parent. For a child, establish authorization for the
   parent-wide effects before changing its settings. Existing suitable ACME/redirect
   settings may already satisfy the request; do not toggle them unnecessarily.
3. Enable free certificates if needed. Preserve DNS-provider configuration, secret
   environment values, wildcard preference, key type and exclusions unchanged.
4. Recheck certificate metadata. DirectAdmin automatically checks ACME-enabled domains
   daily. Version 0.21.0 can make a separately authorized immediate request with
   `provision_certificates`; no background polling job is installed. DNS, CAA, validation failures and rate limits can delay or
   prevent issuance. Diagnose DNS contextually, at its active provider; do not infer
   Cloudflare proxy/encryption mode from NS or overwrite external DNS.
5. Enable HTTPS only after `redirectReady=true`. If pending, report the completed
   hosting/ACME steps and remaining HTTPS step; resume with a fresh plan once ready.
   Do not busy-poll, claim a certificate is issued from an ACME-setting receipt, or
   roll back the created hosting automatically.

This is an agent workflow, not an atomic create+certificate transaction. Each step
has its own ten-minute preview, receipt and current allowlist check. Unknown writes
block further changes until explicit read-based reconciliation or operator review;
never resend to work around a timeout. See [change recovery](DOMAIN-DNS.md).

## Evidence and safety limits

`get_tls_info` uses modern ACME/certificate **metadata** routes. It never reads
`CMD_API_SSL` or certificate `/files`, which can expose private keys. DNS-provider
secrets remain in memory only while preserving ACME configuration; previews, SQLite
receipts, audit events and errors contain no such values. A config fingerprint
includes them so changes invalidate the preview. Unknown config fields fail closed
rather than being discarded during PUT. Provider responses remain untrusted data.

HTTPS enablement requires SSL enabled, domain not suspended, no provider-reported
missing names, and provider-valid certificates covering the parent, `www`, every
listed child and each child's `www` host. Wildcards match exactly one label. Dates
must cover now with at least five minutes remaining; validation errors/missing
certificate metadata block enabling. This conservative check can block unused www
hosts or missing non-web names. Aliases/proxy configuration still need operator
review: this is **not** verification of the served chain, browser trust, public
reachability or Cloudflare mode. No HTTP/TLS probes target DNS-returned addresses.

H57 modern metadata GETs returned HTTP 200; provider mutations are fixture-tested,
not live-tested on a production domain. H93 is deferred. No runtime dependency
change is required. Deployment and private operation enablement are separate steps.

Sources: [DirectAdmin ACME behavior](https://docs.directadmin.com/webservices/ssl/ssl-and-letsencrypt-for-domains.html),
[force_ssl scope and form](https://docs.directadmin.com/changelog/version-1.55.0.html#force-ssl-for-easy-apache-nginx-redirection-to-https-templates-skins-new).
Modern route/schema contracts were checked against H57's account API specification;
private API snapshots are intentionally excluded from Git.

## Immediate certificate provisioning (0.21.0)

`provision_certificates` is a new exact account write operation, exposed through the
existing plan/apply/receipt tools (tool count stays 33). Append that operation to the
authorized account's private `writeOperations`; do not replace unrelated policies.
It is disabled by default and needs ordinary write scope plus the exact parent-wide
scope acknowledgement. Rollback to older code requires removing the new operation
name from configuration first. Deployment and policy enablement remain separate.

```json
{"name":"plan_hosting_change","arguments":{"serverId":"primary","change":{"operation":"provision_certificates","domain":"example.com","scope":"domain_and_all_subdomains"}}}
```

Show the exact requests/names and warnings, then apply the reviewed `planId` and
`previewHash`. The existing requirement to obtain authorization for parent-wide
effects still applies; a child-only request does not authorize changing siblings.

The plan refreshes ownership, SSL/ACME configuration and certificate metadata, then
uses fixed `POST /api/domain-tls/{domain}/provision-certs-dry-run`. It refuses disabled
SSL/ACME, suspended domains, staging CA, in-progress issuance, provider rate limits,
CAA/challenge failures, duplicate or out-of-domain pending requests and any proposed
obsolete-certificate removal. When no requests remain, it returns
`CERTIFICATE_ALREADY_READY`: inspect metadata instead of requesting redundant issuance.
Existing exclusion lists are shown/preserved; no settings are silently changed.

Apply repeats the preview and checks its fingerprint, consumes the durable account
reservation, then sends **one** fixed `POST /api/domain-tls/{domain}/provision-certs`
without caller body, paths, redirects or retries. It uses existing CA/DNS/account
configuration, including EAB secrets, without rewriting it. The request can take up
to 120 seconds; allow at least 180 seconds at the client/proxy where possible.
Timeout/disconnection does not prove failure: inspect the stored receipt.

A success response alone is insufficient. Fresh metadata must prove valid coverage
of the planned names, retained existing certificate identities, unchanged ACME
configuration and unchanged hosting/redirect/HSTS/subdomain state, with no conflicting
missing-name report. Results state `verified_for_planned_names`, not browser trust or
coverage of excluded aliases. Public HTTPS needs its own normal TLS verification.
No DNS, document-root, redirect or HSTS change is included.

Documented 401/403/404/409/490/491 no-start rejections record a failed plan and release
its reservation. Other status/errors, oversized or malformed responses, partial
failures, missing coverage and ambiguous outcomes stay unknown/locked without
resending. Read-only reconciliation can prove the planned state later. Unexpected
certificate removals or unapproved request scope require operator review and cannot
be automatically reconciled merely because coverage looks valid. Never delete a
receipt or lock just to retry.

Provider response bodies are bounded to 512 KiB. Raw provisioning output/logs are
discarded before results or SQLite persistence; only validated certificate request
metadata, counts and failed DNS names may be returned. ACME reads now accept the
current optional `externalAccountKeyID` and `externalAccountHMAC` fields, preserve
them in memory for existing settings writes, fingerprint them for stale checks and
project only their configured/not-configured flag. Unknown ACME fields still fail
closed instead of being silently dropped.

The current public H57 Swagger was re-read on 2026-11-02 and confirms these routes,
no-body POSTs, EAB fields and response models (renamed since the private October
snapshot). A read-only provider dry-run succeeded for the owner-requested domain.
It reported an already fulfilled certificate; independent metadata and normal
HTTPS verification confirmed that automatic issuance had completed and returned
HTTP 200. No live manual issuance, private key read or ACME/policy edit was performed.
Immediate write/uncertainty behavior is covered by provider fixtures and real SDK
tests; full live manual issuance remains a separately authorized operation.
