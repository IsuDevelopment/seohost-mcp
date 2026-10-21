# WordPress reads and first deployment

Goal: deploy the existing release and add subdomain inventory, WordPress installation
inventory and bounded reads of existing WordPress debug logs.

Plan: verify deployment credentials; implement provider reads and security tests;
update capabilities, map and decisions; check, commit, push and deploy when ready.

Completed: read project memory and private cached provider schema; confirmed the
WordPress locations and filemanager GET contracts. First deployment run passed
checks/build but stopped before SSH. The expected SSH secret is unavailable to
this repository/environment; the owner has been asked for its location/name.

Design: use provider installation IDs, not caller paths; log access requires private
configured root allowlists. Reject traversal, symlinks and non-regular files. Limit
downloads and output; never read WordPress configuration or execute shell/PHP.
Provider filemanager checks are not an atomic defense against concurrent filesystem
changes; retain this limitation explicitly in permanent documentation.

Implemented: 0.3.0 subdomain inventory, WordPress installations and opt-in log
reads, custom private log mappings, shared HTTP bounds, 28 passing tests and English
operator/agent documentation. Runtime dependency graph is unchanged.

Live preflight: production is still 0.1.0; neither configured account has hosting
credentials. A local trusted SSH deployment is an alternative to the missing
GitHub secret; preserve private configuration and OAuth state.

Next: commit/push, check CI, deploy with the trusted local connection if GitHub
secret remains unavailable, then update permanent STATUS and remove this task note.
Live hosting reads still require privately supplied Login Keys and permission checks.
