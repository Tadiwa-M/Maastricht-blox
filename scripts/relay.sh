#!/usr/bin/env bash
# Deploy the Cloudflare Worker relay (relay/README.md): install, log in, deploy.
set -euo pipefail
cd "$(dirname "$0")/../relay"
[ -d node_modules ] || npm install --no-audit --no-fund
npx wrangler whoami >/dev/null 2>&1 || npx wrangler login
npm test
npx wrangler deploy
echo "Deployed. Next: set the secrets (see relay/README.md), then open <url>/health."
