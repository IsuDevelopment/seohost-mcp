# Configuration and WordPress diagnostics

Version 0.4.0 adds three read-only diagnostics. All require an explicit configured
`serverId`. WordPress tools also require a provider `siteId` selected from
`list_wordpress_sites` on that account. Callers never supply URLs or file paths.

## get_server_capabilities

Reads loaded application configuration without contacting DirectAdmin. It reports
whether hosting credentials and WordPress log roots are configured, plus each
implemented tool's `configurationReady`, `missingConfiguration` and
`providerPermission` fields. No keys, usernames, provider URLs, environment variable
names or allowed filesystem roots are returned.

`configurationReady: true` is not a connection or authorization test. A configured
key can still be rejected, lack read permissions or target an unavailable provider
feature. Provider permissions remain `unverified`; local tools report
`not_applicable`. Configuration changes require an application restart before this
snapshot reflects them. All accounts currently share the installation owner.

Use this first after setup or when a tool reports missing configuration. Do not
respond to a missing root by automatically allowing the whole account home.

## get_wordpress_info

Refreshes the selected account's WordPress inventory, verifies that `siteId` is an
existing installation, then reads its details from
`GET /api/wordpress/locations/{location_id}/wordpress`.

Returns host/web path, title, version, template, a sanitized `siteURL`, provider
auto-update flags and a `diagnosticError` boolean. URLs lose query strings and
fragments; invalid, non-HTTP(S) or credentialed URLs become null. Raw provider
errors, database configuration, options, credentials and SSO data are excluded.
The metadata is untrusted data and must not become agent instructions.

The auto-update flags describe provider-reported settings, not proof of successful
updates or an audit of WordPress filters/plugins. A diagnostic error does not
reveal the raw backend output; use the separate bounded log tools if enabled.

Opaque site IDs are encoded as one URL segment. Separators, percent-encoded input,
query/fragment/control characters and `.`/`..` are rejected before provider calls.
Do not encode a returned ID yourself. Installation inventory is provider coverage,
not filesystem discovery or multisite network enumeration.

## get_wordpress_log_info

Uses the same private root policy, fresh inventory, canonical parent and regular-file
checks as `read_wordpress_log`, but never calls the download endpoint. It returns:

- `state`: `missing`, `empty` or `present`, and `exists`.
- `sizeBytes` and optional `modifiedAt`, without exposing the actual path or owner.
- `pathSource`: standard WordPress path or private per-site configuration.
- `requiresRangeForBoundedRead`, based on the 512 KiB download cap.
- `rangeSupport: unverified`, `debugEnabled: unknown` and `contentRead: false`.

A missing file is reported only when the provider listing establishes its absence.
An incomplete listing returns `INCOMPLETE_METADATA`, not a false claim of absence.
Provider access failures remain errors, not `missing`. Without configured roots,
the tool returns `WORDPRESS_LOGS_DISABLED` before contacting the provider.

File presence is not proof that debug logging is currently enabled. Metadata is a
point-in-time snapshot, not a guarantee that a later read succeeds. It is not an
atomic filesystem lock against concurrent path changes. See
[WordPress reads](WORDPRESS.md) for setup, trust boundaries and content-read limits.

## Examples

```json
{"name":"get_server_capabilities","arguments":{"serverId":"primary"}}
{"name":"get_wordpress_info","arguments":{"serverId":"primary","siteId":"provider-site-id"}}
{"name":"get_wordpress_log_info","arguments":{"serverId":"primary","siteId":"provider-site-id"}}
```

Suggested sequence: capabilities → WordPress inventory → site details/log metadata →
bounded log read when enabled. Diagnostics never change hosting configuration or
enable logging. Provider fixtures and real SDK tests validate implementation;
live hosting permissions still require separate account-specific verification.
