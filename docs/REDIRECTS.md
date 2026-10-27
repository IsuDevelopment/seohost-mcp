# Site redirects

Version 0.8.0 adds `list_redirects`, plus `add_redirect` and `delete_redirect` through
[planned hosting changes](DOMAIN-DNS.md). These are DirectAdmin-managed site rules,
separate from [HTTPS enforcement](TLS.md), DNS and domain registration.

## API contract and scope

Local API research was checked first. The cached modern Swagger has no site redirect
route. Official legacy documentation supplies `CMD_API_REDIRECT`:

- GET with `domain` and `apitype=yes`: a URL-encoded map from source paths to a
  second URL-encoded value containing `to` and `type`.
- POST `action=add`, `domain`, `from`, `to`, `type`.
- POST `action=delete`, `domain`, `select0=<exact source path>`.

DirectAdmin edits `.htaccess` for these rules. The MCP does not expose raw file writes.
A fresh account-owned domain check precedes every inventory read. Only complete,
bounded typed inventories with unique source paths are accepted. Public HTTP
observations and DNS do not prove a rule is managed by this API.

The read returns opaque account/domain-bound `redirectId`, source path, status,
destination and a version fingerprint. Destination credentials, query and fragment
are omitted and `destinationRedacted=true` marks that projection. Malformed or
non-HTTP(S) destinations are not returned as arbitrary provider text. IDs/snapshots
still identify the original rule. Unrelated raw destinations are not stored in
previews/receipts. Provider metadata is untrusted data.

This inventory does not enumerate arbitrary RewriteRules, WordPress/plugin redirects,
Cloudflare rules, all aliases or independent subdomain document roots. An empty
inventory means no API-listed rules, not "this site never redirects". Rules may
match path prefixes and shared document roots/aliases; overlapping rules and order
can affect behavior. Read/verification never request a destination URL or attach
hosting credentials to it. No public redirect-following/HTTP probe tool is added.

## Setup and examples

Use the existing read authorization for inventory. Writes additionally need
`mcp:write` or the separate write Bearer and exact `add_redirect` / `delete_redirect`
entries in the selected account's private `writeOperations`. Keep existing policy;
no new operation is automatically enabled during upgrade. The upstream Login Key
must permit the redirect command and domain inventory. Configuration readiness is
not proof of provider permission. Restart after private policy changes.

```json
{"name":"list_redirects","arguments":{"serverId":"primary","domain":"example.com"}}
{"name":"plan_hosting_change","arguments":{"serverId":"primary","change":{"operation":"add_redirect","domain":"example.com","from":"/old","to":"https://target.example/new","type":302}}}
{"name":"plan_hosting_change","arguments":{"serverId":"primary","change":{"operation":"delete_redirect","domain":"example.com","redirectId":"<fresh-redirect-id>"}}}
```

Review the preview and apply its `planId` / `previewHash` with the same actor/account.
Status codes must be explicit: 301, 302 or 303. Other read statuses remain visible
but are not writable. Literal source paths start with `/`; this release rejects
regexes, whitespace, percent escapes, repeated slashes and dot traversal. Destinations
are absolute HTTP(S) domain URLs without credentials, query, fragment, IP literal,
custom port or directive/control characters. Direct self-loops are rejected; longer
cycles and external redirects are not traced. 301 can persist in client/search caches.

## Editing an existing rule

No separate edit/overwrite contract was found in the official API documentation.
The adapter refuses to add over an existing source path. To change status, target or
source, an agent uses separate reviewed delete and add operations:

1. Read the exact existing rule. Confirm both operations are allowed and validate
   the desired replacement before removing anything.
2. Prepare/apply deletion using its fresh `redirectId`; inspect the receipt.
3. Refresh inventory, prepare/apply the replacement and inspect its receipt.
4. Report each result. This is non-atomic: between steps the old redirect is absent.
   If addition fails, report partial completion; do not claim the rule was updated.

Each plan independently expires after ten minutes. Fresh full rule-map snapshots
reject stale state; exact selection and full expected-map verification preserve
unrelated entries. Matching API state does not prove live HTTP behavior or rule
precedence across other rewrite sources. External panel/file changes can still race
these optimistic checks. Account reservations, persistent receipts, replay and
unknown-outcome reconciliation follow the existing change-store contract. Never
resend an uncertain POST or automatically restore a deleted rule.

Before rolling back to 0.7.0 or earlier, restore compatible private policy without
these two operation names; preserve receipts/locks. No new dependencies are required.

## Verification

H57 returned a typed redirect inventory successfully, and the candidate adapter was
run against it read-only without deploying code or copying credentials. The owner's
reported root 302 rule was found with the expected destination. No rule was changed
on a real domain for verification. Provider writes are fixture-tested, including
stale selection/state, partial edit steps, redaction, authorization, replay and
ambiguous outcomes. Candidate 0.8.0 is not deployed by this change.

Sources: [redirect API](https://docs.directadmin.com/changelog/version-1.25.0.html),
[status codes and typed inventory](https://docs.directadmin.com/changelog/version-1.28.2.html).


D30 fresh production installation is a separate, narrowly reviewed exception for
an existing provider-only target root. Its `.htaccess` must contain only exact
API-matched root Redirect directives; the immutable owner-approved installation
preserves that file in verified private copies/originals before relocation. It
verifies empty redirect inventory before new DB/core work. No arbitrary rewrite
editing is exposed. Redirects on other domains continue to use the plans above.
