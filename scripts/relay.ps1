# Deploy the Cloudflare Worker relay (relay/README.md): install, log in, deploy, print the URL.
# Usage: .\scripts\relay.ps1
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Push-Location (Join-Path $root "relay")
try {
  if (-not (Test-Path node_modules)) { npm install --no-audit --no-fund }
  npx wrangler whoami *> $null
  if ($LASTEXITCODE -ne 0) { npx wrangler login }
  npm test
  if ($LASTEXITCODE -ne 0) { throw "relay tests failed" }
  npx wrangler deploy
  if ($LASTEXITCODE -ne 0) { throw "deploy failed" }
  Write-Host ""
  Write-Host "Deployed. Next: set the secrets (see relay/README.md), then open <url>/health."
} finally { Pop-Location }
