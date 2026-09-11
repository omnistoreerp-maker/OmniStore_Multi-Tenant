<#
.SYNOPSIS
    Deploy to OmniStore Production (requires explicit confirmation).
.DESCRIPTION
    Uploads and runs the deployment script on Production.
    This will modify Production files and may restart the service.
.PARAMETER Host
    SSH host. Default: 192.168.1.64
.PARAMETER User
    SSH user. Default: omnistore
.PARAMETER ExpectedProductionSha
    Expected Production SHA (required)
.PARAMETER Confirm
    Must be set to $true to actually deploy
.EXAMPLE
    .\deploy-production.ps1 -ExpectedProductionSha d596f2aabdb5c7a562dfe53af7c4b8b6673c4a6b -Confirm:$true
#>

param(
    [string]$User = "omnistore",
    [string]$Host = "192.168.1.64",
    [string]$ExpectedProductionSha = "",
    [switch]$Confirm = $false
)

$ErrorActionPreference = "Stop"

Write-Host "=== OmniStore Production Deployment ==="
Write-Host "Target: $User@$Host"
Write-Host ""

if (-not $ExpectedProductionSha) {
    Write-Error "ERROR: -ExpectedProductionSha is required."
    Write-Host "Usage: .\deploy-production.ps1 -ExpectedProductionSha <sha> -Confirm"
    exit 1
}

if (-not $Confirm) {
    Write-Error "ERROR: Deployment requires explicit confirmation."
    Write-Host "Usage: .\deploy-production.ps1 -ExpectedProductionSha <sha> -Confirm"
    Write-Host ""
    Write-Host "This will:"
    Write-Host "  1. Verify artifact SHA256"
    Write-Host "  2. Verify Production SHA"
    Write-Host "  3. Create backup"
    Write-Host "  4. Deploy selective integration files"
    Write-Host "  5. Restart service if needed"
    Write-Host "  6. Run health checks"
    Write-Host "  7. Auto-rollback on failure"
    Write-Host ""
    Write-Host "To proceed, add -Confirm:`$true"
    exit 1
}

Write-Host "WARNING: This will modify Production files."
Write-Host "Press Ctrl+C to cancel, or wait 10 seconds to continue..."
Start-Sleep -Seconds 10

# Check if ssh.exe exists
$ssh = Get-Command ssh.exe -ErrorAction SilentlyContinue
if (-not $ssh) {
    Write-Error "ERROR: ssh.exe not found in PATH. Please install OpenSSH client."
    exit 1
}

# Deploy script
$deployScript = @'
set -euo pipefail

echo "=== PRODUCTION DEPLOYMENT ==="
echo "TIMESTAMP=$(date -Is)"
echo ""

# Configuration
RELEASE_SHA256="e78438f53b0b1034e08b00286b5ae9e1328f335fd1e68732dfee4f65fc551c2e"
MANIFEST_SHA256="a7ffc6f8bf1ed76651c14756a061d662f580ff4de43b49fa82d80a4b80f8434a"
PRODUCTION_PATH="/home/omnistore/OmniStore_Multi-Tenant"
BACKUP_BASE="/home/omnistore/backups"
ARTIFACT_PATH="/tmp/RELEASE_ARTIFACT.zip"
STAGE_DIR="/tmp/omnistore_deploy_stage"
DEPLOY_TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_PATH="${BACKUP_BASE}/pre_deploy_${DEPLOY_TIMESTAMP}"

DEPLOY_FILES=(
    "backend/server.js"
    "backend/utils/fileStore.js"
    "index.html"
    "package.json"
    "sw.js"
    "business.html"
)

OPTIONAL_DEPLOY_FILES=(
    "backend/data/updateManifest.json"
)

LEGACY_PATHS=(
    "services"
    "plugins"
    "backend/data"
    "backend/tests"
    "backend/controllers"
    "backend/routes"
    "backend/services"
    "backend/repositories"
    "backend/middleware"
    "backend/config"
    "backend/scripts"
)

PRODUCTION_DATA=(
    "backend/data/companies.json"
    "backend/data/companyProfile.json"
    "backend/data/marketConfig.json"
    "backend/data/platformPublic.json"
    "backend/data/sales.json"
    "backend/data/purchases.json"
    "backend/data/apiKeys.json"
    "backend/data/auditLog.json"
)

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"
}

fail() {
    log "FATAL: $*"
    exit 1
}

