# One-time setup of a Windows machine (GPU workstation or laptop) for Maastricht Blox. Safe to re-run.
# Needs NO admin rights: uv, the .NET 8 SDK and Node.js 22 are installed per user under
# %LOCALAPPDATA% and added to your user PATH. Git and Unity Hub/Unity 6 are installed by you.
param([switch]$WithBrowser)  # -WithBrowser: also download Chromium for viewer screenshots (shots.sh)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'   # Invoke-WebRequest is very slow with the progress bar
$Root = Resolve-Path (Join-Path $PSScriptRoot '..')
$Tools = Join-Path $env:LOCALAPPDATA 'Programs'

function Add-UserPath([string]$Dir) {
    $user = [Environment]::GetEnvironmentVariable('Path', 'User')
    if (($user -split ';') -notcontains $Dir) { [Environment]::SetEnvironmentVariable('Path', "$Dir;$user", 'User') }
    if (($env:Path -split ';') -notcontains $Dir) { $env:Path = "$Dir;$env:Path" }
}
function Have([string]$Cmd) { [bool](Get-Command $Cmd -ErrorAction SilentlyContinue) }

if (-not (Have git)) { throw 'git is missing: install Git for Windows (the installer has a per-user option)' }

if (-not (Have uv)) {
    Write-Host 'installing uv (per user)'
    Invoke-RestMethod https://astral.sh/uv/install.ps1 | Invoke-Expression
    Add-UserPath (Join-Path $HOME '.local\bin')
}

if (-not (Have dotnet)) {
    Write-Host 'installing .NET 8 SDK (per user)'
    $dir = Join-Path $env:LOCALAPPDATA 'Microsoft\dotnet'
    $installer = Join-Path $env:TEMP 'dotnet-install.ps1'
    Invoke-WebRequest https://dot.net/v1/dotnet-install.ps1 -OutFile $installer
    & $installer -Channel 8.0 -InstallDir $dir
    [Environment]::SetEnvironmentVariable('DOTNET_ROOT', $dir, 'User'); $env:DOTNET_ROOT = $dir
    Add-UserPath $dir
}

if (-not (Have node)) {
    Write-Host 'installing Node.js 22 (per user, portable zip)'
    $index = Invoke-RestMethod https://nodejs.org/dist/index.json
    $v = ($index | Where-Object { $_.version -like 'v22.*' } | Select-Object -First 1).version
    $zip = Join-Path $env:TEMP "node-$v-win-x64.zip"
    Invoke-WebRequest "https://nodejs.org/dist/$v/node-$v-win-x64.zip" -OutFile $zip
    Expand-Archive $zip -DestinationPath $Tools -Force
    Add-UserPath (Join-Path $Tools "node-$v-win-x64")
}

foreach ($c in 'uv', 'dotnet', 'node', 'npm') {
    if (-not (Have $c)) { throw "$c still not found: open a new PowerShell and re-run this script" }
    Write-Host "ok  $c"
}

function In([string]$Dir, [scriptblock]$Do) {  # run in a folder and always come back, even on errors
    Push-Location $Dir; try { & $Do; if ($LASTEXITCODE) { throw "failed in $Dir" } } finally { Pop-Location }
}
In "$Root\pipeline" { uv sync }
In "$Root\proxy" { uv sync }
In "$Root\viewer" { npm ci --no-audit --no-fund }
if ($WithBrowser) { In "$Root\viewer" { npx playwright install chromium } }  # only needed for automated screenshots
dotnet restore "$Root\dotnet\Blox.sln"

$gpu = Get-CimInstance Win32_VideoController | Select-Object -ExpandProperty Name
Write-Host "GPU(s): $($gpu -join ', ')"
Write-Host "`nNext:"
Write-Host '  .\scripts\check.ps1                all tests'
Write-Host '  .\scripts\preview.ps1              open the look test in the browser viewer'
Write-Host '  cd pipeline; uv run blox fetch     download AHN / 3D BAG / OSM (network needed)'
Write-Host '  .\scripts\unity.ps1 all            compile, test, build and screenshot the Unity look test'
