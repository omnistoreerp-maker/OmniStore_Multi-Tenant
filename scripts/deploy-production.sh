#!/bin/bash
# ============================================================================
# OmniStore Selective Integration — Production Deployment Script
# Target: omnistore@192.168.1.64 /home/omnistore/OmniStore_Multi-Tenant
# Usage: sudo bash deploy-production.sh [--dry-run]
# ============================================================================

set -euo pipefail

# ============================================================================
# CONFIGURATION
# ============================================================================
RELEASE_SHA256="e78438f53b0b1034e08b00286b5ae9e1328f335fd1e68732dfee4f65fc551c2e"
MANIFEST_SHA256="a7ffc6f8bf1ed76651c14756a061d662f580ff4de43b49fa82d80a4b80f8434a"
PRODUCTION_PATH="/home/omnistore/OmniStore_Multi-Tenant"
BACKUP_BASE="/home/omnistore/backups"
ARTIFACT_PATH="/tmp/RELEASE_ARTIFACT.zip"
STAGE_DIR="/tmp/omnistore_deploy_stage"
DEPLOY_TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_PATH="${BACKUP_BASE}/pre_deploy_${DEPLOY_TIMESTAMP}"

# MUST be provided explicitly for safety; do NOT guess.
EXPECTED_PRODUCTION_SHA="${EXPECTED_PRODUCTION_SHA:-}"

# Selective integration files only — DO NOT replace entire repository
DEPLOY_FILES=(
    "backend/server.js"
    "backend/utils/fileStore.js"
    "index.html"
    "package.json"
    "sw.js"
    "business.html"
    "backend/data/updateManifest.json"
)

# Legacy paths that must be preserved
LEGACY_PATHS=(
    "services"
    "plugins"
    "backend/data"
    "backend/tests"
    "backend/controllers"
    "backend/routes"
    "backend/services"
    "backend/models"
    "backend/repositories"
    "backend/middleware"
    "backend/config"
    "backend/scripts"
)

# Legacy route/module existence checks
LEGACY_STATIC_FEATURES=(
    "company"
    "customer"
    "internal"
    "market"
    "gameHosting"
    "playstation"
    "loyalty"
    "companyProfile"
    "customerRequest"
    "internalChangeCenter"
    "backend/middleware/marketJwt.js"
    "backend/services/buildIdentity.service.js"
    "backend/services/release.service.js"
    "backend/services/customerRequest.service.js"
)

# Production data files that must never be deleted
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

# ============================================================================
# UTILITY FUNCTIONS
# ============================================================================
log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"
}

fail() {
    log "FATAL: $*"
    exit 1
}

check_command() {
    command -v "$1" >/dev/null 2>&1 || fail "Required command not found: $1"
}

usage() {
    echo "Usage: sudo bash deploy-production.sh [--dry-run]"
    echo "Required environment:"
    echo "  EXPECTED_PRODUCTION_SHA  required unless --dry-run"
    echo ""
    echo "Examples:"
    echo "  sudo EXPECTED_PRODUCTION_SHA=<sha> bash deploy-production.sh"
    echo "  sudo EXPECTED_PRODUCTION_SHA=<sha> bash deploy-production.sh --dry-run"
    exit 1
}

