# Codex and Claude workflow

## Before a change

- Read the context linked from the agent README. Check `git status --short --branch`
  and existing changes; preserve work by the user and other agents.
- Identify the problem, expected behavior, affected modules and security risks.
  Challenge approaches that weaken security or make extension harder.
- Read only relevant files. Never copy private configuration, OAuth state or logs
  into chat, documentation or commits.
- API documentation is the first source for provider work: read local `docs/api/`
  topic notes, endpoint/model files and cached Swagger before external research,
  UI inspection or implementation. See the agent README for entry points. Compare
  with the server's current `/static/swagger.json` and official legacy/plugin docs
  when needed. Documented routes, authentication, parameters, response/error shapes
  and effect scope come before safe read verification, then implementation/tests.
  UI availability is not an API contract. Do not guess write routes, selector slots
  or interchangeable native/plugin behavior. Ask for missing documentation only
  after checking the local research and official sources; record any concrete gap.

## Implementation

- Make the smallest coherent change. Keep MCP transport, account selection,
  the DirectAdmin adapter and authentication separate. Add abstractions only
  when a concrete requirement justifies them.
- New tool: input schema and registration in `src/server.ts`, account rules in
  `src/config.ts`, provider I/O in the responsible adapter shown in CODEMAP and
  fixed routes in `src/directadmin-http.ts`. Test behavior and
  security boundaries rather than mirroring the implementation.
- Hosting writes or multiple users require a decision about operation scopes
  and account permissions first. MCP annotations do not enforce authorization.

## Review project memory for every change

Features, fixes, refactors, dependencies, configuration, CI and documentation all
require a context review. Update affected documents in the same commit as the
change. Do not edit every file mechanically or record a no-op review for a typo.

- `CODEMAP.md`: update when responsibilities, entry points, important tests or
  flows change. Keep it at module level; use code search for functions and classes.
- `ARCHITECTURE.md`: update when boundaries, invariants or extension rules change.
- `DECISIONS.md`: add or supersede a decision when contracts, architecture,
  security or deployment policy change. Record context, choice, rationale and
  consequences. A wording fix does not need an architectural decision.
- `STATUS.md`: update when capabilities, verification, blockers or next steps
  change. Keep current state and a few useful handoff entries, not a work diary.
  Distinguish historical test results from checks for the current change.
- `CAPABILITIES.md`: update when tools, parameters, prerequisites, permissions,
  limitations or development operations change. Check against registrations and scripts.
- Update relevant `docs/`, README and examples when behavior or setup changes.
  Write documentation and agent instructions in English.
- Do not infer production deployment from a passing build, CI run or push.

## Work spanning sessions

When a task needs a durable handoff, create `.agents/tasks/<task-name>.md` with:
objective, short plan, completed work, verification, open questions and next step.
Keep it concise, use repository-relative paths and exclude private information.
Keep lasting decisions and architecture in their dedicated documents; link them
instead of copying them into the task. On completion, move useful context to
permanent documents and remove the temporary task file.
Do not create task notes for small changes completed in one session.

## Verification and handoff

For SeoHost operations, use the existing per-host SSH key and strict host-key
verification. Reuse an SSH connection for batches rather than opening one per file;
avoid bursts of HTTP probes. Never read or print the production `.env`, replace the
hosting-managed dependency symlink, or restart another application. Keep backups
private and outside the web root. Follow the project-specific manual deployment
contract in `docs/GITHUB-ACTIONS.md`; WordPress deploy triggers do not apply here.

1. For code, dependency or deployment changes, run `npm run check` (types, tests,
   build). For documentation-only changes, check links and consistency with code.
2. Review `git diff --check` and the diff, including `git diff --cached` before
   committing. Stage explicit paths; never force-add ignored files.
3. Confirm exclusions for `.env*` except `.env.example`, `config/servers.json`,
   `data/`, private notes, `docs/api/`, `plugins/` and generated artifacts.
4. Describe the result and reason in the commit. A push is separate from deployment;
   run the production workflow only within an authorized deployment task.
5. Report the change, verification, commit/push status and remaining limitations.
