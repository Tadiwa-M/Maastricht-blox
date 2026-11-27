# (Re)creates the two desktop shortcuts. Safe to re-run after a rebuild; it overwrites only these two.
#   "Maastricht Blox"          -> scripts\play.ps1: the web game (title, trailer, loading screen, looks) in an app window
#   "Maastricht Blox (Unity)"  -> the Unity player build on build\world_maastricht (real lighting; features ported over time)
#   .\scripts\desktop-icons.ps1 [-World build\world_maastricht]
# Needs: build\site_maastricht (scripts\site.ps1; refresh its code with: cd viewer; node build.mjs --viewer-only ..\build\site_maastricht)
#        unity\Builds\StandaloneWindows64\MaastrichtBlox.exe (scripts\unity.ps1 build)
param([string]$World = '')
$ErrorActionPreference = 'Stop'
$Root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
if (-not $World) { $World = Join-Path $Root 'build\world_maastricht' }
$World = (Resolve-Path $World).Path
$icons = Join-Path $Root 'build\icons'

Push-Location (Join-Path $Root 'pipeline')   # Pillow lives in the pipeline environment
try { uv run python ..\scripts\make_icon.py $icons | Out-Null; if ($LASTEXITCODE) { throw 'icon generation failed' } } finally { Pop-Location }

$desktop = [Environment]::GetFolderPath('Desktop')
$shell = New-Object -ComObject WScript.Shell

function New-Shortcut([string]$Name, [string]$Target, [string]$Arguments, [string]$Icon, [string]$Description) {
    $path = Join-Path $desktop "$Name.lnk"
    $lnk = $shell.CreateShortcut($path)
    $lnk.TargetPath = $Target
    $lnk.Arguments = $Arguments
    $lnk.WorkingDirectory = $Root
    $lnk.IconLocation = "$Icon,0"
    $lnk.Description = $Description
    $lnk.Save()
    Write-Host "made $path"
}

$ps = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
New-Shortcut 'Maastricht Blox' $ps "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$Root\scripts\play.ps1`"" `
    (Join-Path $icons 'blox.ico') 'Maastricht Blox: the web game in its own window'

$exe = Join-Path $Root 'unity\Builds\StandaloneWindows64\MaastrichtBlox.exe'
if (Test-Path $exe) {
    New-Shortcut 'Maastricht Blox (Unity)' $exe "-bloxWorld `"$World`"" (Join-Path $icons 'blox_unity.ico') 'Maastricht Blox: Unity build'
} else {
    Write-Warning "no Unity player at ${exe}: run .\scripts\unity.ps1 build, then this script again"
}
