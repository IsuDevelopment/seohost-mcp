# Free certificates and HTTPS

Version 0.7.0 adds `get_tls_info` and two operations through the existing
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
No certificate/key deletion, paid certificate purchase, DNS-provider credentials,
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
   daily. This release does **not** trigger on-demand provisioning or install a
   background polling job. DNS, CAA, validation failures and rate limits can delay or
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
