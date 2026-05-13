# PowerShell wrapper for Windows users who aren't in WSL/Git Bash.
# Delegates to ./stack via bash if available, else explains how to install it.
#
# Usage:
#   .\stack.ps1 up
#   .\stack.ps1 down
#   .\stack.ps1 opencode

param([Parameter(ValueFromRemainingArguments=$true)][string[]]$Args)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

# Prefer WSL because that's where OpenCode runs anyway.
$wsl = Get-Command wsl.exe -ErrorAction SilentlyContinue
if ($wsl) {
  $winPath = (Resolve-Path $ScriptDir).Path
  # Convert D:\repos\... to /mnt/d/repos/...
  $wslPath = "/mnt/" + $winPath.Substring(0,1).ToLower() + ($winPath.Substring(2) -replace '\\','/')
  & wsl.exe -- bash -lc "cd '$wslPath' && ./stack $($Args -join ' ')"
  exit $LASTEXITCODE
}

$bash = Get-Command bash.exe -ErrorAction SilentlyContinue
if ($bash) {
  & bash.exe "$ScriptDir/stack" @Args
  exit $LASTEXITCODE
}

Write-Host "No WSL or Git Bash found. Install one of:" -ForegroundColor Yellow
Write-Host "  - WSL: wsl --install"
Write-Host "  - Git for Windows (includes Git Bash): https://git-scm.com/download/win"
exit 1
