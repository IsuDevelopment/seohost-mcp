# Independent code review handoff

Prepared for Claude or another reviewer; review has not been performed or approved.
Read the context required by [README.md](README.md) first. Verify claims against
source; accepted decisions explain intent and do not exempt code from criticism.

## Baseline and evidence

- Review target: 0.11.1, 30 MCP tools; stage diff: `git diff 7ba6257..HEAD -- src test docs .agents`.
  Historical 0.9.0 diagnostics diff: `git diff 210bfa0..HEAD -- src test docs .agents config`.
  Redirects diff: `git diff 1fef5a2..HEAD -- src test docs .agents`.
  TLS + redirects diff: `git diff c25bf96..HEAD -- src test docs .agents`.
  Deployed release: 0.11.1, commit `75c40d6`, Deploy run `40193850271`.
- Focus diff: `git diff c242a28..556b134 -- src test scripts config .env.example`.
  `c242a28` is the last pre-0.6.0 commit. Review current `main` too for later changes.
- Historical validation for this code: `npm run check`, 57 passing tests, successful
  Check/deploy and H57 read probes. See [STATUS.md](STATUS.md) for run IDs and limits.
- Provider mutations are fixture-tested, not live-verified. No production test
  domains/subdomains/records were created. Owner write OAuth consent remains a
  client action; read-token write rejection was verified live.
- Candidate validation: `npm run check`, 85 passing tests/types/build. Account/DB/
  backup metadata and one-read error summary candidate adapters passed read-only H57
  probes. Resource latest is denied; Softaculous list responses were non-JSON. No
  plugin inventory/backup job adapter is claimed. TLS and redirect
  writes use fixtures; candidate redirect adapter live H57 inventory read passed; H57 modern metadata GETs returned 200. No TLS mutation or full
  creation→issuance→redirect workflow has been verified live; 0.9.0 is deployed.
  Post-deploy SDK checks confirmed 26 tools, supported diagnostic reads, expected
  metrics denial/backup opt-in and read-token write rejection. No new private
  write operations or backup roots were enabled.
  Passing checks are not independent security certification.

Current candidate validation: 111 tests/types/build pass, including owner browser
approval, child-process secret handling, shared locks and partial failures. H57
candidate preflight and production stdio MCP planning passed without target writes.
Production discovery/auth/owner-page checks passed; H57 opt-in was separately owner
approved. No actual installation has run; provider mutations remain fixture-tested.

Patch 0.11.1: real browser testing exposed no-referrer → Origin:null on HTML
forms. Approval and OAuth pages now send strict-origin; null/cross-site rejection
and CSRF remain. 112 tests/types/build pass; browser dummy login reaches review.
No real owner credentials/approval were used or generated during this test.
CI also exposed startup housekeeping/export contention; exports now await cleanup
without weakening the concurrent-export reservation. The gated regression and full
112-test Check/Deploy passed. Fresh production planning remains awaiting approval.

## Inspection order

| Concern | Source and questions |
| --- | --- |
| Fresh stage | `wordpress-stage*.ts`, `change-store.ts`, `http.ts`: owner browser approval/CSRF/replay/expiry, same actor/host/UID, fresh target/DB, fixed child env/stdin, private credentials, pre-write checkpoints and no public readiness claim. Check unknown reservations and provider-created nonempty root handling. |
| Authorization | `auth.ts`, `local-oauth.ts`, `http.ts`, `stdio.ts`, `config.ts`: can a read grant acquire write capability? Are actor identity, consent, account allowlists and transport defaults enforced consistently? |
| Persistent execution | `hosting-changes.ts`, `change-store.ts`: trace ready → applying → applied/failed/unknown, expiry, concurrent requests, interrupted processes, actor/account binding, replay and reconciliation. Check database write/error paths, not only success cases. |
| Provider contracts | `directadmin-http.ts`, `hosting-changes.ts`: verify fixed paths/forms, application-level error handling, exact DNS selectors, TTL/TXT/MX normalization, create defaults, post-write verification and uncertain outcomes. Fixtures are not provider confirmation. |
| TLS scope and secrets | `tls.ts`, `hosting-changes.ts`, `directadmin-http.ts`: verify parent-wide consent, secret-preserving strict config handling, metadata-only reads, production-provider guard, certificate date/wildcard/all-host checks, PUT ambiguity and no premature HTTPS. Assess alias/proxy/browser-trust limitations and daily issuance/pending reporting. |
| Diagnostics and summary bounds | `account-diagnostics.ts`, `backup-inventory.ts`, `log-summary.ts`, `directadmin.ts`: self-account routes, numeric/unit/unknown semantics, fresh DB identity, private canonical backup roots/pagination, no content downloads, rare fatal preservation beyond raw-output cap, line-vs-incident counts and safe projections. Check resource/Softaculous failures remain explicit. |
| Site redirect semantics | `redirects.ts`, `hosting-changes.ts`, `directadmin-http.ts`: typed double decoding, duplicate/error handling, URL-secret projection, literal input safety, full-map verification and no destination fetches. Trace delete/add partial failure and ensure no undocumented overwrite assumption; assess prefixes/shared roots/precedence limitations. |
| DNS evidence | `domain-dns.ts`, `public-dns.ts`: verify ownership, record IDs/snapshots, in-zone names, cache/fresh semantics, bounded responses and failed/truncated answers. Recursive NS matching is not a direct authoritative/delegation/DNSSEC proof. |
| Disclosure and regressions | `server.ts`, log readers, deploy scripts: inspect error/audit payloads, token masking, untrusted metadata, read behavior, private file exclusions and state preservation. |

Use [CODEMAP.md](CODEMAP.md) to find tests for each boundary and
[DOMAIN-DNS.md](../docs/DOMAIN-DNS.md) and [TLS.md](../docs/TLS.md) / [REDIRECTS.md](../docs/REDIRECTS.md) / [HOSTING-DIAGNOSTICS.md](../docs/HOSTING-DIAGNOSTICS.md) for operator contracts.

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
