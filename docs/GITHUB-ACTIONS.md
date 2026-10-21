# GitHub Actions

`Check` runs TypeScript checks, integration tests and the build on pushes and pull requests.
`Deploy MCP` is a separate, manually started workflow. Select `main` in
Actions → Deploy MCP → Run workflow. Other branches cannot deploy.

## One-time setup

The CloudLinux Node.js application must already exist and run successfully. Set its
startup file to `deploy/start.cjs`. Keep a private mode-600 `.env` in the app root,
with a production HTTPS `MCP_PUBLIC_URL` and the existing account/OAuth configuration.
The hosting user must have SSH access and permission to restart this application
using `cloudlinux-selector`. No root privileges are used.

Create the GitHub environment `production` in repository Settings → Environments.
Add these environment secrets:

| Secret | Value |
| --- | --- |
| `SEOHOST_SSH_HOST` | SSH hostname, without protocol or port |
| `SEOHOST_SSH_PORT` | SSH port |
| `SEOHOST_SSH_USER` | Hosting SSH username |
| `SEOHOST_SSH_PRIVATE_KEY` | Dedicated deployment private key; authorize its public key on the hosting account |
| `SEOHOST_SSH_KNOWN_HOSTS` | Trusted OpenSSH known_hosts entry for that hostname and port |

Verify the SSH host key fingerprint through the hosting provider or an existing
trusted connection. The workflow requires strict host key verification; it does
not trust a key collected automatically during deployment.

Add these environment variables:

| Variable | Example |
| --- | --- |
| `SEOHOST_APP_ROOT` | `node-apps/seohost-mcp` (relative to hosting HOME) |
| `SEOHOST_NODE_BIN` | `/home/your-user/nodevenv/node-apps/seohost-mcp/22/bin/node` (existing executable) |

Use a dedicated deployment key. OAuth credentials and DirectAdmin Login Keys stay
on the server; GitHub needs only the SSH connection credentials above.

## What a deployment does

1. Installs locked build dependencies on the GitHub runner, runs `npm run check`, and builds TypeScript.
2. Packages only compiled application code, runtime package manifests, startup and helper scripts.
3. Transfers the archive over SSH into a mode-700 private directory under hosting HOME.
4. Checks that the installed production dependency graph matches the candidate lockfile.
5. Saves a private backup of the previous code, copies the release and restarts only the configured application.
6. Checks the expected version at HTTPS `/healthz` and verifies that `/mcp` without credentials returns 401.
7. If a Bearer token is configured in the server `.env`, runs the real MCP SDK smoke test without printing it.

The archive excludes `.env`, account configuration, OAuth SQLite state, source tests
and `node_modules`. Deployments leave the host-managed dependency symlink intact.
The account config already on the server is preserved, including installations
that use `config/servers.example.json`. Public example changes are never deployed
over that file. Local OAuth state is never replaced or restored from a code backup.

This first workflow supports code updates with unchanged production dependencies.
A runtime dependency change requires a manual deployment and hosting-panel dependency
installation before this workflow can resume. Development dependency changes are allowed.
An OAuth-only installation still needs an authenticated client test separately.

## Failure and rollback

Failed tests, SSH verification or dependency checks stop before changing application code.
After copying begins, a failed restart or smoke test restores the previous code
and requests another restart. The workflow stays failed so the incident is visible.
An interrupted SSH session, unavailable hosting or a failed rollback may still need
the Node.js panel; this does not provide zero-downtime deployments or automatic database rollback.

Release archives, restart results and the code backup remain private under
`~/.seohost-mcp-deploy/<run-id>-<attempt>/`. Retain the backup needed for recovery;
remove older transfer directories periodically to avoid exhausting disk space.

The workflow is ready for configuration; a successful production SSH deployment
must be verified after the secrets and variables have been supplied.

CloudLinux CLI reference: https://docs.cloudlinux.com/cloudlinuxos/command-line_tools/#node-js-selector
