# Windows wrapper for scripts/check.sh: runs it with Git Bash (not WSL's bash).
# Usage: .\scripts\check.ps1 [pipeline|proxy|dotnet|viewer ...]
$ErrorActionPreference = 'Stop'
$bash = @("$env:ProgramFiles\Git\bin\bash.exe", "${env:ProgramFiles(x86)}\Git\bin\bash.exe",
          "$env:LOCALAPPDATA\Programs\Git\bin\bash.exe") | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $bash) { throw 'Git Bash not found: install Git for Windows' }
& $bash (Join-Path $PSScriptRoot 'check.sh') @args
exit $LASTEXITCODE