validate_stage_path() {
    local dir="$1"
    if [ -z "$dir" ]; then
        fail "Stage directory path is empty"
    fi
    case "$dir" in
        /tmp/*) ;;
        *) fail "Refusing to operate on non-stage path: $dir" ;;
    esac
}

rollback_files() {
    log "Rolling back deployed files..."
    if [ -f "$BACKUP_PATH/.rollback_manifest.txt" ]; then
        while IFS= read -r file; do
            if [ -f "$BACKUP_PATH/$file" ]; then
                cp "$BACKUP_PATH/$file" "$PRODUCTION_PATH/$file"
                log "  Restored: $file"
            else
                if [ -f "$PRODUCTION_PATH/$file" ]; then
                    rm -f "$PRODUCTION_PATH/$file"
                    log "  Removed new file: $file"
                fi
            fi
        done < "$BACKUP_PATH/.rollback_manifest.txt"
    else
        for file in "${DEPLOY_FILES[@]}"; do
            if [ -f "$BACKUP_PATH/$(basename "$file")" ]; then
                cp "$BACKUP_PATH/$(basename "$file")" "$PRODUCTION_PATH/$file"
                log "  Restored: $file"
            fi
        done
    fi
    log "Rollback complete"
}

# Step 1: Pre-flight checks
log "[1/12] Pre-flight checks..."
command -v git >/dev/null 2>&1 || fail "git not found"
command -v systemctl >/dev/null 2>&1 || fail "systemctl not found"
command -v curl >/dev/null 2>&1 || fail "curl not found"
command -v ss >/dev/null 2>&1 || fail "ss not found"
command -v sha256sum >/dev/null 2>&1 || fail "sha256sum not found"
command -v unzip >/dev/null 2>&1 || fail "unzip not found"

if [ ! -d "$PRODUCTION_PATH" ]; then
    fail "Production path not found: $PRODUCTION_PATH"
fi

cd "$PRODUCTION_PATH"

if [ ! -d ".git" ]; then
    fail "Not a git repository: $PRODUCTION_PATH"
fi

PRODUCTION_SHA=$(git rev-parse HEAD 2>/dev/null || echo "UNKNOWN")
log "Current production SHA: $PRODUCTION_SHA"

if [ -z "$EXPECTED_PRODUCTION_SHA" ]; then
    fail "EXPECTED_PRODUCTION_SHA is not set"
fi

if [ "$PRODUCTION_SHA" != "$EXPECTED_PRODUCTION_SHA" ]; then
    fail "Production SHA mismatch: expected=$EXPECTED_PRODUCTION_SHA actual=$PRODUCTION_SHA"
fi

log "SHA pinning: PASS"

if [ ! -f "$ARTIFACT_PATH" ]; then
    fail "Release artifact not found at $ARTIFACT_PATH"
fi

# Step 2: Sudo precheck
log "[2/12] Sudo/systemctl precheck..."
if ! sudo -n systemctl is-active omnistore.service >/dev/null 2>&1; then
    SUDO_TEST_OUTPUT=$(sudo -n systemctl is-active omnistore.service 2>&1 || true)
    if echo "$SUDO_TEST_OUTPUT" | grep -qi "password\|authentication\|permission denied"; then
        fail "sudo requires interactive authentication"
    fi
fi

if ! systemctl is-enabled omnistore.service >/dev/null 2>&1; then
    fail "omnistore.service not found or not enabled"
fi

log "Sudo/systemctl: PASS"

# Step 3: Artifact verification
log "[3/12] Verifying release artifact..."
ACTUAL_SHA256=$(sha256sum "$ARTIFACT_PATH" | cut -d' ' -f1)
log "Expected SHA256: $RELEASE_SHA256"
log "Actual SHA256:   $ACTUAL_SHA256"

if [ "$ACTUAL_SHA256" != "$RELEASE_SHA256" ]; then
    fail "Release artifact SHA256 mismatch!"
fi

log "Artifact SHA256: PASS"

# Step 4: Service state
log "[4/12] Checking current service state..."
SERVICE_WAS_RUNNING=false
PORT_WAS_LISTENING=false

if systemctl is-active --quiet omnistore.service; then
    log "Service is currently: ACTIVE"
    SERVICE_WAS_RUNNING=true
else
    log "Service is currently: INACTIVE"
fi

if ss -tlnp | grep -q ':3001'; then
    log "Port 3001: LISTENING"
    PORT_WAS_LISTENING=true
else
    log "Port 3001: NOT_LISTENING"
fi

# Step 5: Backup
log "[5/12] Creating backup..."
mkdir -p "$BACKUP_PATH"

ROLLBACK_MANIFEST="$BACKUP_PATH/.rollback_manifest.txt"
: > "$ROLLBACK_MANIFEST"

for file in "${DEPLOY_FILES[@]}"; do
    if [ -f "$PRODUCTION_PATH/$file" ]; then
        echo "$file" >> "$ROLLBACK_MANIFEST"
        cp "$PRODUCTION_PATH/$file" "$BACKUP_PATH/$(basename "$file")"
        log "  Backed up: $file"
    fi
done

if [ -f "$PRODUCTION_PATH/backend/.env" ]; then
    cp "$PRODUCTION_PATH/backend/.env" "$BACKUP_PATH/.env"
    log "  Backed up: backend/.env"
fi

if [ -d "$PRODUCTION_PATH/backend/data" ]; then
    mkdir -p "$BACKUP_PATH/data"
    for datafile in "${PRODUCTION_DATA[@]}"; do
        if [ -f "$PRODUCTION_PATH/$datafile" ]; then
            cp "$PRODUCTION_PATH/$datafile" "$BACKUP_PATH/data/"
            log "  Backed up data: $(basename "$datafile")"
        fi
    done
fi

BACKUP_FILE_COUNT=$(find "$BACKUP_PATH" -type f | wc -l)
log "Backup created at: $BACKUP_PATH"
log "Backup files: $BACKUP_FILE_COUNT"

if [ "$BACKUP_FILE_COUNT" -eq 0 ]; then
    fail "Backup failed - no files backed up"
fi

log "Backup: PASS"

# Step 6: Legacy pre-check
log "[6/12] Pre-deployment legacy verification..."
LEGACY_MISSING_PRE=false

for path in "${LEGACY_PATHS[@]}"; do
    if [ -e "$PRODUCTION_PATH/$path" ]; then
        log "  PRESERVED: $path"
    else
        log "  MISSING: $path"
        LEGACY_MISSING_PRE=true
    fi
done

if [ "$LEGACY_MISSING_PRE" = true ]; then
    fail "Pre-deployment legacy verification failed"
fi

log "Legacy pre-check: PASS"

# Step 7: Deploy
log "[7/12] Deploying selective integration..."
validate_stage_path "$STAGE_DIR"
rm -rf "$STAGE_DIR"
mkdir -p "$STAGE_DIR"
unzip -q "$ARTIFACT_PATH" -d "$STAGE_DIR"

if [ ! -d "$STAGE_DIR/backend" ] || [ ! -d "$STAGE_DIR/services" ]; then
    fail "Artifact structure invalid"
fi

for file in "${DEPLOY_FILES[@]}"; do
    if [ -f "$STAGE_DIR/$file" ]; then
        if [ ! -s "$STAGE_DIR/$file" ]; then
            fail "Artifact file is empty: $file"
        fi
        cp "$STAGE_DIR/$file" "$PRODUCTION_PATH/$file"
        log "  Deployed: $file"
    else
        fail "Required file missing from artifact: $file"
    fi
done

for file in "${OPTIONAL_DEPLOY_FILES[@]}"; do
    if [ -f "$STAGE_DIR/$file" ]; then
        if [ ! -s "$STAGE_DIR/$file" ]; then
            log "  WARNING: Optional artifact file is empty: $file"
            continue
        fi
        cp "$STAGE_DIR/$file" "$PRODUCTION_PATH/$file"
        log "  Deployed optional: $file"
    else
        log "  SKIPPED optional (not in artifact): $file"
    fi
done

log "Deployment: PASS"

# Step 8: Legacy post-check
log "[8/12] Post-deployment legacy verification..."
LEGACY_MISSING_POST=false

for path in "${LEGACY_PATHS[@]}"; do
    if [ -e "$PRODUCTION_PATH/$path" ]; then
        log "  PRESERVED: $path"
    else
        log "  MISSING: $path"
        LEGACY_MISSING_POST=true
    fi
done

if [ "$LEGACY_MISSING_POST" = true ]; then
    log "ERROR: Post-deployment legacy verification failed"
    rollback_files
    fail "Legacy verification failed - rolled back"
fi

log "Legacy post-check: PASS"

# Step 9: Service management
log "[9/12] Service management..."
NEED_RESTART=false

if [ "$SERVICE_WAS_RUNNING" = true ] || [ "$PORT_WAS_LISTENING" = true ]; then
    NEED_RESTART=true
    log "Service was running - restart required"
else
    log "Service was not running - starting service"
fi

if [ "$NEED_RESTART" = true ]; then
    systemctl restart omnistore.service || fail "Failed to restart omnistore.service"
else
    systemctl start omnistore.service || fail "Failed to start omnistore.service"
fi

MAX_WAIT=60
WAITED=0
while [ $WAITED -lt $MAX_WAIT ]; do
    if systemctl is-active --quiet omnistore.service; then
        log "Service is active after ${WAITED}s"
        break
    fi
    if [ $WAITED -eq $MAX_WAIT ]; then
        log "ERROR: Service failed to become active"
        rollback_files
        systemctl restart omnistore.service || true
        fail "Deployment failed - rolled back"
    fi
    sleep 5
    WAITED=$((WAITED + 5))
done

SERVICE_PID=$(systemctl show omnistore.service --property=MainPID --value 2>/dev/null || echo "UNKNOWN")
log "Service PID: $SERVICE_PID"

# Step 10: Runtime verification
log "[10/12] Runtime verification..."
MAX_PORT_WAIT=30
PORT_WAITED=0
while [ $PORT_WAITED -lt $MAX_PORT_WAIT ]; do
    if ss -tlnp | grep -q ':3001'; then
        log "Port 3001: LISTENING"
        break
    fi
    if [ $PORT_WAITED -eq $MAX_PORT_WAIT ]; then
        log "ERROR: Port 3001 not listening"
        rollback_files
        systemctl restart omnistore.service || true
        fail "Port 3001 not listening - rolled back"
    fi
    sleep 2
    PORT_WAITED=$((PORT_WAITED + 2))
done

HEALTH=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3001/api/v1/health || echo "FAIL")
READY=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3001/api/v1/ready || echo "FAIL")
LIVENESS=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3001/api/v1/liveness || echo "FAIL")

log "Health:   $HEALTH"
log "Ready:    $READY"
log "Liveness: $LIVENESS"

if [ "$HEALTH" != "200" ] || [ "$READY" != "200" ] || [ "$LIVENESS" != "200" ]; then
    log "ERROR: Health checks failed"
    rollback_files
    systemctl restart omnistore.service || true
    fail "Health checks failed - rolled back"
fi

ROOT_RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3001/ || echo "FAIL")
PLATFORM_RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3001/platform.html || echo "FAIL")
BUSINESS_RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3001/business.html || echo "FAIL")

log "Root: $ROOT_RESPONSE"
log "Platform: $PLATFORM_RESPONSE"
log "Business: $BUSINESS_RESPONSE"

if [ "$ROOT_RESPONSE" != "200" ] || [ "$PLATFORM_RESPONSE" != "200" ] || [ "$BUSINESS_RESPONSE" != "200" ]; then
    log "ERROR: Platform checks failed"
    rollback_files
    systemctl restart omnistore.service || true
    fail "Platform checks failed - rolled back"
fi

# Step 11: Final report
log "[11/12] Deployment complete"
log "Backup: $BACKUP_PATH"
log "Production SHA: $PRODUCTION_SHA"
log "Service PID: $SERVICE_PID"
log "Health: $HEALTH"
log "Ready: $READY"
log "Liveness: $LIVENESS"
log "Platform Home: $ROOT_RESPONSE"
log "Business Page: $BUSINESS_RESPONSE"
log "Legacy Preserved: YES"
log "Production Data Preserved: YES"
log "READY_FOR_PRODUCTION=YES"

rm -rf "$STAGE_DIR"
exit 0
'@

# Execute deployment script
Write-Host "Uploading and running deployment script..."
$scriptBytes = [System.Text.Encoding]::UTF8.GetBytes($deployScript)
$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName = "ssh"
$psi.Arguments = "$User@$Host `"EXPECTED_PRODUCTION_SHA=$ExpectedProductionSha sudo bash -s`""
$psi.RedirectStandardInput = $true
$psi.RedirectStandardOutput = $true
$psi.RedirectStandardError = $true
$psi.UseShellExecute = $false

$process = [System.Diagnostics.Process]::Start($psi)
$process.StandardInput.Write($deployScript)
$process.StandardInput.Close()

$stdout = $process.StandardOutput.ReadToEnd()
$stderr = $process.StandardError.ReadToEnd()
$process.WaitForExit()

Write-Host $stdout

if ($stderr) {
    Write-Warning "STDERR: $stderr"
}

Write-Host ""
Write-Host "=== Deployment Complete ==="
Write-Host "Exit code: $($process.ExitCode)"
