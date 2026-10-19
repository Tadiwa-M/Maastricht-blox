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
# Pick up tools winget just installed without needing a new terminal.
$env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
foreach ($c in 'uv', 'dotnet', 'node') {
    if (-not (Get-Command $c -ErrorAction SilentlyContinue)) { throw "$c still not on PATH: open a new PowerShell and re-run this script" }
}

function In([string]$Dir, [scriptblock]$Do) {  # run in a folder and always come back, even on errors
    Push-Location $Dir; try { & $Do; if ($LASTEXITCODE) { throw "failed in $Dir" } } finally { Pop-Location }
}

In "$Root\pipeline" { uv sync }
In "$Root\proxy" { uv sync }
In "$Root\viewer" { npm ci --no-audit --no-fund; npx playwright install chromium }  # browser for viewer screenshots
dotnet restore "$Root\dotnet\Blox.sln"

$gpu = Get-CimInstance Win32_VideoController | Select-Object -ExpandProperty Name
Write-Host "GPU(s): $($gpu -join ', ')"
if (-not (Test-Path 'C:\Program Files\Unity\Hub\Editor')) {
    Write-Warning 'Unity Hub not found: install Unity Hub, then Unity 6 LTS (6000.x) with Windows Build Support.'
}
Write-Host "`nNext:"
Write-Host '  .\scripts\check.ps1               all tests'
Write-Host '  .\scripts\preview.ps1             open the look test in the browser viewer'
Write-Host '  cd pipeline; uv run blox fetch   download AHN / 3D BAG / OSM (network needed)'
Write-Host '  .\scripts\unity.ps1 all          compile, test, build and screenshot the Unity look test'
