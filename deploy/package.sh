#!/usr/bin/env bash
set -euo pipefail
root=$(cd "$(dirname "$0")/.." && pwd)
output=${1:?Usage: bash deploy/package.sh /absolute/path/bundle.tar.gz}
[[ "$output" = /* ]] || { echo 'Use an absolute output path' >&2; exit 1; }
test -f "$root/dist/src/http.js"
mkdir -p "$(dirname "$output")"
# An allowlist keeps credentials, OAuth state and account configuration out of releases.
tar -czf "$output" -C "$root" dist/src package.json package-lock.json \
  deploy/start.cjs deploy/verify.mjs scripts/smoke.mjs scripts/smoke-hosting.mjs scripts/smoke-oauth.mjs \
  scripts/setup-hosting.mjs scripts/setup-oauth.mjs scripts/download-database.mjs scripts/check-runtime-dependencies.mjs scripts/cleanup-deploy.mjs
