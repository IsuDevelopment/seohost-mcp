#!/usr/bin/env bash
# Invoked over SSH by the deployment workflow, for an existing CloudLinux app.
set -euo pipefail
umask 077
app_root=${1:?Missing app root relative to HOME}
node_bin=${2:?Missing absolute Node.js executable}
release=${3:?Missing transfer ID}
[[ "$app_root" =~ ^[a-zA-Z0-9_/-]+$ && "$app_root" != /* && "$app_root" != */ && "$app_root" != *//* ]] || exit 1
[[ "$node_bin" =~ ^/[a-zA-Z0-9_./-]+$ && "$release" =~ ^[0-9]+-[0-9]+$ ]] || exit 1
app="$HOME/$app_root"
transfer="$HOME/.seohost-mcp-deploy/$release"
test -d "$app"
test -f "$app/.env"
test -L "$app/node_modules"
test -x "$node_bin"
selector=$(command -v cloudlinux-selector)
mkdir "$transfer/stage"
tar -xzf "$transfer/bundle.tar.gz" -C "$transfer/stage"
stage="$transfer/stage"
"$node_bin" "$stage/scripts/check-runtime-dependencies.mjs" "$stage/package-lock.json" "$app"
"$node_bin" --check "$stage/deploy/start.cjs"
for path in dist scripts deploy package.json package-lock.json; do
  test -e "$app/$path"
  test ! -L "$app/$path"
done
test ! -L "$app/deploy/start.cjs"
# Never include .env, data, config or the hosting-owned node_modules link.
tar -czf "$transfer/rollback.tar.gz" -C "$app" dist scripts deploy/start.cjs package.json package-lock.json
restart_app() {
  "$selector" restart --json --interpreter nodejs --app-root "$app_root" > "$transfer/restart.json" &&
    "$node_bin" -e 'const fs=require("node:fs"); if(JSON.parse(fs.readFileSync(process.argv[1],"utf8")).result!=="success") process.exit(1)' "$transfer/restart.json"
}
rollback() {
  trap - ERR INT TERM
  echo 'Deploy failed; restoring the previous application code.' >&2
  rm -rf -- "$app/dist" "$app/scripts"
  if tar -xzf "$transfer/rollback.tar.gz" -C "$app" && restart_app; then
    echo 'Previous code restored and restart requested. Check HTTPS status.' >&2
  else
    echo 'Rollback needs attention in the Node.js hosting panel.' >&2
  fi
  exit 1
}
trap rollback ERR INT TERM
cp -a "$stage/dist/." "$app/dist/"
cp -a "$stage/scripts/." "$app/scripts/"
cp "$stage/deploy/start.cjs" "$app/deploy/start.cjs"
cp "$stage/package.json" "$stage/package-lock.json" "$app/"
restart_app
cd "$app"
version=$("$node_bin" -p 'JSON.parse(require("node:fs").readFileSync("package.json","utf8")).version')
"$node_bin" --env-file=.env "$stage/deploy/verify.mjs" "$version"
# Existing Bearer installations additionally exercise the real MCP SDK.
"$node_bin" --env-file=.env --input-type=module -e 'if(process.env.MCP_AUTH_TOKEN) await import("./scripts/smoke.mjs"); else console.log("OAuth-only installation: authenticated smoke requires a client token")'
trap - ERR INT TERM
printf '%s\n' "$release" > "$app/.mcp-deploy-release"
echo 'PASS: deployment completed; private runtime configuration and state preserved.'
