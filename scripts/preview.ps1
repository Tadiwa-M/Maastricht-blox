# Build the look-test world and open it in the browser viewer (no Unity needed).
# Usage: .\scripts\preview.ps1 [worldDir]   (default: build\testscene, regenerated each run)
param([string]$World = '')
$ErrorActionPreference = 'Stop'
$Root = Resolve-Path (Join-Path $PSScriptRoot '..')
if (-not $World) {
    $World = Join-Path $Root 'build\testscene'
    Push-Location (Join-Path $Root 'pipeline')
    uv run python -m blox_pipeline.models
    uv run python -m blox_pipeline.testscene --out $World
    Pop-Location
}
Push-Location (Join-Path $Root 'viewer')
if (-not (Test-Path node_modules)) { npm ci --no-audit --no-fund }
node build.mjs $World
Pop-Location
Start-Process (Join-Path $Root 'viewer\dist\index.html')