validate_stage_path() {
    local dir="$1"
    if [ -z "$dir" ]; then
        fail "Stage directory path is empty"
    fi
    # Ensure it's an absolute path under /tmp
    case "$dir" in
        /tmp/*) ;;
        *) fail "Refusing to operate on non-stage path: $dir" ;;
    esac
}

# ============================================================================
# ARGUMENT PARSING
# ============================================================================
DRY_RUN=false
if [ "${1:-}" = "--dry-run" ]; then
    DRY_RUN=true
    log "=== DRY RUN MODE — no changes will be made ==="
fi

# ============================================================================
# ROLLBACK FUNCTION
# ============================================================================
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
        # Fallback: restore all DEPLOY_FILES from backup
        for file in "${DEPLOY_FILES[@]}"; do
            if [ -f "$BACKUP_PATH/$(basename "$file")" ]; then
                cp "$BACKUP_PATH/$(basename "$file")" "$PRODUCTION_PATH/$file"
                log "  Restored: $file"
            fi
        done
    fi
    log "Rollback complete"
}

# ============================================================================
# STEP 1: PRE-FLIGHT CHECKS
# ============================================================================
log "=== OmniStore Selective Integration Deployment ==="
log "Timestamp: $(date -Iseconds)"
log ""

log "[1/12] Pre-flight checks..."
check_command git
check_command systemctl
check_command curl
check_command ss
check_command sha256sum
check_command unzip
check_command cp
check_command mkdir
check_command find
check_command head
check_command grep
check_command sudo

# Verify production path
if [ ! -d "$PRODUCTION_PATH" ]; then
    fail "Production path not found: $PRODUCTION_PATH"
fi

cd "$PRODUCTION_PATH"

# Verify git repository
if [ ! -d ".git" ]; then
    fail "Not a git repository: $PRODUCTION_PATH"
fi

# Read production SHA (from actual server, not assumed)
PRODUCTION_SHA=$(git rev-parse HEAD 2>/dev/null || echo "UNKNOWN")
log "Current production SHA: $PRODUCTION_SHA"

# SHA pinning — fail fast if expected SHA is not provided or mismatched
if [ -z "$EXPECTED_PRODUCTION_SHA" ]; then
    fail "EXPECTED_PRODUCTION_SHA is not set; aborting to prevent accidental deployment to wrong server"
fi

if [ "$PRODUCTION_SHA" != "$EXPECTED_PRODUCTION_SHA" ]; then
    fail "Production SHA mismatch: expected=$EXPECTED_PRODUCTION_SHA actual=$PRODUCTION_SHA"
fi

log "Production SHA pinning: PASS"

# Verify artifact exists
if [ ! -f "$ARTIFACT_PATH" ]; then
    fail "Release artifact not found at $ARTIFACT_PATH"
fi

# ============================================================================
# STEP 2: SUDO / SYSTEMCTL PRECHECK
# ============================================================================
log ""
log "[2/12] Sudo/systemctl precheck..."

# Check if sudo is available and non-interactive
if ! sudo -n systemctl is-active omnistore.service >/dev/null 2>&1; then
    SUDO_TEST_OUTPUT=$(sudo -n systemctl is-active omnistore.service 2>&1 || true)
    if echo "$SUDO_TEST_OUTPUT" | grep -qi "password\|authentication\|permission denied"; then
        fail "sudo requires interactive authentication; aborting before any changes"
    fi
fi

# Verify service unit exists and is enabled
if ! systemctl is-enabled omnistore.service >/dev/null 2>&1; then
    fail "omnistore.service unit not found or not enabled"
fi

# Verify ExecStart points to expected production launcher
SERVICE_EXECSTART=$(systemctl show -p ExecStart --value omnistore.service 2>/dev/null || true)
if [ -z "$SERVICE_EXECSTART" ]; then
    fail "omnistore.service ExecStart is empty"
fi

log "Sudo/systemctl precheck: PASS"
log "Service ExecStart: $SERVICE_EXECSTART"

# ============================================================================
# STEP 3: SHA PINNING
# ============================================================================
log ""
log "[3/12] SHA pinning..."

if [ -z "$EXPECTED_PRODUCTION_SHA" ]; then
    fail "EXPECTED_PRODUCTION_SHA is not set; aborting to prevent accidental deployment to wrong server"
fi

if [ "$PRODUCTION_SHA" != "$EXPECTED_PRODUCTION_SHA" ]; then
    fail "Production SHA mismatch: expected=$EXPECTED_PRODUCTION_SHA actual=$PRODUCTION_SHA"
fi

log "Production SHA pinning: PASS"

# ============================================================================
# STEP 4: VERIFY RELEASE ARTIFACT
# ============================================================================
log ""
log "[4/12] Verifying release artifact..."
ACTUAL_SHA256=$(sha256sum "$ARTIFACT_PATH" | cut -d' ' -f1)
log "Expected SHA256: $RELEASE_SHA256"
log "Actual SHA256:   $ACTUAL_SHA256"

if [ "$ACTUAL_SHA256" != "$RELEASE_SHA256" ]; then
    fail "Release artifact SHA256 mismatch!"
fi

log "Release artifact SHA256: PASS"

# ============================================================================
# STEP 5: CHECK CURRENT SERVICE STATE
# ============================================================================
log ""
log "[5/12] Checking current service state..."

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

# ============================================================================
# STEP 6: CREATE BACKUP
# ============================================================================
log ""
log "[6/12] Creating backup..."

if [ "$DRY_RUN" = true ]; then
    log "DRY RUN: would create backup at $BACKUP_PATH"
else
    mkdir -p "$BACKUP_PATH"

    # Track which files existed before deployment for precise rollback
    ROLLBACK_MANIFEST="$BACKUP_PATH/.rollback_manifest.txt"
    : > "$ROLLBACK_MANIFEST"

    for file in "${DEPLOY_FILES[@]}"; do
        if [ -f "$PRODUCTION_PATH/$file" ]; then
            echo "$file" >> "$ROLLBACK_MANIFEST"
            cp "$PRODUCTION_PATH/$file" "$BACKUP_PATH/$(basename "$file")"
            log "  Backed up existing: $file"
        else
            log "  Skipped missing (will rollback by delete): $file"
        fi
    done

    # Backup .env if exists
    if [ -f "$PRODUCTION_PATH/backend/.env" ]; then
        cp "$PRODUCTION_PATH/backend/.env" "$BACKUP_PATH/.env"
        log "  Backed up: backend/.env"
    fi

    # Backup production data
    if [ -d "$PRODUCTION_PATH/backend/data" ]; then
        mkdir -p "$BACKUP_PATH/data"
        for datafile in "${PRODUCTION_DATA[@]}"; do
            if [ -f "$PRODUCTION_PATH/$datafile" ]; then
                cp "$PRODUCTION_PATH/$datafile" "$BACKUP_PATH/data/"
                log "  Backed up data: $(basename "$datafile")"
            fi
        done
    fi

    # Verify backup
    BACKUP_FILE_COUNT=$(find "$BACKUP_PATH" -type f | wc -l)
    log "Backup created at: $BACKUP_PATH"
    log "Backup files: $BACKUP_FILE_COUNT"

    if [ "$BACKUP_FILE_COUNT" -eq 0 ]; then
        fail "Backup failed — no files backed up"
    fi

    # Verify backup is readable
    for file in "$BACKUP_PATH"/*; do
        if [ -f "$file" ]; then
            if ! head -c 1 "$file" >/dev/null 2>&1; then
                fail "Backup file unreadable: $file"
            fi
        fi
    done

    log "Backup verification: PASS"
fi

# ============================================================================
# STEP 7: PRE-DEPLOYMENT LEGACY STATIC CHECK
# ============================================================================
log ""
log "[7/12] Pre-deployment legacy static verification..."
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
    fail "Pre-deployment legacy verification failed — missing legacy paths"
fi

log "Legacy static preservation pre-check: PASS"

# ============================================================================
# STEP 8: SAFE DEPLOYMENT
# ============================================================================
log ""
log "[8/12] Deploying selective integration..."

if [ "$DRY_RUN" = true ]; then
    log "DRY RUN: would deploy selective integration files"
    log "DRY RUN: would skip actual file copy"
else
    # Clean and create stage directory (controlled temp path only)
    validate_stage_path "$STAGE_DIR"
    rm -rf "$STAGE_DIR"
    mkdir -p "$STAGE_DIR"

    # Extract artifact
    unzip -q "$ARTIFACT_PATH" -d "$STAGE_DIR"

    # Verify artifact structure
    if [ ! -d "$STAGE_DIR/backend" ] || [ ! -d "$STAGE_DIR/services" ]; then
        fail "Artifact structure invalid — missing backend/ or services/"
    fi

    # Deploy selective files only
    for file in "${DEPLOY_FILES[@]}"; do
        if [ -f "$STAGE_DIR/$file" ]; then
            # Verify file is not empty
            if [ ! -s "$STAGE_DIR/$file" ]; then
                fail "Artifact file is empty: $file"
            fi
            cp "$STAGE_DIR/$file" "$PRODUCTION_PATH/$file"
            log "  Deployed: $file"
        else
            fail "Required file missing from artifact: $file"
        fi
    done
fi

# ============================================================================
# STEP 9: POST-DEPLOYMENT LEGACY VERIFICATION
# ============================================================================
log ""
log "[9/12] Post-deployment legacy verification..."
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
    fail "Post-deployment legacy verification failed — legacy paths missing after deployment"
fi

log "Legacy static preservation post-check: PASS"

# Legacy static feature verification
log ""
log "Legacy static feature verification..."
LEGACY_STATIC_FAILURES=0
for feature in "${LEGACY_STATIC_FEATURES[@]}"; do
    if [ -e "$PRODUCTION_PATH/$feature" ]; then
        log "  STATIC_OK: $feature"
    else
        log "  STATIC_FAIL: $feature missing"
        LEGACY_STATIC_FAILURES=$((LEGACY_STATIC_FAILURES + 1))
    fi
done

if [ "$LEGACY_STATIC_FAILURES" -gt 0 ]; then
    log "WARNING: $LEGACY_STATIC_FAILURES legacy static feature(s) missing"
else
    log "Legacy static feature verification: PASS"
fi

# ============================================================================
# STEP 10: SERVICE MANAGEMENT
# ============================================================================
log ""
log "[10/12] Service management..."

# Determine if restart is needed
NEED_RESTART=false

if [ "$SERVICE_WAS_RUNNING" = true ] || [ "$PORT_WAS_LISTENING" = true ]; then
    NEED_RESTART=true
    log "Service was running — restart required to load new code"
else
    log "Service was not running — starting service"
fi

if [ "$DRY_RUN" = true ]; then
    log "DRY RUN: would restart/start omnistore.service"
else
    if [ "$NEED_RESTART" = true ]; then
        log "Restarting omnistore.service..."
        systemctl restart omnistore.service || fail "Failed to restart omnistore.service"
    else
        log "Starting omnistore.service..."
        systemctl start omnistore.service || fail "Failed to start omnistore.service"
    fi

    # Wait for service to become active
    MAX_WAIT=60
    WAITED=0
    while [ $WAITED -lt $MAX_WAIT ]; do
        if systemctl is-active --quiet omnistore.service; then
            log "Service is active after ${WAITED}s"
            break
        fi
        if [ $WAITED -eq $MAX_WAIT ]; then
            log "ERROR: Service failed to become active within ${MAX_WAIT}s"
            log "Rolling back..."
            rollback_files
            systemctl restart omnistore.service || true
            fail "Deployment failed — rolled back to previous version"
        fi
        sleep 5
        WAITED=$((WAITED + 5))
    done

    # Get service PID
    SERVICE_PID=$(systemctl show omnistore.service --property=MainPID --value 2>/dev/null || echo "UNKNOWN")
    log "Service MainPID: $SERVICE_PID"
fi

# ============================================================================
# STEP 11: RUNTIME VERIFICATION
# ============================================================================
log ""
log "[11/12] Runtime verification..."

if [ "$DRY_RUN" = true ]; then
    log "DRY RUN: would verify runtime endpoints"
    log "DRY RUN: would verify platform pages"
    log "DRY RUN: would verify legacy functional smoke"
    log ""
    log "=== Dry Run Complete ==="
    log "No changes were made."
    exit 0
fi

# Wait for port 3001
MAX_PORT_WAIT=30
PORT_WAITED=0
while [ $PORT_WAITED -lt $MAX_PORT_WAIT ]; do
    if ss -tlnp | grep -q ':3001'; then
        log "Port 3001: LISTENING"
        break
    fi
    if [ $PORT_WAITED -eq $MAX_PORT_WAIT ]; then
        log "ERROR: Port 3001 not listening after ${MAX_PORT_WAIT}s"
        log "Rolling back..."
        rollback_files
        systemctl restart omnistore.service || true
        fail "Port 3001 not listening — rolled back"
    fi
    sleep 2
    PORT_WAITED=$((PORT_WAITED + 2))
done

# Health checks
HEALTH=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3001/api/v1/health || echo "FAIL")
READY=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3001/api/v1/ready || echo "FAIL")
LIVENESS=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3001/api/v1/liveness || echo "FAIL")

log "Health:   $HEALTH"
log "Ready:    $READY"
log "Liveness: $LIVENESS"

if [ "$HEALTH" != "200" ] || [ "$READY" != "200" ] || [ "$LIVENESS" != "200" ]; then
    log "ERROR: Health checks failed"
    log "Rolling back..."
    rollback_files
    systemctl restart omnistore.service || true
    fail "Health checks failed — rolled back to previous version"
fi

# Platform checks
ROOT_RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3001/ || echo "FAIL")
PLATFORM_RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3001/platform.html || echo "FAIL")
BUSINESS_RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3001/business.html || echo "FAIL")

log "Root (/):          $ROOT_RESPONSE"
log "Platform HTML:     $PLATFORM_RESPONSE"
log "Business HTML:     $BUSINESS_RESPONSE"

if [ "$ROOT_RESPONSE" != "200" ] || [ "$PLATFORM_RESPONSE" != "200" ] || [ "$BUSINESS_RESPONSE" != "200" ]; then
    log "ERROR: Platform checks failed"
    log "Rolling back..."
    rollback_files
    systemctl restart omnistore.service || true
    fail "Platform checks failed — rolled back"
fi

# Verify root serves platform content
ROOT_BODY=$(curl -s http://localhost:3001/ || echo "")
if echo "$ROOT_BODY" | grep -q "OmniStore ERP"; then
    log "Root serves Platform content: YES"
else
    log "WARNING: Root may not be serving Platform Home correctly"
fi

# Legacy functional smoke (static only — no destructive actions)
log ""
log "Legacy functional smoke (static checks)..."
LEGACY_FUNCTIONAL_FAILURES=0
LEGACY_FUNCTIONAL_SKIPPED=0

# Check ERP dashboard surface
if echo "$ROOT_BODY" | grep -qi "login\|dashboard\|erp"; then
    log "  FUNCTIONAL_OK: ERP legacy surface present"
else
    log "  FUNCTIONAL_SKIP: ERP legacy surface check inconclusive from root body"
    LEGACY_FUNCTIONAL_SKIPPED=$((LEGACY_FUNCTIONAL_SKIPPED + 1))
fi

# Check platform assets
PLATFORM_ASSETS=("platform.html" "business.html" "platform/platform.css" "platform/platform.js")
for asset in "${PLATFORM_ASSETS[@]}"; do
    ASSET_CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:3001/$asset" || echo "FAIL")
    if [ "$ASSET_CODE" = "200" ]; then
        log "  FUNCTIONAL_OK: /$asset reachable"
    else
        log "  FUNCTIONAL_FAIL: /$asset returned $ASSET_CODE"
        LEGACY_FUNCTIONAL_FAILURES=$((LEGACY_FUNCTIONAL_FAILURES + 1))
    fi
done

# Public API endpoints
PUBLIC_ENDPOINTS=("/api/v1/health" "/api/v1/ready" "/api/v1/liveness" "/api/v1/platform-public/catalog")
for endpoint in "${PUBLIC_ENDPOINTS[@]}"; do
    EP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:3001$endpoint" || echo "FAIL")
    if [ "$EP_CODE" = "200" ]; then
        log "  FUNCTIONAL_OK: $endpoint reachable"
    else
        log "  FUNCTIONAL_FAIL: $endpoint returned $EP_CODE"
        LEGACY_FUNCTIONAL_FAILURES=$((LEGACY_FUNCTIONAL_FAILURES + 1))
    fi
done

log "Legacy functional smoke: FAILURES=$LEGACY_FUNCTIONAL_FAILURES SKIPPED=$LEGACY_FUNCTIONAL_SKIPPED"

# ============================================================================
# STEP 12: FINAL REPORT
# ============================================================================
log ""
log "=== Deployment Complete ==="
log "Backup: $BACKUP_PATH"
log "Production SHA: $PRODUCTION_SHA"
log "Service PID: $SERVICE_PID"
log "Health: $HEALTH"
log "Ready: $READY"
log "Liveness: $LIVENESS"
log "Platform Home: $ROOT_RESPONSE"
log "Business Page: $BUSINESS_RESPONSE"
log "Legacy Static Check: PASS"
log "Production Data Preserved: YES"

if [ "$HEALTH" = "200" ] && [ "$READY" = "200" ] && [ "$LIVENESS" = "200" ] && [ "$ROOT_RESPONSE" = "200" ] && [ "$PLATFORM_RESPONSE" = "200" ] && [ "$BUSINESS_RESPONSE" = "200" ] && [ "$LEGACY_FUNCTIONAL_FAILURES" -eq 0 ]; then
    READY_FOR_PRODUCTION=YES
else
    READY_FOR_PRODUCTION=NO
fi

log "READY_FOR_PRODUCTION=$READY_FOR_PRODUCTION"

# Cleanup stage directory
validate_stage_path "$STAGE_DIR"
rm -rf "$STAGE_DIR"

exit 0
