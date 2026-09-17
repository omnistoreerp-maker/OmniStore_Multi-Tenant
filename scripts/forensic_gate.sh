#!/bin/bash
# ============================================================================
# Production Forensic Gate - READ-ONLY Validation Script
# ============================================================================
# Purpose: Collect evidence from production to verify safety for deployment
# Usage:   bash forensic_gate.sh
# Status:  STRICTLY READ-ONLY - No mutations of any kind
# ============================================================================

set -uo pipefail

# ============================================================================
# Configuration
# ============================================================================
PRODUCTION_REPO="/home/omnistore/OmniStore_Multi-Tenant"
PRODUCTION_BACKUPS="/home/omnistore/omnistore-backups"
PRODUCTION_BASELINE_SHA="d596f2aabdb5c7a562dfe53af7c4b8b6673c4a6b"
EXPECTED_RELEASE_ARTIFACT_SHA256="e78438f53b0b1034e08b00286b5ae9e1328f335fd1e68732dfee4f65fc551c2e"
ACTUAL_ARTIFACT_SHA256="2609342c91dbbeb21f3e5bd4e61bdb357545909f2533c6d2c25ed208397d63f1"
PORT=3001

# Required application files (from deployment contract)
REQUIRED_APP_FILES=(
    "backend/server.js"
    "backend/utils/fileStore.js"
    "index.html"
    "package.json"
    "sw.js"
    "business.html"
)

# Platform files
PLATFORM_FILES=(
    "platform.html"
    "platform/platform.css"
    "platform/platform.js"
)

# Output tracking (safe arithmetic)
GATES_PASS=0
GATES_FAIL=0
GATES_UNVERIFIED=0
BLOCKERS=()

# ============================================================================
# Helper Functions
# ============================================================================
log() {
    echo "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] $1"
}

log_section() {
    echo ""
    echo "============================================================================"
    echo "$1"
    echo "============================================================================"
}

mark_pass() {
    log "PASS: $1"
    GATES_PASS=$((GATES_PASS + 1))
}

mark_fail() {
    log "FAIL: $1"
    GATES_FAIL=$((GATES_FAIL + 1))
    BLOCKERS+=("$1")
}

mark_unverified() {
    log "UNVERIFIED: $1"
    GATES_UNVERIFIED=$((GATES_UNVERIFIED + 1))
    BLOCKERS+=("UNVERIFIED: $1")
}

mark_blocked() {
    log "BLOCKED: $1"
    GATES_FAIL=$((GATES_FAIL + 1))
    BLOCKERS+=("$1")
}

# ============================================================================
# Gate 1: Repository State
# ============================================================================
log_section "GATE 1: Repository State (SHA, Branch, Working Tree)"

PRODUCTION_SHA="UNKNOWN"
PRODUCTION_BRANCH="UNKNOWN"
LOCAL_CHANGES_PRESENT="NO"

