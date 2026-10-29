# Independent code review handoff

Prepared for Claude or another reviewer; review has not been performed or approved.
Read the context required by [README.md](README.md) first. Verify claims against
source; accepted decisions explain intent and do not exempt code from criticism.

## Temporary artifact lifecycle (0.20.0, D31)

Review after 50dfb7d: verified-success-only deploy pruning and one private previous-code
rollback, filesystem lock, marker/ownership/no-link/private-state refusal, cleanup
outside rollback handling, and fixed verified-WP archive/extraction cleanup. Keep
originals/credentials/manifests and incomplete-job evidence. 150 tests/types/build
pass; production deployment and audited historical cleanup are pending. No generic
MCP deletion tool or new runtime dependency is introduced. See MAINTENANCE.md.

## Production root workflow (0.19.0, D30)

Focus the diff after 619caa8: distinct install_wordpress policy, strict internal
existing_domain/production target, complete root-template/managed-redirect snapshot,
owner review wording, verified private preservation and empty-root/redirect proof,
no hosting creation and normal production settings. Check rejection of existing WP,
arbitrary rewrites/files, changed snapshots and substituted stage permissions.
147 tests/types/build pass. Production 0.19.1 deployed from 12e4525 through
Deploy 40496535288 / Check 40496520123. Live read-only production planning passes;
the exact real owner receipt/chat confirmation subsequently gated a completed live
production install and source redirects. Public root/login and HTTPS 301 path/query
behavior passed; see STATUS for retained backups and reconciliation limits.

## Current reliability change (0.18.0, D29)

Focus `git diff 3f2cfaa..HEAD -- src test docs .agents`: explicit initial review of
new-target template preservation, confirmed-create-only preparation, legacy-plan
empty-root compatibility, direct bounded pinned archive streaming and shared safe
extraction/checksums, safe diagnostics and no POST retries. Per-file callbacks persist
only phase transitions, not thousands of identical SQLite checkpoints. Check that
unknown writes still retain reservations and never become generic takeover/resume.
144 tests/types/build pass. Deploy `40318949846` and Check `40318886786` succeeded
for `641446d`; independent HTTPS/SDK checks confirmed version/tools/auth boundaries. The previous approved live stage
completed on 0.17.1; the new normal path is fixture-tested, not live-tested on another
site. Historical pending/no-install statements below are superseded by STATUS.md.

## Baseline and evidence

- Review target: 0.20.0, 33 MCP tools; stage diff: `git diff 7ba6257..HEAD -- src test docs .agents`.
  Historical 0.9.0 diagnostics diff: `git diff 210bfa0..HEAD -- src test docs .agents config`.
  Redirects diff: `git diff 1fef5a2..HEAD -- src test docs .agents`.
  TLS + redirects diff: `git diff c25bf96..HEAD -- src test docs .agents`.
  Deployed release: 0.18.0, commit `641446d`, Deploy run `40318949846`; Check `40318886786` (144 tests).
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

0.12.0 review focus: separate remembered authentication from per-plan consent.
Inspect hash-only session storage, absolute eight-hour expiry, credential/origin
binding, rotation, session cap, HTTPS cookie flags and CSRF-protected logout.
Approvals must recheck the session and exact single-use plan challenge. Logout does
not revoke existing receipts. 117 tests/types/build pass; dummy real-browser login,
second-plan reuse and logout were verified without approving or changing hosting.
Production authenticated session reuse and actual installation remain unverified.

0.13.0: review hostname DB-name truncation/account prefix/random suffix and fresh
collision refusal. Inspect the HTML-only admin credential reader, file bounds,
no-symlink/owner/mode/identity checks and exclusion from all MCP receipts. Applied
receipt access after expiry must not relax ready approval/apply expiry. Check exact
static CSS CSP hash and absence of external assets. Full 120-test check and dummy
browser reveal pass; actual hosting installation/name acceptance remain unverified.

0.14.0 focus: placement defaults and persisted legacy compatibility, mode-specific
allowlists at plan/apply, absent independent container, actual document-root mapping
and no parent mutation. Polish/English links must remain presentation-only and keep
form/session/Origin/CSP protections. Full 123 tests pass; real browser used dummy
credentials only. Safe H57 config read confirmed existing create_domain permission;
independent-domain creation/installation has not run live.

0.14.0 is now deployed. Independent production SDK and public PL/EN/CSP checks
passed; real H57 preflight confirmed a ready unapproved plan for an independent
domain/container. No target was created. Post-create root mapping, provider-generated
placeholders, certificate/DNS readiness and full WordPress install remain live gaps.

2026-10-26 live apply evidence: owner browser receipt plus conversational consent
were verified before apply. The creation POST was not confirmed; the worker kept
its unknown lock and did not proceed. Subsequent read-only inventory/root checks
confirmed a created independent domain and matching computed root, absent dedicated
DB and eight provider-populated template entries. No WordPress was installed.
Investigate the unconfirmed write without assuming its cause. Recovery must preserve
provider files and get explicit owner scope; do not clear locks or bypass MCP apply.
See [recovery contract](../docs/WORDPRESS-STAGE.md).

0.15.0 focus: D26 is a narrow explicit exception, not generic unknown retry. Inspect
original receipt/phase/actor/target binding, fresh domain/root and DB-absence reads,
fixed template allowlist/bounds/UID/no-follow, source change detection, private-copy
verification before original relocation, journal retention and atomic lock transfer.
New snapshot owner receipt is mandatory; any failed recovery keeps a reservation.
130 tests/types/build pass; production recovery/backup/install remain unverified.

0.15.0 deployment and authenticated discovery passed. Production recovery planning
verified the exact original checkpoint/owner receipt, existing domain/root, absent
DB and allowlisted template hashes (eight files/one directory, 81,102 bytes). The
new snapshot approval is pending. Private backup/relocation and DB/WP execution
have not run; old unknown reservation remains held until the approved transfer.

0.16.0 review: DB creation did occur (empty DB/exact localhost user verified), and
all private template copies/originals pass SHA-256. The old adapter rejects the
Unix-socket format documented and observed in H57 SQL metadata; original response
was not retained. D27 proves the same approved job's backups/root/empty DB/local
credentials before an atomic same-reservation continuation. No new target, scope,
creation POST or broad resume. Inspect fixed PHP/SQL, secret stdin/environment,
output bounds, object/user isolation, wrong-phase/refused proof and no replay.
134 tests/types/build pass; real WP continuation remains pending deployment.

0.17.0: full cached archive contains names missing/truncated in H57 extraction.
Review official MD5/HTTPS anchor, fixed tar arguments/environment, safe archive
entry/type bounds, candidate checksum requirement, exact current-tree matching,
private artifact preservation and exclusive missing-file writes. No checksum
exclusion or correct-file overwrite. 139 tests/types/build pass.

Final live verification (2026-10-26): the approved stage is applied/completed_locally,
with exact pinned version/URL, indexing disabled and the account reservation released.
Private template copies/originals remain verified. Core repair restored 39 missing
files and retained 33 truncated artifacts; candidate and final checksums passed.
Independent HTTPS sees protected frontend 403/noindex and wp-login 200. No generated
password was read into model context. Review normal fresh-path reliability separately;
this success does not prove generic arbitrary-checkpoint resume or hostile-tenant isolation.

0.19.1 root redirect comparison normalizes safe destination URLs, exactly as provider
inventory does, but never drops the original file snapshot/hash from owner consent.
The live no-trailing-slash case is regression-tested; unknown directives still fail.
