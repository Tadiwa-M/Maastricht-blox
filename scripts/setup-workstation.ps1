# One-time setup of a Windows machine (GPU workstation or laptop) for Maastricht Blox. Safe to re-run.
# Prerequisites it checks (install manually if missing): git, Unity Hub + Unity 6 LTS.
# It installs via winget when missing: uv, .NET 8 SDK, Node.js 22.
$ErrorActionPreference = 'Stop'
$Root = Resolve-Path (Join-Path $PSScriptRoot '..')

function Need([string]$Cmd, [string]$WingetId) {
    if (Get-Command $Cmd -ErrorAction SilentlyContinue) { Write-Host "ok  $Cmd"; return }
    if (-not $WingetId) { throw "$Cmd is missing: install it first" }
    Write-Host "installing $Cmd ($WingetId)"
    winget install --id $WingetId -e --accept-source-agreements --accept-package-agreements
}
Need git ''
Need uv 'astral-sh.uv'
Need dotnet 'Microsoft.DotNet.SDK.8'
Need node 'OpenJS.NodeJS.LTS'
Write-Host 'Refresh PATH (open a new terminal) if anything was just installed.'

Push-Location "$Root\pipeline"; uv sync; Pop-Location
Push-Location "$Root\proxy"; uv sync; Pop-Location
Push-Location "$Root\viewer"; npm ci --no-audit --no-fund; npx playwright install chromium; Pop-Location  # browser for viewer screenshots
dotnet restore "$Root\dotnet\Blox.sln"

$gpu = Get-CimInstance Win32_VideoController | Select-Object -ExpandProperty Name
Write-Host "GPU(s): $($gpu -join ', ')"
if (-not (Test-Path 'C:\Program Files\Unity\Hub\Editor')) {
    Write-Warning 'Unity Hub not found: install Unity Hub, then Unity 6 LTS (6000.x) with Windows Build Support.'
}
Write-Host "`nNext:"
Write-Host '  bash scripts/check.sh            (Git Bash) all tests'
Write-Host '  cd pipeline; uv run blox fetch   download AHN / 3D BAG / OSM (network needed)'
Write-Host '  .\scripts\unity.ps1 all          compile, test, build and screenshot the Unity look test'
