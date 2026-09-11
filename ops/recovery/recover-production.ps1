<#
.SYNOPSIS
    Recover OmniStore Production from backup (read-only verification + guided restore).
.DESCRIPTION
    Verifies backup integrity and provides guided recovery steps.
    Does NOT automatically restore unless explicitly confirmed.
.PARAMETER Host
    SSH host. Default: 192.168.1.64
.PARAMETER User
    SSH user. Default: omnistore
.PARAMETER BackupPath
    Specific backup path to verify/recover from
.PARAMETER Restore
    Switch to actually perform restore (requires explicit confirmation)
.EXAMPLE
    .\recover-production.ps1 -BackupPath /home/omnistore/backups/pre_deploy_20260911_131032
.EXAMPLE
    .\recover-production.ps1 -BackupPath /home/omnistore/backups/pre_deploy_20260911_131032 -Restore
#>

param(
    [string]$User = "omnistore",
    [string]$Host = "192.168.1.64",
    [string]$BackupPath = "",
    [switch]$Restore = $false
)

$ErrorActionPreference = "Stop"

Write-Host "=== OmniStore Production Recovery ==="
Write-Host "Target: $User@$Host"
Write-Host ""

if (-not $BackupPath) {
    Write-Error "ERROR: -BackupPath is required."
    Write-Host "Usage: .\recover-production.ps1 -BackupPath <path> [-Restore]"
    exit 1
}

if ($Restore) {
    Write-Host "WARNING: This will restore Production files from backup."
    Write-Host "Press Ctrl+C to cancel, or wait 10 seconds to continue..."
    Start-Sleep -Seconds 10
}

# Check if ssh.exe exists
$ssh = Get-Command ssh.exe -ErrorAction SilentlyContinue
if (-not $ssh) {
    Write-Error "ERROR: ssh.exe not found in PATH. Please install OpenSSH client."
    exit 1
}

# Recovery script
$recoverScript = @'
set -euo pipefail

echo "=== PRODUCTION RECOVERY ==="
echo "TIMESTAMP=$(date -Is)"
echo "BACKUP_PATH="$1""
echo "RESTORE_MODE="$2""
echo ""

PRODUCTION_PATH="/home/omnistore/OmniStore_Multi-Tenant"
BACKUP_PATH="$1"
RESTORE_MODE="$2"

if [ ! -d "$BACKUP_PATH" ]; then
    fail "Backup path not found: $BACKUP_PATH"
fi

echo "[1/5] Backup verification..."
BACKUP_FILE_COUNT=$(find "$BACKUP_PATH" -type f | wc -l)
echo "Backup files: $BACKUP_FILE_COUNT"

if [ "$BACKUP_FILE_COUNT" -eq 0 ]; then
    fail "Backup is empty"
fi

echo "Backup contents:"
find "$BACKUP_PATH" -type f | sort
echo ""

echo "[2/5] Current Production state..."
cd "$PRODUCTION_PATH" 2>/dev/null || fail "Production path not found"

if [ -d ".git" ]; then
    echo "Current SHA: $(git rev-parse HEAD 2>/dev/null || echo UNKNOWN)"
else
    echo "Git: NOT A REPOSITORY"
fi

if systemctl is-active --quiet omnistore.service 2>/dev/null; then
    echo "Service: ACTIVE"
    echo "PID: $(systemctl show -p MainPID --value omnistore.service 2>/dev/null || echo UNKNOWN)"
else
    echo "Service: INACTIVE"
fi

if ss -tlnp 2>/dev/null | grep -q ':3001'; then
    echo "Port 3001: LISTENING"
else
    echo "Port 3001: NOT_LISTENING"
fi
echo ""

echo "[3/5] Data preservation check..."
DATA_DIR="$PRODUCTION_PATH/backend/data"
if [ -d "$DATA_DIR" ]; then
    echo "Data directory: PRESENT"
    echo "Data files: $(ls -1 "$DATA_DIR" 2>/dev/null | wc -l)"
else
    echo "Data directory: MISSING"
fi
echo ""

if [ "$RESTORE_MODE" != "restore" ]; then
    echo "[4/5] READ-ONLY MODE - no files will be restored"
    echo "To perform actual restore, run with -Restore flag"
    echo ""
    echo "[5/5] Recovery verification complete"
    exit 0
fi

echo "[4/5] Restoring from backup..."
RESTORE_FILES=(
    "backend/server.js"
    "backend/utils/fileStore.js"
    "index.html"
    "package.json"
    "sw.js"
)

for file in "${RESTORE_FILES[@]}"; do
    backup_file="$BACKUP_PATH/$(basename "$file")"
    if [ -f "$backup_file" ]; then
        cp "$backup_file" "$PRODUCTION_PATH/$file"
        echo "  Restored: $file"
    else
        echo "  SKIPPED (not in backup): $file"
    fi
done

echo ""
echo "[5/5] Post-restore verification..."
if [ -d ".git" ]; then
    echo "SHA after restore: $(git rev-parse HEAD 2>/dev/null || echo UNKNOWN)"
fi

if systemctl is-active --quiet omnistore.service 2>/dev/null; then
    echo "Service: ACTIVE"
else
    echo "Service: INACTIVE"
fi

echo ""
echo "=== Recovery Complete ==="
echo "NOTE: Service restart may be required to load restored files."
echo "To restart: sudo systemctl restart omnistore.service"
'@

# Execute recovery script
Write-Host "Uploading and running recovery script..."
$scriptBytes = [System.Text.Encoding]::UTF8.GetBytes($recoverScript)
$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName = "ssh"
$psi.Arguments = "$User@$Host `"bash -s `"$BackupPath`" `"$Restore`"`""
$psi.RedirectStandardInput = $true
$psi.RedirectStandardOutput = $true
$psi.RedirectStandardError = $true
$psi.UseShellExecute = $false

$process = [System.Diagnostics.Process]::Start($psi)
$process.StandardInput.Write($recoverScript)
$process.StandardInput.Close()

$stdout = $process.StandardOutput.ReadToEnd()
$stderr = $process.StandardError.ReadToEnd()
$process.WaitForExit()

Write-Host $stdout

if ($stderr) {
    Write-Warning "STDERR: $stderr"
}

Write-Host ""
Write-Host "=== Recovery Complete ==="
Write-Host "Exit code: $($process.ExitCode)"
