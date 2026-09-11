<#
.SYNOPSIS
    Verify OmniStore Production state (read-only).
.DESCRIPTION
    Runs read-only verification commands on the Production server via SSH.
    Does NOT modify any files or restart any services.
.PARAMETER Host
    SSH host. Default: 192.168.1.64
.PARAMETER User
    SSH user. Default: omnistore
.EXAMPLE
    .\verify-production.ps1
#>

param(
    [string]$User = "omnistore",
    [string]$Host = "192.168.1.64"
)

$ErrorActionPreference = "Stop"

Write-Host "=== OmniStore Production Verification (Read-Only) ==="
Write-Host "Target: $User@$Host"
Write-Host ""

# Check if ssh.exe exists
$ssh = Get-Command ssh.exe -ErrorAction SilentlyContinue
if (-not $ssh) {
    Write-Error "ERROR: ssh.exe not found in PATH. Please install OpenSSH client."
    exit 1
}

# Read-only verification script
$verifyScript = @'
set -euo pipefail

echo "=== PRODUCTION VERIFICATION ==="
echo "TIMESTAMP=$(date -Is)"
echo ""

# 1. Git SHA
echo "=== 1. GIT SHA ==="
cd /home/omnistore/OmniStore_Multi-Tenant 2>/dev/null || cd /
if [ -d ".git" ]; then
    echo "PRODUCTION_SHA=$(git rev-parse HEAD 2>/dev/null || echo UNKNOWN)"
    echo "GIT_STATUS=$(git status --short 2>/dev/null | head -20 || echo UNKNOWN)"
else
    echo "PRODUCTION_SHA=UNKNOWN"
    echo "GIT_STATUS=UNKNOWN"
fi
echo ""

# 2. Service state
echo "=== 2. SERVICE STATE ==="
if systemctl is-active --quiet omnistore.service 2>/dev/null; then
    echo "SERVICE_ACTIVE=YES"
    echo "SERVICE_MAINPID=$(systemctl show -p MainPID --value omnistore.service 2>/dev/null || echo UNKNOWN)"
    echo "SERVICE_EXECSTART=$(systemctl show -p ExecStart --value omnistore.service 2>/dev/null || echo UNKNOWN)"
else
    echo "SERVICE_ACTIVE=NO"
fi
echo ""

# 3. Port 3001
echo "=== 3. PORT 3001 ===""
if ss -tlnp 2>/dev/null | grep -q ':3001'; then
    echo "PORT_3001=LISTENING"
    echo "PORT_3001_PID=$(ss -tlnp 2>/dev/null | grep ':3001' | head -1)"
else
    echo "PORT_3001=NOT_LISTENING"
fi
echo ""

# 4. Health endpoints
echo "=== 4. HEALTH ENDPOINTS ==="
HEALTH=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3001/api/v1/health 2>/dev/null || echo "FAIL")
READY=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3001/api/v1/ready 2>/dev/null || echo "FAIL")
LIVENESS=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3001/api/v1/liveness 2>/dev/null || echo "FAIL")
echo "HEALTH=$HEALTH"
echo "READY=$READY"
echo "LIVENESS=$LIVENESS"
echo ""

# 5. Platform pages
echo "=== 5. PLATFORM PAGES ==="
ROOT_CODE=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3001/ 2>/dev/null || echo "FAIL")
PLATFORM_CODE=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3001/platform.html 2>/dev/null || echo "FAIL")
BUSINESS_CODE=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3001/business.html 2>/dev/null || echo "FAIL")
echo "ROOT_HTTP=$ROOT_CODE"
echo "PLATFORM_HTTP=$PLATFORM_CODE"
echo "BUSINESS_HTTP=$BUSINESS_CODE"
echo ""

# 6. Data preservation
echo "=== 6. DATA PRESERVATION ==="
DATA_DIR="/home/omnistore/OmniStore_Multi-Tenant/backend/data"
if [ -d "$DATA_DIR" ]; then
    echo "DATA_DIR=PRESENT"
    echo "DATA_FILES=$(ls -1 "$DATA_DIR" 2>/dev/null | wc -l)"
    echo "DATA_FILES_LIST=$(ls -1 "$DATA_DIR" 2>/dev/null | tr '\n' '; ')"
else
    echo "DATA_DIR=MISSING"
fi
echo ""

# 7. Backup verification
echo "=== 7. BACKUP VERIFICATION ==="
BACKUP_DIR="/home/omnistore/backups"
if [ -d "$BACKUP_DIR" ]; then
    echo "BACKUP_DIR=PRESENT"
    echo "BACKUP_LATEST=$(find "$BACKUP_DIR" -type f -name '*.tar*' -o -name '*.zip' -o -name 'backup*' 2>/dev/null | sort | tail -1)"
    echo "BACKUP_COUNT=$(find "$BACKUP_DIR" -type f 2>/dev/null | wc -l)"
else
    echo "BACKUP_DIR=MISSING"
fi
echo ""

echo "=== VERIFICATION COMPLETE ==="
'@

# Execute verification script
$scriptBytes = [System.Text.Encoding]::UTF8.GetBytes($verifyScript)
$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName = "ssh"
$psi.Arguments = "$User@$Host `"bash -s`""
$psi.RedirectStandardInput = $true
$psi.RedirectStandardOutput = $true
$psi.RedirectStandardError = $true
$psi.UseShellExecute = $false

$process = [System.Diagnostics.Process]::Start($psi)
$process.StandardInput.Write($verifyScript)
$process.StandardInput.Close()

$stdout = $process.StandardOutput.ReadToEnd()
$stderr = $process.StandardError.ReadToEnd()
$process.WaitForExit()

Write-Host $stdout

if ($stderr) {
    Write-Warning "STDERR: $stderr"
}

Write-Host ""
Write-Host "=== Verification Complete ==="
Write-Host "Exit code: $($process.ExitCode)"
