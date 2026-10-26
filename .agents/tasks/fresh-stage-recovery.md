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

## Recovery scope approved in conversation; exact snapshot approval pending

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

Owner explicitly approved preserving these provider files and preparing controlled
continuation. The new immutable recovery snapshot needs a separate browser receipt.
D20/D22/D25 and WORDPRESS-STAGE.md prohibit automatic unknown retries/resume/cleanup.
Production 0.15.0 implements plan_wordpress_stage_recovery and existing apply integration
under D26, with 130 passing tests/types/build. Deploy 40308153399/Check 40308094388
passed; production snapshot planning verified eight files/one directory and absent
DB. Obtain exact snapshot browser approval and apply through a persistent MCP
connection. The original unknown reservation is still held. Do not
repeat domain creation or override the unknown lock.

## Latest checkpoint

Owner approved the exact recovery snapshot; apply preserved eight files in verified
private copies and originals, then stopped at creating_database/WRITE_OUTCOME_UNKNOWN.
DB exists with zero tables and one exact localhost-only user. Backup hashes and empty
root are independently verified. Old adapter rejects documented Unix SQL sockets;
H57 server metadata reports a local socket (create response was not captured).
Candidate 0.16.0 / D27 can prove the existing DB credentials and backups, then perform
only the same approved job's remaining install. No new approval scope or create POST.
134 tests pass. Deploy and invoke continue_wordpress_stage_install for the same
private runtime plan/hash via a persistent MCP client; never print credential files.

DB continuation passed credential/zero-object proofs and downloaded pinned core.
It stopped before config at verifying_core. Read-only checks proved archive paths
are full while extracted names are truncated at 100 archive bytes. Candidate 0.17.0
repairs this exact fresh download, with official archive MD5, safe system tar,
candidate/final checksums and no correct-file overwrite; 139 tests pass. Deploy,
then invoke the same continuation/plan/hash through a persistent client. No new
approval, resource creation or template movement is needed.