if cd "$PRODUCTION_REPO" 2>/dev/null; then
    log "Production Repository: $PRODUCTION_REPO"

    if git rev-parse --git-dir > /dev/null 2>&1; then
        PRODUCTION_SHA=$(git rev-parse HEAD 2>/dev/null || echo "UNKNOWN")
        PRODUCTION_BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "UNKNOWN")
        WORKTREE_STATUS=$(git status --porcelain 2>/dev/null || echo "ERROR")

        log "Production SHA:        $PRODUCTION_SHA"
        log "Production Branch:     $PRODUCTION_BRANCH"
        log "Production Baseline:   $PRODUCTION_BASELINE_SHA"

        if [[ "$PRODUCTION_SHA" == "$PRODUCTION_BASELINE_SHA" ]]; then
            mark_pass "Production HEAD matches baseline SHA"
        else
            mark_blocked "Production HEAD ($PRODUCTION_SHA) does not match baseline ($PRODUCTION_BASELINE_SHA)"
        fi

        log ""
        log "Working Tree Status Check:"
        if [[ -z "$WORKTREE_STATUS" ]]; then
            log "  Working tree is clean"
            mark_pass "Working tree clean"
        else
            LOCAL_CHANGES_PRESENT="YES"
            log "  Local modifications detected:"
            echo "$WORKTREE_STATUS" | while IFS= read -r line; do
                log "    $line"
            done

            log ""
            log "  Checking for protected file conflicts:"
            CONFLICTED_FILES=()
            for protected in "${REQUIRED_APP_FILES[@]}"; do
                if echo "$WORKTREE_STATUS" | grep -q "^..*$protected"; then
                    CONFLICTED_FILES+=("$protected")
                    log "    CONFLICT: $protected"
                fi
            done

            if [[ ${#CONFLICTED_FILES[@]} -gt 0 ]]; then
                mark_blocked "Local changes present in deployment files - LOCAL_CHANGE_PROTECTION=BLOCKED"
            else
                log "    No deployment files changed locally"
            fi
            mark_pass "Local changes inventoried (LOCAL_CHANGES_PRESENT=YES)"
        fi

        log ""
        log "Untracked Files:"
        UNTRACKED=$(git ls-files --others --exclude-standard 2>/dev/null || echo "")
        if [[ -z "$UNTRACKED" ]]; then
            log "  No untracked files"
        else
            echo "$UNTRACKED" | while IFS= read -r line; do
                log "  UNTRACKED: $line"
            done
            mark_fail "Untracked files detected"
        fi

        log ""
        log "Full diff (informational):"
        git diff 2>/dev/null || log "Unable to retrieve diff"
    else
        mark_fail "Not a valid git repository at $PRODUCTION_REPO"
    fi
else
    mark_fail "Cannot access production repository at $PRODUCTION_REPO"
fi

log ""
log "Output: PRODUCTION_SHA=$PRODUCTION_SHA"
log "Output: PRODUCTION_BRANCH=$PRODUCTION_BRANCH"
log "Output: LOCAL_CHANGES_PRESENT=$LOCAL_CHANGES_PRESENT"

# ============================================================================
# Gate 2: Service State (omnistore.service, MainPID)
# ============================================================================
log_section "GATE 2: Service State"

SERVICE="omnistore.service"
SERVICE_STATUS="unknown"
SERVICE_MAINPID="0"

if command -v systemctl &> /dev/null; then
    log "Checking: $SERVICE"

    svc_exists=$(systemctl list-unit-files "$SERVICE" 2>/dev/null | grep -c "$SERVICE" || true)
    if [[ "$svc_exists" -gt 0 ]]; then
        SERVICE_STATUS=$(systemctl is-active "$SERVICE" 2>/dev/null || echo "unknown")
        SERVICE_MAINPID=$(systemctl show -p MainPID --value "$SERVICE" 2>/dev/null || echo "0")

        log "  Service:     $SERVICE"
        log "  Status:      $SERVICE_STATUS"
        log "  MainPID:     $SERVICE_MAINPID"

        if [[ "$SERVICE_STATUS" == "active" && "$SERVICE_MAINPID" != "0" && "$SERVICE_MAINPID" != "" ]]; then
            mark_pass "$SERVICE is active with MainPID $SERVICE_MAINPID"
        else
            mark_fail "$SERVICE is not running (status: $SERVICE_STATUS, PID: $SERVICE_MAINPID)"
        fi
    else
        mark_unverified "$SERVICE unit not found via systemctl"
    fi

    log ""
    log "Checking nginx service independently:"
    nginx_exists=$(systemctl list-unit-files "nginx.service" 2>/dev/null | grep -c "nginx" || true)
    if [[ "$nginx_exists" -gt 0 ]]; then
        nginx_status=$(systemctl is-active "nginx.service" 2>/dev/null || echo "unknown")
        nginx_pid=$(systemctl show -p MainPID --value "nginx.service" 2>/dev/null || echo "0")
        log "  nginx.service status: $nginx_status, MainPID: $nginx_pid"
        if [[ "$nginx_status" == "active" ]]; then
            mark_pass "nginx.service is active"
        else
            mark_unverified "nginx.service status: $nginx_status"
        fi
    else
        log "  nginx.service unit not found via systemctl"
        mark_unverified "nginx.service unit not found"
    fi
else
    mark_unverified "systemctl not available - cannot query service state"

    log "Process check (fallback):"
    pid=$(pgrep -f "node.*omnistore" 2>/dev/null | head -1 || echo "")
    if [[ -n "$pid" ]]; then
        log "  Found node process: $pid"
        mark_pass "Process detected: node (PID: $pid)"
        SERVICE_STATUS="active"
        SERVICE_MAINPID="$pid"
    else
        log "  No node omnistore process found"
        mark_fail "No node omnistore process found"
    fi
fi

log ""
log "Output: SERVICE=$SERVICE"
log "Output: SERVICE_STATUS=$SERVICE_STATUS"
log "Output: SERVICE_MAINPID=$SERVICE_MAINPID"

# ============================================================================
# Gate 3: Port 3001
# ============================================================================
log_section "GATE 3: Port $PORT Availability"

PORT_PASS="FAIL"
if command -v ss &> /dev/null; then
    PORT_CHECK=$(ss -tlnp 2>/dev/null | grep ":$PORT" || true)
    if [[ -n "$PORT_CHECK" ]]; then
        log "Port $PORT is listening (ss):"
        log "  $PORT_CHECK"
        PORT_PASS="PASS"
        mark_pass "Port $PORT is listening"
    fi
elif command -v netstat &> /dev/null; then
    PORT_CHECK=$(netstat -tlnp 2>/dev/null | grep ":$PORT" || true)
    if [[ -n "$PORT_CHECK" ]]; then
        log "Port $PORT is listening (netstat):"
        log "  $PORT_CHECK"
        PORT_PASS="PASS"
        mark_pass "Port $PORT is listening"
    fi
else
    mark_unverified "Neither ss nor netstat available to check port $PORT"
    PORT_PASS="UNVERIFIED"
fi

if [[ "$PORT_PASS" == "FAIL" ]]; then
    mark_fail "Port $PORT is not listening"
fi

log ""
log "Output: PORT_3001=$PORT_PASS"

# ============================================================================
# Gate 4: Health/Readiness/Liveness Endpoints
# ============================================================================
log_section "GATE 4: Health/Readiness/Liveness Endpoints"

HEALTH_PASS="UNVERIFIED"
LIVENESS_PASS="UNVERIFIED"
READINESS_PASS="UNVERIFIED"

if command -v curl &> /dev/null; then
    log "Checking known endpoints:"

    for endpoint in "http://127.0.0.1:$PORT/api/v1/health" "http://localhost:$PORT/api/v1/health"; do
        log "  Checking: $endpoint"
        response=$(curl -s -o /dev/null -w "%{http_code}" --connect-timeout 5 "$endpoint" 2>/dev/null || echo "000")
        if [[ "$response" =~ ^2[0-9][0-9]$ ]]; then
            log "    HTTP $response - PASS"
            HEALTH_PASS="PASS"
        elif [[ "$response" == "000" ]]; then
            log "    Connection failed"
        else
            log "    HTTP $response"
        fi
    done

    for endpoint in "http://127.0.0.1:$PORT/api/v1/liveness" "http://localhost:$PORT/api/v1/liveness"; do
        log "  Checking: $endpoint"
        response=$(curl -s -o /dev/null -w "%{http_code}" --connect-timeout 5 "$endpoint" 2>/dev/null || echo "000")
        if [[ "$response" =~ ^2[0-9][0-9]$ ]]; then
            log "    HTTP $response - PASS"
            LIVENESS_PASS="PASS"
        elif [[ "$response" == "000" ]]; then
            log "    Connection failed"
        else
            log "    HTTP $response"
        fi
    done

    for endpoint in "http://127.0.0.1:$PORT/api/v1/ready" "http://localhost:$PORT/api/v1/ready"; do
        log "  Checking: $endpoint"
        response=$(curl -s -o /dev/null -w "%{http_code}" --connect-timeout 5 "$endpoint" 2>/dev/null || echo "000")
        if [[ "$response" =~ ^2[0-9][0-9]$ ]]; then
            log "    HTTP $response - PASS"
            READINESS_PASS="PASS"
        elif [[ "$response" == "000" ]]; then
            log "    Connection failed"
        else
            log "    HTTP $response"
        fi
    done

    log ""
    log "  Checking legacy endpoints (informational):"
    for endpoint in "http://127.0.0.1:$PORT/health" "http://127.0.0.1:$PORT/liveness" "http://127.0.0.1:$PORT/readiness"; do
        response=$(curl -s -o /dev/null -w "%{http_code}" --connect-timeout 5 "$endpoint" 2>/dev/null || echo "000")
        log "    $endpoint -> HTTP $response"
    done

    if [[ "$HEALTH_PASS" == "PASS" ]]; then
        mark_pass "Health endpoint is responding"
    else
        mark_fail "Health endpoint not responding correctly"
    fi

    if [[ "$LIVENESS_PASS" == "PASS" ]]; then
        mark_pass "Liveness endpoint is responding"
    else
        mark_fail "Liveness endpoint not responding correctly"
    fi

    if [[ "$READINESS_PASS" == "PASS" ]]; then
        mark_pass "Readiness endpoint is responding"
    else
        mark_fail "Readiness endpoint not responding correctly"
    fi
else
    mark_unverified "curl not available - cannot check health endpoints"
    HEALTH_PASS="UNVERIFIED"
    LIVENESS_PASS="UNVERIFIED"
    READINESS_PASS="UNVERIFIED"
fi

log ""
log "Output: HEALTH=$HEALTH_PASS"
log "Output: LIVENESS=$LIVENESS_PASS"
log "Output: READINESS=$READINESS_PASS"

# ============================================================================
# Gate 5: Platform Home Root (/) and Identity
# ============================================================================
log_section "GATE 5: Platform Home Root and Identity"

ROOT_HTTP="FAIL"
PLATFORM_HOME="UNVERIFIED"

log "Platform Home Root (/) directory listing:"
if [[ -d "/" ]]; then
    ls -la / 2>/dev/null | head -20 || log "  Unable to list root directory"
else
    mark_fail "Root filesystem not accessible"
fi

PLATFORM_ID_FILE="/etc/os-release"
if [[ -f "$PLATFORM_ID_FILE" ]]; then
    log ""
    log "OS Release Information:"
    grep -E "^(NAME|VERSION|ID|PRETTY_NAME)=" "$PLATFORM_ID_FILE" 2>/dev/null || true
    mark_pass "OS identity retrievable"
else
    mark_unverified "Cannot retrieve OS identity - $PLATFORM_ID_FILE not found"
fi

HOSTNAME_FILE="/etc/hostname"
if [[ -f "$HOSTNAME_FILE" ]]; then
    HOSTNAME_VAL=$(cat "$HOSTNAME_FILE" 2>/dev/null || echo "UNKNOWN")
    log ""
    log "Hostname: $HOSTNAME_VAL"
else
    HOSTNAME_VAL=$(hostname 2>/dev/null || echo "UNKNOWN")
    log "Hostname: $HOSTNAME_VAL"
fi

log ""
log "Checking HTTP Root for Platform Home identity:"
if command -v curl &> /dev/null; then
    root_response=$(curl -s -o /tmp/_fg_root_check -w "%{http_code}" --connect-timeout 5 "http://127.0.0.1:$PORT/" 2>/dev/null || echo "000")
    if [[ "$root_response" =~ ^2[0-9][0-9]$ ]]; then
        ROOT_HTTP="PASS"
        log "  HTTP root returned: $root_response"

        log ""
        log "  Checking for Platform Home identity markers in response:"
        root_content=$(cat /tmp/_fg_root_check 2>/dev/null || echo "")
        if echo "$root_content" | grep -q "OmniStore Platform" 2>/dev/null; then
            PLATFORM_HOME="PASS"
            log "  Found: OmniStore Platform"
        elif echo "$root_content" | grep -q "platform/platform.css" 2>/dev/null; then
            PLATFORM_HOME="PASS"
            log "  Found: platform/platform.css reference"
        else
            log "  Platform identity markers not found in HTTP response"
            PLATFORM_HOME="UNVERIFIED"
        fi
        rm -f /tmp/_fg_root_check 2>/dev/null || true
    else
        log "  HTTP root returned: $root_response"
        ROOT_HTTP="FAIL"
        mark_fail "HTTP root endpoint not accessible (status: $root_response)"
        rm -f /tmp/_fg_root_check 2>/dev/null || true
    fi
else
    mark_unverified "curl not available - cannot check HTTP root"
    ROOT_HTTP="UNVERIFIED"
    PLATFORM_HOME="UNVERIFIED"
fi

if [[ "$ROOT_HTTP" == "PASS" ]]; then
    mark_pass "HTTP root is accessible (HTTP 200)"
fi

if [[ "$PLATFORM_HOME" == "PASS" ]]; then
    mark_pass "Platform Home identity confirmed"
else
    mark_unverified "Platform Home identity could not be confirmed from HTTP root"
fi

log ""
log "Output: ROOT_HTTP=$ROOT_HTTP"
log "Output: PLATFORM_HOME=$PLATFORM_HOME"

# ============================================================================
# Gate 6: Required Application Files
# ============================================================================
log_section "GATE 6: Required Application Files"

ALL_FILES_PRESENT="YES"
for file in "${REQUIRED_APP_FILES[@]}"; do
    full_path="$PRODUCTION_REPO/$file"
    if [[ -f "$full_path" ]]; then
        file_sha=$(sha256sum "$full_path" 2>/dev/null | cut -d' ' -f1 || echo "UNKNOWN")
        log "  OK: $file (SHA256: $file_sha)"
        mark_pass "Required file exists: $file"
    else
        log "  MISSING: $file"
        mark_fail "Required application file missing: $file"
        ALL_FILES_PRESENT="NO"
    fi
done

log ""
log "Platform Files:"
for pfile in "${PLATFORM_FILES[@]}"; do
    full_path="$PRODUCTION_REPO/$pfile"
    if [[ -f "$full_path" ]]; then
        log "  OK: $pfile"
        mark_pass "Platform file exists: $pfile"
    else
        log "  MISSING: $pfile"
        mark_fail "Platform file missing: $pfile"
    fi
done

log ""
log "Environment File Check:"
if [[ -f "$PRODUCTION_REPO/backend/.env" ]]; then
    log "  backend/.env exists (contents NOT exposed)"
    mark_pass "backend/.env file present"
else
    mark_fail "backend/.env file missing"
fi

BACKEND_DATA_DIR="$PRODUCTION_REPO/backend/data"
if [[ -d "$BACKEND_DATA_DIR" ]]; then
    log "  backend/data directory exists"
    mark_pass "backend/data directory is present"
else
    mark_fail "backend/data directory does not exist"
fi

# ============================================================================
# Gate 7: Backend Data Inventory (READ-ONLY)
# ============================================================================
log_section "GATE 7: Backend Data Inventory"

if [[ -d "$BACKEND_DATA_DIR" ]]; then
    log "=== DATA FILES ==="
    (cd "$BACKEND_DATA_DIR" && find . -maxdepth 2 -type f \( -name "*.json" -o -name "*.sqlite" -o -name "*.db" \) 2>/dev/null | sort) | while IFS= read -r f; do
        size=$(stat -c%s "$f" 2>/dev/null || echo "0")
        log "  $f ($size bytes)"
    done

    log ""
    log "Total file count in backend/data:"
    find "$BACKEND_DATA_DIR" -type f 2>/dev/null | wc -l

    log ""
    log "Directory structure (max depth 2):"
    find "$BACKEND_DATA_DIR" -maxdepth 2 -type d 2>/dev/null | sort
else
    mark_fail "backend/data directory not accessible for inventory"
fi

# ============================================================================
# Gate 8: Data Integrity and Backup Evidence
# ============================================================================
log_section "GATE 8: Data Integrity and Backup Evidence"

DATA_INTEGRITY="UNVERIFIED"
BACKUP_INTEGRITY="UNVERIFIED"

log "Live Data File Checksums (SHA256 - READ-ONLY):"
if [[ -d "$BACKEND_DATA_DIR" ]]; then
    (cd "$BACKEND_DATA_DIR" && find . -maxdepth 1 -type f -exec sha256sum {} \; 2>/dev/null) || log "  Unable to compute checksums"
fi

log ""
log "Backup Evidence:"

if [[ -d "$PRODUCTION_BACKUPS" ]]; then
    log "Backups directory: $PRODUCTION_BACKUPS"
    log ""
    log "Backup files:"
    find "$PRODUCTION_BACKUPS" -maxdepth 1 -type f 2>/dev/null | while IFS= read -r backup; do
        backup_size=$(stat -c%s "$backup" 2>/dev/null || echo "0")
        backup_date=$(stat -c%y "$backup" 2>/dev/null || echo "UNKNOWN")
        log "  $(basename "$backup") ($backup_size bytes, modified: $backup_date)"
        mark_pass "Backup file present: $(basename "$backup")"
    done

    log ""
    log "Latest backup (by modification time):"
    LATEST_BACKUP=$(find "$PRODUCTION_BACKUPS" -maxdepth 1 -type f -printf '%T@ %p\n' 2>/dev/null | sort -rn | head -1 | cut -d' ' -f2-)
    if [[ -n "$LATEST_BACKUP" ]]; then
        log "  Latest: $LATEST_BACKUP"
        log "  Size: $(stat -c%s "$LATEST_BACKUP" 2>/dev/null || echo 'N/A') bytes"
        log "  Date: $(stat -c%y "$LATEST_BACKUP" 2>/dev/null || echo 'N/A')"
        mark_pass "Latest backup evidence collected"

        log ""
        log "Backup archive integrity check (read-only test):"
        if [[ "$LATEST_BACKUP" == *.tar.gz ]]; then
            if gzip -t "$LATEST_BACKUP" 2>/dev/null; then
                log "  tar.gz archive integrity: OK"
                BACKUP_INTEGRITY="PASS"
                mark_pass "Latest backup archive integrity verified (gzip -t)"
            else
                log "  tar.gz archive integrity test failed or requires permissions"
                BACKUP_INTEGRITY="UNVERIFIED"
                mark_unverified "Could not verify backup archive integrity"
            fi
        fi
    else
        mark_fail "No backup files found in $PRODUCTION_BACKUPS"
    fi
else
    mark_fail "Backups directory not found: $PRODUCTION_BACKUPS"
fi

log ""
log "Output: DATA_INTEGRITY=$DATA_INTEGRITY"
log "Output: BACKUP_INTEGRITY=$BACKUP_INTEGRITY"

# ============================================================================
# Gate 9: Deployment Artifact Verification
# ============================================================================
log_section "GATE 9: Deployment Artifact Verification"

log "Artifact SHA References:"
log "  PRODUCTION_BASELINE_SHA:           $PRODUCTION_BASELINE_SHA"
log "  EXPECTED_RELEASE_ARTIFACT_SHA256:  $EXPECTED_RELEASE_ARTIFACT_SHA256"
log "  ACTUAL_ARTIFACT_SHA256:            $ACTUAL_ARTIFACT_SHA256"
log ""

ARTIFACT_PRESENT="NO"
ARTIFACT_ACTUAL_SHA=""
ARTIFACT_LOCATION=""

RELEASE_ARTIFACT="/tmp/RELEASE_ARTIFACT.zip"

if [[ -f "$RELEASE_ARTIFACT" ]]; then
    ARTIFACT_ACTUAL_SHA=$(sha256sum "$RELEASE_ARTIFACT" 2>/dev/null | cut -d' ' -f1 || echo "UNKNOWN")
    log "  Found at: $RELEASE_ARTIFACT"
    log "  SHA256: $ARTIFACT_ACTUAL_SHA"
    ARTIFACT_PRESENT="YES"
    ARTIFACT_LOCATION="$RELEASE_ARTIFACT"
fi

if [[ "$ARTIFACT_PRESENT" == "YES" ]]; then
    log ""
    log "Artifact SHA256 Comparison:"
    log "  Artifact Location:         $ARTIFACT_LOCATION"
    log "  Artifact ACTUAL SHA256:    $ARTIFACT_ACTUAL_SHA"
    log "  EXPECTED SHA256 (from script): $EXPECTED_RELEASE_ARTIFACT_SHA256"

    if [[ "${ARTIFACT_ACTUAL_SHA,,}" == "${EXPECTED_RELEASE_ARTIFACT_SHA256,,}" ]]; then
        mark_pass "Artifact SHA256 matches expected release SHA256"
    else
        log "  Mismatch detected (KNOWN MISMATCH):"
        log "    Expected: $EXPECTED_RELEASE_ARTIFACT_SHA256"
        log "    Actual:   $ARTIFACT_ACTUAL_SHA"
        mark_fail "Artifact SHA256 mismatch - expected: $EXPECTED_RELEASE_ARTIFACT_SHA256, actual: $ARTIFACT_ACTUAL_SHA"
    fi
else
    mark_fail "Deployment artifact /tmp/RELEASE_ARTIFACT.zip not found"
fi

log ""
log "Output: ARTIFACT_PRESENT=$ARTIFACT_PRESENT"
log "Output: EXPECTED_RELEASE_ARTIFACT_SHA256=$EXPECTED_RELEASE_ARTIFACT_SHA256"
log "Output: ACTUAL_RELEASE_ARTIFACT_SHA256=$ARTIFACT_ACTUAL_SHA"
log "Output: ARTIFACT_SHA256=$(if [[ "$ARTIFACT_PRESENT" == "YES" ]]; then if [[ "${ARTIFACT_ACTUAL_SHA,,}" == "${EXPECTED_RELEASE_ARTIFACT_SHA256,,}" ]]; then echo "PASS"; else echo "FAIL"; fi; else echo "FAIL"; fi)"

# ============================================================================
# Gate 10: Deployment Script Integrity
# ============================================================================
log_section "GATE 10: Deployment Script Integrity"

DEPLOY_SCRIPT="$PRODUCTION_REPO/scripts/deploy-production.sh"
DEPLOY_SCRIPT_ACTUAL_SHA="UNKNOWN"
DEPLOY_SCRIPT_INTEGRITY="UNVERIFIED"

if [[ -f "$DEPLOY_SCRIPT" ]]; then
    log "  Deployment script found at: $DEPLOY_SCRIPT"
    DEPLOY_SCRIPT_ACTUAL_SHA=$(sha256sum "$DEPLOY_SCRIPT" 2>/dev/null | cut -d' ' -f1 || echo "UNKNOWN")
    log "  DEPLOY_SCRIPT_ACTUAL_SHA256: $DEPLOY_SCRIPT_ACTUAL_SHA"

    log ""
    log "  Syntax check (read-only):"
    if bash -n "$DEPLOY_SCRIPT" 2>/dev/null; then
        log "  Syntax: VALID"
    else
        log "  Syntax: INVALID"
        mark_fail "Deployment script has syntax errors"
    fi

    log ""
    log "  SHA256 Verification:"
    log "  DEPLOY_SCRIPT_ACTUAL_SHA256:     $DEPLOY_SCRIPT_ACTUAL_SHA"
    log "  No expected deployment script SHA is documented independently."
    log "  The value e78438f... is RELEASE_SHA256, NOT deployment-script SHA."
    DEPLOY_SCRIPT_INTEGRITY="UNVERIFIED"
    mark_unverified "No documented expected deployment-script SHA - cannot verify integrity"
    log "  (Expected SHA must be provided from an independent trusted source)"
else
    mark_unverified "Deployment script not found: $DEPLOY_SCRIPT"
    DEPLOY_SCRIPT_INTEGRITY="UNVERIFIED"
fi

log ""
log "Output: DEPLOY_SCRIPT_ACTUAL_SHA256=$DEPLOY_SCRIPT_ACTUAL_SHA"
log "Output: DEPLOY_SCRIPT_INTEGRITY=$DEPLOY_SCRIPT_INTEGRITY"

# ============================================================================
# Gate 11: Deployment Safety Blockers
# ============================================================================
log_section "GATE 11: Deployment Safety Blockers"

log "Checking deployment safety blockers..."

    LOCK_FILES=("$PRODUCTION_REPO/.deploy.lock" "$PRODUCTION_REPO/DEPLOY_LOCKED" "/tmp/deploy.lock")
for lock in "${LOCK_FILES[@]}"; do
    if [[ -f "$lock" ]]; then
        log "  LOCK file detected: $lock"
        mark_blocked "Deployment blocked by lock file: $lock"
    else
        log "  No lock file at: $lock"
    fi
done

if pgrep -f "deploy-production" > /dev/null 2>&1; then
    mark_blocked "Deploy script appears to be running"
else
    log "  No active deployment process detected"
fi

if pgrep -f "migration" > /dev/null 2>&1; then
    mark_blocked "Migration process detected - data may be in inconsistent state"
else
    log "  No migration processes detected"
fi

log ""
log "Output: LOCAL_CHANGE_PROTECTION=$([ "$LOCAL_CHANGES_PRESENT" == "YES" ] && echo BLOCKED || echo PASS)"

# ============================================================================
# Gate 12: Nginx State (Read-only Verification)
# ============================================================================
log_section "GATE 12: Nginx State (Read-only)"

NGINX_CONFIG_CHECK="UNVERIFIED"

if command -v nginx &> /dev/null; then
    log "Nginx binary found: $(command -v nginx 2>/dev/null)"

    log ""
    log "Nginx configuration test (read-only - does NOT reload or modify):"
    nginx_test_output=$(nginx -t 2>&1 || true)
    log "  Output: $nginx_test_output"

    if [[ "$nginx_test_output" == *"syntax is ok"* ]] && [[ "$nginx_test_output" == *"test is successful"* ]]; then
        NGINX_CONFIG_CHECK="PASS"
        mark_pass "Nginx configuration test passed"
    elif [[ "$nginx_test_output" == *"permission"* ]] || [[ "$nginx_test_output" == *"Permission"* ]]; then
        NGINX_CONFIG_CHECK="UNVERIFIED"
        mark_unverified "Nginx config test requires elevated permissions"
    else
        NGINX_CONFIG_CHECK="FAIL"
        mark_fail "Nginx configuration test failed"
    fi
else
    log "Nginx binary not found in PATH"
    NGINX_CONFIG_CHECK="UNVERIFIED"
    mark_unverified "nginx binary not found - cannot verify nginx state"
fi

NGINX_CONF="$PRODUCTION_REPO/nginx/omnistore.conf"
if [[ -f "$NGINX_CONF" ]]; then
    log ""
    log "Nginx config file found: $NGINX_CONF"
    log "  File details:"
    ls -la "$NGINX_CONF" 2>/dev/null || true
    NGINX_CONF_SHA=$(sha256sum "$NGINX_CONF" 2>/dev/null | cut -d' ' -f1 || echo "UNKNOWN")
    log "  Config SHA256: $NGINX_CONF_SHA"
    mark_pass "Nginx configuration file exists"
else
    mark_unverified "Nginx config not found: $NGINX_CONF"
fi

NGINX_PID=$(pgrep nginx 2>/dev/null | head -1 || echo "")
if [[ -n "$NGINX_PID" ]]; then
    log ""
    log "Nginx process detected (PID: $NGINX_PID)"
    ps -p "$NGINX_PID" -o pid,ppid,user,args 2>/dev/null || log "  Unable to read process details"
    mark_pass "Nginx process is detected"
else
    log "  No nginx process detected"
    mark_unverified "Nginx process not found"
fi

if pgrep cloudflared > /dev/null 2>&1; then
    log ""
    log "Cloudflare tunnel process detected"
    CLOUDFLARE_PID=$(pgrep cloudflared 2>/dev/null | head -1 || echo "")
    log "  Cloudflared PID: $CLOUDFLARE_PID"
else
    log "  No cloudflared process detected"
fi

log ""
log "Output: NGINX_CONFIG_CHECK=$NGINX_CONFIG_CHECK"

# ============================================================================
# Final Summary
# ============================================================================
log_section "FINAL PRODUCTION FORENSIC GATE SUMMARY"

log "Gate Results:"
log "  GATES_PASS:       $GATES_PASS"
log "  GATES_FAIL:       $GATES_FAIL"
log "  GATES_UNVERIFIED: $GATES_UNVERIFIED"

if [[ ${#BLOCKERS[@]} -gt 0 ]]; then
    log ""
    log "BLOCKERS (${#BLOCKERS[@]}):"
    for i in "${!BLOCKERS[@]}"; do
        log "  $((i+1)). ${BLOCKERS[$i]}"
    done
else
    log ""
    log "No blockers detected."
fi

log ""
log "Key Output Values:"
log "  PRODUCTION_SHA=$PRODUCTION_SHA"
log "  PRODUCTION_BRANCH=$PRODUCTION_BRANCH"
log "  LOCAL_CHANGES_PRESENT=$LOCAL_CHANGES_PRESENT"
log "Output: LOCAL_CHANGE_PROTECTION=$([ "$LOCAL_CHANGES_PRESENT" == "YES" ] && echo BLOCKED || echo PASS)"
log "  SERVICE=$SERVICE"
log "  SERVICE_STATUS=$SERVICE_STATUS"
log "  SERVICE_MAINPID=$SERVICE_MAINPID"
log "  PORT_3001=$PORT_PASS"
log "  HEALTH=$HEALTH_PASS"
log "  LIVENESS=$LIVENESS_PASS"
log "  READINESS=$READINESS_PASS"
log "  ROOT_HTTP=$ROOT_HTTP"
log "  PLATFORM_HOME=$PLATFORM_HOME"
log "  DATA_INTEGRITY=$DATA_INTEGRITY"
log "  BACKUP_INTEGRITY=$BACKUP_INTEGRITY"
log "  ARTIFACT_PRESENT=$ARTIFACT_PRESENT"
log "  EXPECTED_RELEASE_ARTIFACT_SHA256=$EXPECTED_RELEASE_ARTIFACT_SHA256"
log "  ACTUAL_RELEASE_ARTIFACT_SHA256=$ARTIFACT_ACTUAL_SHA"
ARTIFACT_SHA256_RESULT="FAIL"
if [[ "$ARTIFACT_PRESENT" == "YES" ]]; then
    if [[ "${ARTIFACT_ACTUAL_SHA,,}" == "${EXPECTED_RELEASE_ARTIFACT_SHA256,,}" ]]; then
        ARTIFACT_SHA256_RESULT="PASS"
    fi
fi
log "  ARTIFACT_SHA256=$ARTIFACT_SHA256_RESULT"
log "  DEPLOY_SCRIPT_ACTUAL_SHA256=$DEPLOY_SCRIPT_ACTUAL_SHA"
log "  DEPLOY_SCRIPT_INTEGRITY=$DEPLOY_SCRIPT_INTEGRITY"
log "  NGINX_CONFIG_CHECK=$NGINX_CONFIG_CHECK"

log ""
log "============================================================================"
log "DEPLOYMENT DECISION LOGIC:"
log "  FAIL        -> GATES_FAIL > 0 (any failed gate blocks deployment)"
log "  UNVERIFIED  -> Cannot collect required evidence (manual review needed)"
log "  PASS        -> All gates passed, no failures, no unverified items"
log "============================================================================"

if [[ $GATES_FAIL -gt 0 ]]; then
    log ""
    log "FINAL_PRODUCTION_FORENSIC_GATE=FAIL"
    log ""
    log "Deployment is BLOCKED. Address the following blockers:"
    for blocker in "${BLOCKERS[@]}"; do
        log "  - $blocker"
    done
    exit 1
elif [[ $GATES_UNVERIFIED -gt 0 ]]; then
    log ""
    log "FINAL_PRODUCTION_FORENSIC_GATE=UNVERIFIED"
    log ""
    log "Insufficient verified evidence to make deployment decision."
    log "Review UNVERIFIED items:"
    for unv in "${BLOCKERS[@]}"; do
        log "  - $unv"
    done
    exit 2
else
    log ""
    log "FINAL_PRODUCTION_FORENSIC_GATE=PASS"
    log ""
    log "All checks passed. Production is ready for deployment."
    exit 0
fi