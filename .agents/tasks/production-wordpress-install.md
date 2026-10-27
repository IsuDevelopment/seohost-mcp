# Production WordPress and source-domain redirects

Owner requested a fresh production installation on an existing domain and 301
redirects from two other domains on H57. Exact domains, inspected state and upcoming
plan references stay in private ignored `.artifacts/`, never in this public note.

- Existing MCP supported only fresh staging. D30 adds the separate production plan;
  see WORDPRESS-INSTALL.md, DECISIONS and current STATUS.
- 147 tests/types/build pass. Production 0.19.1 is deployed and H57 operations are
  configured with a verified private config backup. No live redirects/WP files changed.
- Reuse prior administrator email from the owner's request; do not expose passwords.
- Live plan is ready in `.artifacts/production-install-plan.json`; the owner has
  been asked to approve its browser page. Recheck expiry/receipt; never automate
  consent or treat elapsed time as approval. `.artifacts/apply-production-install.mjs`
  is prepared but has NOT run. `.artifacts/production-redirect-intent.json` records
  exact later redirects and the retained private redirect-config backup reference.
- Once its exact owner receipt and conversational confirmation exist, apply through
  the MCP and poll with stdio alive. Only after target verification, separately plan
  and apply requested source redirect edits; retain their config backups and all
  existing source WP files/databases. Verify public HTTPS/root/path behavior.
- Existing staging must remain unchanged. No cleanup or backup deletion is approved.
