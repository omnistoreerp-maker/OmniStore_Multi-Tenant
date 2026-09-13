#!/usr/bin/env bash
# =============================================================================
# PRODUCTION PREFLIGHT V4 — READ-ONLY COMPATIBILITY AUDIT
# Paste this entire block into: omnistore@omnistore:~$
# =============================================================================
set -o pipefail

REPORT="/tmp/production_preflight_v4_$(date +%Y%m%d_%H%M%S).txt"
mkdir -p "$(dirname "$REPORT")"

{
  echo "=== PRODUCTION PREFLIGHT V4 ==="
  echo "TIMESTAMP=$(date -Is)"
  echo "READ_ONLY=PASS"
  echo ""

  # ==========================================
  # 1. LIVE SERVICE DEFINITION
  # ==========================================
  echo "=== 1. LIVE SERVICE DEFINITION ==="
  SERVICE_NAME="omnistore.service"
  if systemctl list-unit-files | grep -q "^${SERVICE_NAME}"; then
    echo "SERVICE_NAME=$SERVICE_NAME"
    echo "SERVICE_UNIT_PATH=$(systemctl show -p FragmentPath --value "$SERVICE_NAME" 2>/dev/null || true)"
    echo "SERVICE_EXECSTART=$(systemctl show -p ExecStart --value "$SERVICE_NAME" 2>/dev/null || true)"
    echo "SERVICE_WORKING_DIRECTORY=$(systemctl show -p WorkingDirectory --value "$SERVICE_NAME" 2>/dev/null || true)"
    echo "SERVICE_USER=$(systemctl show -p User --value "$SERVICE_NAME" 2>/dev/null || true)"
    echo "SERVICE_RESTART=$(systemctl show -p Restart --value "$SERVICE_NAME" 2>/dev/null || true)"
    echo "SERVICE_RESTARTSEC=$(systemctl show -p RestartSec --value "$SERVICE_NAME" 2>/dev/null || true)"
    echo "SERVICE_ENVIRONMENT_FILE=$(systemctl show -p EnvironmentFile --value "$SERVICE_NAME" 2>/dev/null | tr ' ' '\n' | grep -v '^$' | head -5 | tr '\n' '; ' || true)"
    echo "SERVICE_ACTIVE=$(systemctl is-active "$SERVICE_NAME" 2>/dev/null || echo UNKNOWN)"
    echo "SERVICE_ENABLED=$(systemctl is-enabled "$SERVICE_NAME" 2>/dev/null || echo UNKNOWN)"
    echo "SERVICE_MAINPID=$(systemctl show -p MainPID --value "$SERVICE_NAME" 2>/dev/null || echo UNKNOWN)"
  else
    echo "SERVICE_NAME=$SERVICE_NAME"
    echo "SERVICE_UNIT_PATH=$(systemctl show -p FragmentPath --value "$SERVICE_NAME" 2>/dev/null || true)"
    echo "SERVICE_EXECSTART=$(systemctl show -p ExecStart --value "$SERVICE_NAME" 2>/dev/null || true)"
    echo "SERVICE_WORKING_DIRECTORY=$(systemctl show -p WorkingDirectory --value "$SERVICE_NAME" 2>/dev/null || true)"
    echo "SERVICE_USER=$(systemctl show -p User --value "$SERVICE_NAME" 2>/dev/null || true)"
    echo "SERVICE_RESTART=$(systemctl show -p Restart --value "$SERVICE_NAME" 2>/dev/null || true)"
    echo "SERVICE_RESTARTSEC=$(systemctl show -p RestartSec --value "$SERVICE_NAME" 2>/dev/null || true)"
    echo "SERVICE_ENVIRONMENT_FILE=$(systemctl show -p EnvironmentFile --value "$SERVICE_NAME" 2>/dev/null | tr ' ' '\n' | grep -v '^$' | head -5 | tr '\n' '; ' || true)"
    echo "SERVICE_ACTIVE=$(systemctl is-active "$SERVICE_NAME" 2>/dev/null || echo UNKNOWN)"
    echo "SERVICE_ENABLED=$(systemctl is-enabled "$SERVICE_NAME" 2>/dev/null || echo UNKNOWN)"
    echo "SERVICE_MAINPID=$(systemctl show -p MainPID --value "$SERVICE_NAME" 2>/dev/null || echo UNKNOWN)"
  fi
  echo ""

  # ==========================================
  # 2. PRODUCTION STARTUP
  # ==========================================
  echo "=== 2. PRODUCTION STARTUP ==="
  START_SCRIPT_CANDIDATES=(
    "/home/omnistore/OmniStore_Multi-Tenant/backend/scripts/start-production.js"
    "/opt/digitronics/backend/scripts/start-production.js"
    "/home/omnistore/OmniStore_Multi-Tenant/backend/server.js"
    "/opt/digitronics/backend/server.js"
  )
  START_SCRIPT="NOT_FOUND"
  for f in "${START_SCRIPT_CANDIDATES[@]}"; do
    if [ -f "$f" ]; then
      START_SCRIPT="$f"
      echo "START_SCRIPT=$f"
      echo "START_SCRIPT_SIZE=$(wc -c < "$f")"
      echo "START_SCRIPT_HEAD=$(head -20 "$f" 2>/dev/null || echo UNKNOWN)"
      break
    fi
  done
  if [ "$START_SCRIPT" = "NOT_FOUND" ]; then
    echo "START_SCRIPT=NOT_FOUND"
  fi
  echo ""

  # ==========================================
  # 3. CURRENT LIVE APPLICATION ROUTES
  # ==========================================
  echo "=== 3. CURRENT LIVE APPLICATION ROUTES ==="
  SERVER_CANDIDATES=(
    "/home/omnistore/OmniStore_Multi-Tenant/backend/server.js"
    "/opt/digitronics/backend/server.js"
  )
  SERVER_FILE="NOT_FOUND"
  for f in "${SERVER_CANDIDATES[@]}"; do
    if [ -f "$f" ]; then
      SERVER_FILE="$f"
      echo "SERVER_FILE=$f"
      echo "SERVER_FILE_SIZE=$(wc -c < "$f")"
      echo "MOUNTED_ROUTES=$(grep -n "app.use(" "$f" 2>/dev/null | head -40 || echo UNKNOWN)"
      echo "STATIC_DIRS=$(grep -n "express.static\|sendFile\|sendFile(" "$f" 2>/dev/null | head -20 || echo UNKNOWN)"
      echo "REQUIRED_MODULES=$(grep -n "require(" "$f" 2>/dev/null | head -40 || echo UNKNOWN)"
      break
    fi
  done
  if [ "$SERVER_FILE" = "NOT_FOUND" ]; then
    echo "SERVER_FILE=NOT_FOUND"
  fi
  echo ""

  # ==========================================
  # 4. FRONTEND FUNCTIONALITY
  # ==========================================
  echo "=== 4. FRONTEND FUNCTIONALITY ==="
  FRONTEND_BASE="/home/omnistore/OmniStore_Multi-Tenant"
  if [ ! -d "$FRONTEND_BASE" ]; then
    FRONTEND_BASE="/opt/digitronics/backend/.."
  fi
  echo "FRONTEND_BASE=$FRONTEND_BASE"
  for f in \
    "$FRONTEND_BASE/platform.html" \
    "$FRONTEND_BASE/business.html" \
    "$FRONTEND_BASE/index.html" \
    "$FRONTEND_BASE/company/index.html" \
    "$FRONTEND_BASE/customer/index.html" \
    "$FRONTEND_BASE/internal/index.html" \
    "$FRONTEND_BASE/market/index.html"; do
    if [ -f "$f" ]; then
      echo "PRESENT:$f"
    else
      echo "MISSING:$f"
    fi
  done
  echo ""

  # ==========================================
  # 5. RC COMPATIBILITY GAP
  # ==========================================
  echo "=== 5. RC COMPATIBILITY GAP ==="
  RC_SHA="1f688ac4241df947d9ac0493501dae1c04478a76"
  if [ -d ".git" ]; then
    echo "GIT_REPO=YES"
    if git cat-file -e "$RC_SHA^{commit}" 2>/dev/null; then
      echo "RC_OBJECT=PRESENT_LOCALLY"
      echo "RC_DIFF_STAT=$(git diff --stat HEAD "$RC_SHA" 2>/dev/null | tail -1 || echo UNKNOWN)"
      echo "RC_DIFF_FILES=$(git diff --name-status HEAD "$RC_SHA" 2>/dev/null | head -100 || echo UNKNOWN)"
    else
      echo "RC_OBJECT=NOT_PRESENT"
      echo "RC_DIFF_STAT=SKIPPED"
      echo "RC_DIFF_FILES=SKIPPED"
    fi
  else
    echo "GIT_REPO=NO"
    echo "RC_OBJECT=UNKNOWN"
  fi
  echo ""

  # ==========================================
  # 6. PRODUCTION DATA SAFETY
  # ==========================================
  echo "=== 6. PRODUCTION DATA SAFETY ==="
  DATA_CANDIDATES=(
    "/home/omnistore/OmniStore_Multi-Tenant/backend/data"
    "/opt/digitronics/backend/data"
    "/home/omnistore/data"
  )
  for d in "${DATA_CANDIDATES[@]}"; do
    if [ -d "$d" ]; then
      echo "DATA_DIR=$d"
      echo "DATA_FILES=$(ls -la "$d" 2>/dev/null | head -30 || echo UNKNOWN)"
      echo "DATA_COUNT=$(ls -1 "$d" 2>/dev/null | wc -l || echo UNKNOWN)"
      break
    fi
  done
  echo ""

  # ==========================================
  # 7. BACKUP DISCOVERY
  # ==========================================
  echo "=== 7. BACKUP DISCOVERY ==="
  BACKUP_FOUND="NO"
  for d in /home/omnistore/backups /opt/digitronics/backups /var/backups/omnistore /home/omnistore/OmniStore_Multi-Tenant/backups /home/omnistore/backups /opt/backups; do
    if [ -d "$d" ]; then
      echo "BACKUP_DIR=$d"
      echo "BACKUP_LIST=$(find "$d" -type f \( -name '*.tar*' -o -name '*.zip' -o -name '*.bak' -o -name '*.backup' -o -name 'backup*' -o -name 'snapshot*' \) 2>/dev/null | sort | tail -20 | tr '\n' '; ')"
      echo "BACKUP_LATEST=$(find "$d" -type f -printf '%T@ %p\n' 2>/dev/null | sort -rn | head -3 || echo NONE)"
      BACKUP_FOUND="YES"
      break
    fi
  done
  echo "BACKUP_FOUND=$BACKUP_FOUND"
  echo ""

  # ==========================================
  # 8. OLD JEST PROCESSES
  # ==========================================
  echo "=== 8. OLD JEST PROCESSES ==="
  JEST_LINES=$(ps aux | grep '[j]est' | grep -v grep || true)
  if [ -z "$JEST_LINES" ]; then
    echo "JEST_PROCESSES=NONE"
  else
    echo "JEST_PROCESSES=$(echo "$JEST_LINES" | head -20 | tr '\n' '; ')"
    while IFS= read -r line; do
      [ -z "$line" ] && continue
      PID=$(echo "$line" | awk '{print $2}')
      PARENT_PID=$(echo "$line" | awk '{print $3}')
      START_TIME=$(echo "$line" | awk '{print $9, $10, $11, $12}')
      ELAPSED=$(ps -o etime= -p "$PID" 2>/dev/null || echo UNKNOWN)
      CMD=$(echo "$line" | awk '{for(i=11;i<=NF;i++) printf "%s ", $i; print ""}')
      CWD=$(readlink -f /proc/"$PID"/cwd 2>/dev/null || echo UNKNOWN)
      echo "JEST_DETAIL PID=$PID PARENT_PID=$PARENT_PID ELAPSED=$ELAPSED CWD=$CWD CMD=$CMD"
    done <<< "$JEST_LINES"
  fi
  echo ""

  # ==========================================
  # 9. DEPLOYMENT / ROLLBACK
  # ==========================================
  echo "=== 9. DEPLOYMENT / ROLLBACK ==="
  echo "DEPLOYMENT_METHOD=UNKNOWN"
  echo "CURRENT_RELEASE_PATH=UNKNOWN"
  echo "PREVIOUS_RELEASE_PATH=UNKNOWN"
  echo "ROLLBACK_ARTIFACT_FOUND=NO"
  echo "ROLLBACK_READY=UNKNOWN"
  if [ -f /etc/systemd/system/omnistore.service ]; then
    echo "DEPLOYMENT_METHOD=systemd"
    echo "CURRENT_RELEASE_PATH=$(systemctl show -p WorkingDirectory --value omnistore.service 2>/dev/null || echo UNKNOWN)"
    for candidate in /home/omnistore/releases /opt/digitronics/releases /home/omnistore/OmniStore_Multi-Tenant/releases; do
      if [ -d "$candidate" ]; then
        echo "ROLLBACK_ARTIFACT_FOUND=YES"
        echo "PREVIOUS_RELEASE_PATH=$candidate"
        break
      fi
    done
  elif command -v docker >/dev/null 2>&1 && docker ps | grep -qi omnistore; then
    echo "DEPLOYMENT_METHOD=Docker"
  elif command -v pm2 >/dev/null 2>&1 && pm2 list | grep -qi omnistore; then
    echo "DEPLOYMENT_METHOD=PM2"
  fi
  echo ""

  # ==========================================
  # 10. FINAL VERDICT INPUTS
  # ==========================================
  echo "=== 10. FINAL_VERDICT_INPUTS ==="
  REPO="/home/omnistore/OmniStore_Multi-Tenant"
  if [ -d "$REPO/.git" ]; then
    cd "$REPO" || cd /
    echo "CURRENT_PRODUCTION_SHA=$(git rev-parse HEAD 2>/dev/null || echo UNKNOWN)"
    echo "CURRENT_BRANCH=$(git branch --show-current 2>/dev/null || echo UNKNOWN)"
    echo "GIT_STATUS_SHORT=$(git status --short 2>/dev/null | head -20 || echo UNKNOWN)"
  else
    echo "CURRENT_PRODUCTION_SHA=UNKNOWN"
    echo "CURRENT_BRANCH=UNKNOWN"
    echo "GIT_STATUS_SHORT=UNKNOWN"
  fi
  echo "RC_SHA=$RC_SHA"
  echo "RC_PRESENT=$(git cat-file -e "$RC_SHA^{commit}" 2>/dev/null && echo YES || echo NO)"
  echo "HEALTH_STATUS=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3001/api/v1/health 2>/dev/null || echo UNKNOWN)"
  echo "READY_STATUS=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3001/api/v1/ready 2>/dev/null || echo UNKNOWN)"
  echo "LIVENESS_STATUS=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3001/api/v1/liveness 2>/dev/null || echo UNKNOWN)"
  echo "BACKUP_FOUND=$BACKUP_FOUND"
  echo "NGINX_ACTIVE=$(systemctl is-active nginx 2>/dev/null || echo UNKNOWN)"
  echo "PORT_3001_LISTENING=$(ss -tlnp 2>/dev/null | grep ':3001' | wc -l)"
  echo "SERVICE_ACTIVE=$(systemctl is-active "$SERVICE_NAME" 2>/dev/null || echo UNKNOWN)"
  echo "SERVICE_ENABLED=$(systemctl is-enabled "$SERVICE_NAME" 2>/dev/null || echo UNKNOWN)"
  echo ""

  echo "=== END OF REPORT ==="
} > "$REPORT" 2>&1

echo "REPORT_PATH=$REPORT"
echo "REPORT_SIZE=$(wc -c < "$REPORT")"
echo "DONE"
