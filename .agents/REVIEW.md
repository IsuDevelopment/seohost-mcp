# Independent code review handoff

Prepared for Claude or another reviewer; review has not been performed or approved.
Read the context required by [README.md](README.md) first. Verify claims against
source; accepted decisions explain intent and do not exempt code from criticism.

## Baseline and evidence

- Candidate: 0.8.0, 20 MCP tools; redirects diff: `git diff 1fef5a2..HEAD -- src test docs .agents`.
  TLS + redirects diff: `git diff c25bf96..HEAD -- src test docs .agents`.
  Deployed release: 0.6.0, feature commit `556b134`.
- Focus diff: `git diff c242a28..556b134 -- src test scripts config .env.example`.
  `c242a28` is the last pre-0.6.0 commit. Review current `main` too for later changes.
- Historical validation for this code: `npm run check`, 57 passing tests, successful
  Check/deploy and H57 read probes. See [STATUS.md](STATUS.md) for run IDs and limits.
- Provider mutations are fixture-tested, not live-verified. No production test
  domains/subdomains/records were created. Owner write OAuth consent remains a
  client action; read-token write rejection was verified live.
- Candidate validation: `npm run check`, 74 passing tests/types/build. TLS and redirect
  writes use fixtures; candidate redirect adapter live H57 inventory read passed; H57 modern metadata GETs returned 200. No TLS mutation or full
  creation→issuance→redirect workflow has been verified live; 0.8.0 is not deployed.
  Passing checks are not independent security certification.

## Inspection order

| Concern | Source and questions |
| --- | --- |
| Authorization | `auth.ts`, `local-oauth.ts`, `http.ts`, `stdio.ts`, `config.ts`: can a read grant acquire write capability? Are actor identity, consent, account allowlists and transport defaults enforced consistently? |
| Persistent execution | `hosting-changes.ts`, `change-store.ts`: trace ready → applying → applied/failed/unknown, expiry, concurrent requests, interrupted processes, actor/account binding, replay and reconciliation. Check database write/error paths, not only success cases. |
| Provider contracts | `directadmin-http.ts`, `hosting-changes.ts`: verify fixed paths/forms, application-level error handling, exact DNS selectors, TTL/TXT/MX normalization, create defaults, post-write verification and uncertain outcomes. Fixtures are not provider confirmation. |
| TLS scope and secrets | `tls.ts`, `hosting-changes.ts`, `directadmin-http.ts`: verify parent-wide consent, secret-preserving strict config handling, metadata-only reads, production-provider guard, certificate date/wildcard/all-host checks, PUT ambiguity and no premature HTTPS. Assess alias/proxy/browser-trust limitations and daily issuance/pending reporting. |
| Site redirect semantics | `redirects.ts`, `hosting-changes.ts`, `directadmin-http.ts`: typed double decoding, duplicate/error handling, URL-secret projection, literal input safety, full-map verification and no destination fetches. Trace delete/add partial failure and ensure no undocumented overwrite assumption; assess prefixes/shared roots/precedence limitations. |
| DNS evidence | `domain-dns.ts`, `public-dns.ts`: verify ownership, record IDs/snapshots, in-zone names, cache/fresh semantics, bounded responses and failed/truncated answers. Recursive NS matching is not a direct authoritative/delegation/DNSSEC proof. |
| Disclosure and regressions | `server.ts`, log readers, deploy scripts: inspect error/audit payloads, token masking, untrusted metadata, read behavior, private file exclusions and state preservation. |

Use [CODEMAP.md](CODEMAP.md) to find tests for each boundary and
[DOMAIN-DNS.md](../docs/DOMAIN-DNS.md) and [TLS.md](../docs/TLS.md) / [REDIRECTS.md](../docs/REDIRECTS.md) for operator contracts.

## Review execution and output

Use isolated fixtures and local tests. Do not read production `.env`, publish
private configuration/logs, clear state locks or mutate production to prove a finding.
An independent review should report findings before making implementation changes,
unless the owner specifically asks for fixes.

For each finding include severity, repository file/line, concrete trigger,
observable impact, evidence/reproduction and a suggested focused regression test.
Distinguish a confirmed bug from a provider assumption or a documented limitation
that still needs risk assessment. State unresolved verification gaps even if no
bugs are found; passing tests alone do not establish correctness.
