# Domain and DNS workflow

Objective: domain details, hosted-zone reads, contextual public DNS diagnostics,
then planned domain/subdomain creation and individual DNS record changes.

Implementation plan:
1. Provider reads and fixed-target public resolver; no lookups in log/list tools.
2. Separate write authorization, per-account operation allowlist and persistent,
   actor-bound, expiring previews with stale checks and no blind write retries.
3. Provider mutation adapters, bounded validation, tests, English memory/docs.
4. Deploy H57, verify reads and rejection with existing read-only tokens. Do not
   create arbitrary production test domains or change production DNS for testing.

Evidence: H57 authenticated GET domain settings and JSON DNS records work.
DNS records have type/name/value/combined/ttl; account NS configuration exists.
H93 remains deferred. No hosting writes have been performed.

Completed: 18 tools in candidate 0.6.0; domain/DNS reads, fixed DoH lookup/cache,
scoped local/external/Bearer access, persistent previews/locks/receipts, five planned
operations and reconciliation. Local check passed 57 tests before final doc fixes.
English docs/memory updated. Existing production is still 0.5.0; no writes performed.

Next: final check/review, push and deploy 0.6.0, verify H57 provider reads, public
DNS and rejection through the old read token. Configure H57 operation allowlist
and trusted NS only after the new schema is deployed; restart only MCP. Verify
new OAuth discovery. Do not create production test records/domains without an
explicit concrete target. Then record verification and remove this temporary note.
