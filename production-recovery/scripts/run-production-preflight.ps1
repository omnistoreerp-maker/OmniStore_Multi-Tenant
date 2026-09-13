<#
.SYNOPSIS
    Runs Production Preflight V4 on the production server via SSH.
.DESCRIPTION
    Reads production-preflight-v4.sh from the local directory,
    ensures LF-only line endings via byte-level processing,
    pipes it to production via SSH using ProcessStartInfo stdin redirect,
    captures the REPORT_PATH from the execution output,
    then retrieves and displays the exact generated report.
    READ-ONLY. No files are modified on production.
#>

param()

$ErrorActionPreference = "Stop"

# Configuration
$SSH_HOST = "omnistore@192.168.1.64"
$SCRIPT_PATH = ".\production-preflight-v4.sh"
$REPORT_PATTERN = "/tmp/production_preflight_v4_*.txt"

# 1. Verify ssh.exe exists
$ssh = Get-Command ssh.exe -ErrorAction SilentlyContinue
if (-not $ssh) {
    Write-Error "ERROR: ssh.exe not found in PATH. Please install OpenSSH client."
    exit 1
}
Write-Host "[OK] ssh.exe found: $($ssh.Source)"

# 2. Verify script exists
if (-not (Test-Path $SCRIPT_PATH)) {
    Write-Error "ERROR: Script not found: $SCRIPT_PATH"
    exit 1
}
$scriptSize = (Get-Item $SCRIPT_PATH).Length
Write-Host "[OK] Script found: $SCRIPT_PATH ($scriptSize bytes)"

# 3. Read script as bytes, filter CR, send to SSH via stdin redirect
Write-Host ""
Write-Host "=== Connecting to Production ==="
Write-Host "Host: $SSH_HOST"
Write-Host "You will be prompted for password."
Write-Host ""

try {
    # Read script as bytes
    $scriptBytes = [System.IO.File]::ReadAllBytes((Join-Path $PSScriptRoot "production-preflight-v4.sh"))
    
    # Count CR and LF bytes in source
    $scriptCrBytes = ($scriptBytes | Where-Object { $_ -eq 13 }).Count
    $scriptLfBytes = ($scriptBytes | Where-Object { $_ -eq 10 }).Count
    Write-Host "[VALIDATION] SCRIPT_CR_BYTES=$scriptCrBytes"
    Write-Host "[VALIDATION] SCRIPT_LF_BYTES=$scriptLfBytes"
    
    # Filter out CR bytes (0x0D) to ensure LF-only payload
    $payloadBytes = $scriptBytes | Where-Object { $_ -ne 13 }
    
    # Count CR bytes in payload
    $payloadCrBytes = ($payloadBytes | Where-Object { $_ -eq 13 }).Count
    $payloadLfBytes = ($payloadBytes | Where-Object { $_ -eq 10 }).Count
    Write-Host "[VALIDATION] PAYLOAD_CR_BYTES=$payloadCrBytes"
    Write-Host "[VALIDATION] PAYLOAD_LF_BYTES=$payloadLfBytes"
    
    if ($payloadCrBytes -ne 0) {
        Write-Error "ERROR: Payload contains $payloadCrBytes CR bytes. Aborting."
        exit 1
    }
    
    # Use ProcessStartInfo for byte-accurate stdin redirect
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = "ssh"
    $psi.Arguments = "$SSH_HOST `"bash -s`""
    $psi.RedirectStandardInput = $true
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.UseShellExecute = $false
    
    $process = [System.Diagnostics.Process]::Start($psi)
    $process.StandardInput.Write([System.Text.Encoding]::UTF8.GetString($payloadBytes))
    $process.StandardInput.Close()
    
    $stdout = $process.StandardOutput.ReadToEnd()
    $stderr = $process.StandardError.ReadToEnd()
    $process.WaitForExit()
    
    $executionOutput = $stdout
    if ($stderr) {
        $executionOutput += "`nSTDERR: $stderr"
    }
    Write-Host $executionOutput
    
    # Extract REPORT_PATH from execution output
    $reportPath = $null
    if ($executionOutput -match 'REPORT_PATH=(\S+)') {
        $reportPath = $matches[1].Trim()
    }
    
    if (-not $reportPath) {
        Write-Warning ""
        Write-Warning "=== WARNING: Exact REPORT_PATH not found in execution output ==="
        Write-Warning "Attempting fallback: retrieve latest report matching pattern..."
        
        $fallbackOutput = ssh $SSH_HOST "cat $REPORT_PATTERN" 2>$null
        if (-not $fallbackOutput) {
            Write-Error "ERROR: Report file not found on production."
            Write-Error "The script may have failed to execute."
            exit 1
        }
        Write-Host ""
        Write-Host "=== REPORT CONTENT (fallback retrieval) ==="
        Write-Host $fallbackOutput
    } else {
        # Retrieve the exact report using captured path
        Write-Host ""
        Write-Host "=== Retrieving Report: $reportPath ==="
        $report = ssh $SSH_HOST "cat '$reportPath'" 2>$null
        if (-not $report) {
            Write-Warning "WARNING: Failed to retrieve report from exact path."
            Write-Warning "Attempting fallback..."
            $report = ssh $SSH_HOST "cat $REPORT_PATTERN" 2>$null
            if (-not $report) {
                Write-Error "ERROR: Report file not found on production."
                exit 1
            }
        }
        Write-Host ""
        Write-Host "=== REPORT CONTENT ==="
        Write-Host $report
    }
} catch {
    Write-Error "ERROR: SSH execution failed: $_"
    exit 1
}

Write-Host ""
Write-Host "=== PRODUCTION PREFLIGHT COMPLETE ==="
Write-Host "REPORT RETRIEVED"
