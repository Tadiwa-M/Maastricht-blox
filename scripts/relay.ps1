# Deploy the Cloudflare Worker relay (relay/README.md): install, log in, deploy, print the URL.
# Usage: .\scripts\relay.ps1
# Native tools (npm, wrangler) print warnings on stderr; Windows PowerShell 5.1 turns those into
# terminating errors under "Stop", so this script checks exit codes instead.
$ErrorActionPreference = "Continue"
$root = Split-Path -Parent $PSScriptRoot
Push-Location (Join-Path $root "relay")
try {
  if (-not (Test-Path node_modules)) {
    npm install --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { throw "npm install failed" }
  }
  cmd /c "npx wrangler whoami >nul 2>&1"
  if ($LASTEXITCODE -ne 0) {
    npx wrangler login
    if ($LASTEXITCODE -ne 0) { throw "wrangler login failed" }
  }
  npm test
  if ($LASTEXITCODE -ne 0) { throw "relay tests failed" }
  npx wrangler deploy
  if ($LASTEXITCODE -ne 0) { throw "deploy failed" }
  Write-Host ""
  Write-Host "Deployed. Next: set the secrets (see relay/README.md), then open <url>/health."
} finally { Pop-Location }
