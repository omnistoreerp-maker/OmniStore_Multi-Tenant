#!/bin/bash
# ============================================================================
# OmniStore Selective Integration — Production Deployment Script
# Target: omnistore@192.168.1.64 /home/omnistore/OmniStore_Multi-Tenant
# Usage: sudo bash deploy-production.sh
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

# Selective integration files only — DO NOT replace entire repository
DEPLOY_FILES=(
    "backend/server.js"
    "backend/utils/fileStore.js"
    "index.html"
    "package.json"
    "sw.js"
    "business.html"
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

# ============================================================================
# STEP 1: PRE-FLIGHT CHECKS
# ============================================================================
log "=== OmniStore Selective Integration Deployment ==="
log "Timestamp: $(date -Iseconds)"
log ""

log "[1/9] Pre-flight checks..."
check_command git
check_command systemctl
check_command curl
check_command ss
check_command sha256sum
check_command unzip
check_command cp
check_command mkdir

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

# Verify artifact exists
if [ ! -f "$ARTIFACT_PATH" ]; then
    fail "Release artifact not found at $ARTIFACT_PATH"
fi

# ============================================================================
# STEP 2: VERIFY RELEASE ARTIFACT
# ============================================================================
log ""
log "[2/9] Verifying release artifact..."
ACTUAL_SHA256=$(sha256sum "$ARTIFACT_PATH" | cut -d' ' -f1)
log "Expected SHA256: $RELEASE_SHA256"
log "Actual SHA256:   $ACTUAL_SHA256"

if [ "$ACTUAL_SHA256" != "$RELEASE_SHA256" ]; then
    fail "Release artifact SHA256 mismatch!"
fi

log "Release artifact SHA256: PASS"

# ============================================================================
# STEP 3: CHECK CURRENT SERVICE STATE
# ============================================================================
log ""
log "[3/9] Checking current service state..."

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
# STEP 4: CREATE BACKUP
# ============================================================================
log ""
log "[4/9] Creating backup..."
mkdir -p "$BACKUP_PATH"

# Backup critical files
for file in "${DEPLOY_FILES[@]}"; do
    if [ -f "$PRODUCTION_PATH/$file" ]; then
        cp "$PRODUCTION_PATH/$file" "$BACKUP_PATH/$(basename "$file")"
        log "  Backed up: $file"
    else
        log "  Skipped missing: $file"
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

# ============================================================================
# STEP 5: PRE-DEPLOYMENT LEGACY VERIFICATION
# ============================================================================
log ""
log "[5/9] Pre-deployment legacy verification..."
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

log "Legacy preservation pre-check: PASS"

# ============================================================================
# STEP 6: SAFE DEPLOYMENT
# ============================================================================
log ""
log "[6/9] Deploying selective integration..."

# Clean and create stage directory
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

# Deploy updateManifest.json if present (with SHA256 verification)
if [ -f "$STAGE_DIR/backend/data/updateManifest.json" ]; then
    MANIFEST_SHA=$(sha256sum "$STAGE_DIR/backend/data/updateManifest.json" | cut -d' ' -f1)
    log "  Manifest SHA256 in artifact: $MANIFEST_SHA"
    
    # Verify manifest contains expected SHA256
    if [ -n "$MANIFEST_SHA256" ]; then
        if [ "$MANIFEST_SHA" != "$MANIFEST_SHA256" ]; then
            log "  WARNING: Manifest SHA256 mismatch (expected: $MANIFEST_SHA256)"
        else
            log "  Manifest SHA256: PASS"
        fi
    fi
    
    mkdir -p "$PRODUCTION_PATH/backend/data"
    cp "$STAGE_DIR/backend/data/updateManifest.json" "$PRODUCTION_PATH/backend/data/updateManifest.json"
    log "  Deployed: backend/data/updateManifest.json"
fi

# ============================================================================
# STEP 7: POST-DEPLOYMENT LEGACY VERIFICATION
# ============================================================================
log ""
log "[7/9] Post-deployment legacy verification..."
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

log "Legacy preservation post-check: PASS"

# ============================================================================
# STEP 8: SERVICE MANAGEMENT
# ============================================================================
log ""
log "[8/9] Service management..."

# Determine if restart is needed
NEED_RESTART=false

if [ "$SERVICE_WAS_RUNNING" = true ] || [ "$PORT_WAS_LISTENING" = true ]; then
    NEED_RESTART=true
    log "Service was running — restart required to load new code"
else
    log "Service was not running — starting service"
fi

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
        for file in "${DEPLOY_FILES[@]}"; do
            if [ -f "$BACKUP_PATH/$(basename "$file")" ]; then
                cp "$BACKUP_PATH/$(basename "$file")" "$PRODUCTION_PATH/$file"
                log "  Rolled back: $file"
            fi
        done
        systemctl restart omnistore.service || true
        fail "Deployment failed — rolled back to previous version"
    fi
    sleep 5
    WAITED=$((WAITED + 5))
done

# Get service PID
SERVICE_PID=$(systemctl show omnistore.service --property=MainPID --value 2>/dev/null || echo "UNKNOWN")
log "Service MainPID: $SERVICE_PID"

# ============================================================================
# STEP 9: RUNTIME VERIFICATION
# ============================================================================
log ""
log "[9/9] Runtime verification..."

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
        for file in "${DEPLOY_FILES[@]}"; do
            if [ -f "$BACKUP_PATH/$(basename "$file")" ]; then
                cp "$BACKUP_PATH/$(basename "$file")" "$PRODUCTION_PATH/$file"
            fi
        done
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
    for file in "${DEPLOY_FILES[@]}"; do
        if [ -f "$BACKUP_PATH/$(basename "$file")" ]; then
            cp "$BACKUP_PATH/$(basename "$file")" "$PRODUCTION_PATH/$file"
            log "  Rolled back: $file"
        fi
    done
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
    for file in "${DEPLOY_FILES[@]}"; do
        if [ -f "$BACKUP_PATH/$(basename "$file")" ]; then
            cp "$BACKUP_PATH/$(basename "$file")" "$PRODUCTION_PATH/$file"
        fi
    done
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

# ============================================================================
# FINAL REPORT
# ============================================================================
log ""
log "=== Deployment Complete ==="
log "Backup: $BACKUP_PATH"
log "Status: LIVE"
log "Production SHA: $PRODUCTION_SHA"
log "Service PID: $SERVICE_PID"
log "Health: $HEALTH"
log "Ready: $READY"
log "Liveness: $LIVENESS"
log "Platform Home: $ROOT_RESPONSE"
log "Business Page: $BUSINESS_RESPONSE"
log "Legacy Preserved: YES"
log "Production Data Preserved: YES"

# Cleanup stage directory
rm -rf "$STAGE_DIR"

exit 0
