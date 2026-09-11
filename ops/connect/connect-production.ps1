<#
.SYNOPSIS
    Connect to OmniStore Production server via SSH.
.DESCRIPTION
    Establishes an interactive SSH session to the Production server.
    This script does NOT automate password entry.
    It requires an interactive PowerShell/console session.
.PARAMETER User
    SSH user. Default: omnistore
.PARAMETER Host
    SSH host. Default: 192.168.1.64
.EXAMPLE
    .\connect-production.ps1
.EXAMPLE
    .\connect-production.ps1 -Host 192.168.1.64 -User omnistore
#>

param(
    [string]$User = "omnistore",
    [string]$Host = "192.168.1.64"
)

$ErrorActionPreference = "Stop"

Write-Host "=== OmniStore Production SSH Connection ==="
Write-Host "Target: $User@$Host"
Write-Host ""
Write-Host "This will open an interactive SSH session."
Write-Host "You will be prompted for password or key passphrase if needed."
Write-Host ""
Write-Host "Press Ctrl+C to cancel, or wait 5 seconds to continue..."
Start-Sleep -Seconds 5

# Check if ssh.exe exists
$ssh = Get-Command ssh.exe -ErrorAction SilentlyContinue
if (-not $ssh) {
    Write-Error "ERROR: ssh.exe not found in PATH. Please install OpenSSH client."
    exit 1
}

Write-Host "[OK] ssh.exe found: $($ssh.Source)"
Write-Host "[OK] Connecting to $User@$Host..."
Write-Host ""

# Launch interactive SSH session
& ssh "$User@$Host"

Write-Host ""
Write-Host "=== SSH Session Ended ==="
