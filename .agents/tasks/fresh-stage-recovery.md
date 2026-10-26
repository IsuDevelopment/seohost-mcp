# Fresh stage recovery handoff

## Objective

Finish the owner's approved fresh independent-domain WordPress installation through
MCP, preserving provider templates and durable unknown-state semantics. Real target,
plan and account details remain in private runtime state, not this public note.

## Evidence

- Existing production 0.14.0; first exact browser/conversational-approved apply sent
  one create-domain request and stopped at creating_independent_domain, unknown.
- Read-only checks: hostname listed as an independent domain, not a parent subdomain;
  computed public_html equals the reviewed target; complete DB inventory shows the
  chosen dedicated DB absent. Domain container is a real directory, no symlink.
- Root contains index.html, six error .shtml pages and cgi-bin. No WP/DB steps ran.
- No repeated POST, cleanup, relocation, lock release or password read occurred.
- Original HTTP/application failure cause is unknown; do not infer from presence alone.

## Proposed recovery (pending explicit owner approval)

1. Review reconciliation of this exact receipt/domain/root and absence of DB/WP;
   never create the hostname a second time or silently release its account lock.
2. Preserve all provider template files/directories in verified owner-only private
   storage outside web roots, recording file metadata/checksums before any relocation.
3. Add a bounded, separately reviewed recovery path through MCP with target/receipt
   identity, template allowlist and change detection. No generic existing-site
   takeover, overwrite, arbitrary filesystem operation or blind resume.
4. Continue only missing fresh DB/WP steps under the same account reservation and
   checkpoint/approval guarantees; expose the admin password only in owner HTML.
5. Verify local completion, then report DNS/TLS/public access separately.

## Boundaries / next action

Owner must explicitly approve handling the now-existing provider files and reviewed
recovery; the fresh-empty-target approval does not authorize arbitrary takeover.
D20/D22/D25 and WORDPRESS-STAGE.md prohibit automatic unknown retries/resume/cleanup.
No recovery runtime capability has been implemented yet. Start from API evidence,
then test uncertain-create reconciliation and template preservation before deploy.
