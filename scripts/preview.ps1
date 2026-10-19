# Build a world and open it in the browser viewer (no Unity needed).
# Usage:
#   .\scripts\preview.ps1                                   # regenerate + open the look-test scene
#   .\scripts\preview.ps1 build\world -Around markt         # real world: only the chunks around a place
#   .\scripts\preview.ps1 build\world -Around 22,47 -Radius 4
# Places: markt, vrijthof, brug, station, bonnefanten. Radius is in 32 m chunks (default 3 = 224 m square).
# A full 2x2 km world is too big for one page, so a real world always needs -Around.
param([string]$World = '', [string]$Around = '', [int]$Radius = 3)
$ErrorActionPreference = 'Stop'
$Root = Resolve-Path (Join-Path $PSScriptRoot '..')
if (-not $World) {
    $World = Join-Path $Root 'build\testscene'
    Push-Location (Join-Path $Root 'pipeline')
    try { uv run python -m blox_pipeline.models; uv run python -m blox_pipeline.testscene --out $World } finally { Pop-Location }
} else {
    $World = Resolve-Path $World
    if (-not $Around -and (Get-ChildItem (Join-Path $World 'chunks') -Filter *.bxc).Count -gt 100) {
        throw 'This world has more than 100 chunks: pass -Around <place> (markt, vrijthof, brug, station, bonnefanten)'
    }
}
$extra = @()
if ($Around) { $extra = @('--around', $Around, '--radius', "$Radius") }
Push-Location (Join-Path $Root 'viewer')
try {
    if (-not (Test-Path node_modules)) { npm ci --no-audit --no-fund }
    node build.mjs $World @extra
    if ($LASTEXITCODE) { throw 'viewer build failed' }
} finally { Pop-Location }
Start-Process (Join-Path $Root 'viewer\dist\index.html')
