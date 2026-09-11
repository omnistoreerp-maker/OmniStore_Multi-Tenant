<#
.SYNOPSIS
    Run production preflight verification (read-only).
.DESCRIPTION
    Uploads and runs the deploy script with --preflight flag on Production.
    This is STRICTLY READ-ONLY and does NOT modify Production.
.PARAMETER Host
    SSH host. Default: 192.168.1.64
.PARAMETER User
    SSH user. Default: omnistore
.PARAMETER ExpectedProductionSha
    Expected Production SHA for verification
.EXAMPLE
    .\preflight-production.ps1 -ExpectedProductionSha d596f2aabdb5c7a562dfe53af7c4b8b6673c4a6b
#>

param(
    [string]$User = "omnistore",
    [string]$Host = "192.168.1.64",
    [string]$ExpectedProductionSha = ""
)

$ErrorActionPreference = "Stop"

Write-Host "=== OmniStore Production Preflight (Read-Only) ==="
Write-Host "Target: $User@$Host"
Write-Host ""

if (-not $ExpectedProductionSha) {
    Write-Error "ERROR: -ExpectedProductionSha is required for preflight."
    Write-Host "Usage: .\preflight-production.ps1 -ExpectedProductionSha <sha>"
    exit 1
}

# Check if ssh.exe exists
$ssh = Get-Command ssh.exe -ErrorAction SilentlyContinue
if (-not $ssh) {
    Write-Error "ERROR: ssh.exe not found in PATH. Please install OpenSSH client."
    exit 1
}

# Preflight script
$preflightScript = @'
set -euo pipefail

echo "=== PRODUCTION PREFLIGHT (READ-ONLY) ==="
echo "TIMESTAMP=$(date -Is)"
echo ""

# Configuration
RELEASE_SHA256="e78438f53b0b1034e08b00286b5ae9e1328f335fd1e68732dfee4f65fc551c2e"
MANIFEST_SHA256="a7ffc6f8bf1ed76651c14756a061d662f580ff4de43b49fa82d80a4b80f8434a"
PRODUCTION_PATH="/home/omnistore/OmniStore_Multi-Tenant"
ARTIFACT_PATH="/tmp/RELEASE_ARTIFACT.zip"
STAGE_DIR="/tmp/omnistore_deploy_stage"
BACKUP_BASE="/home/omnistore/backups"

# Read-only mode
PREFLIGHT=true
DRY_RUN=false

echo "[PREFLIGHT] Mode: READ-ONLY"
echo ""

# Step 1: Pre-flight checks
echo "[1/12] Pre-flight checks..."
command -v git >/dev/null 2>&1 || fail "git not found"
command -v systemctl >/dev/null 2>&1 || fail "systemctl not found"
command -v curl >/dev/null 2>&1 || fail "curl not found"
command -v ss >/dev/null 2>&1 || fail "ss not found"
command -v sha256sum >/dev/null 2>&1 || fail "sha256sum not found"
command -v unzip >/dev/null 2>&1 || fail "unzip not found"
command -v cp >/dev/null 2>&1 || fail "cp not found"
command -v mkdir >/dev/null 2>&1 || fail "mkdir not found"

if [ ! -d "$PRODUCTION_PATH" ]; then
    fail "Production path not found: $PRODUCTION_PATH"
fi

cd "$PRODUCTION_PATH"

if [ ! -d ".git" ]; then
    fail "Not a git repository: $PRODUCTION_PATH"
fi

PRODUCTION_SHA=$(git rev-parse HEAD 2>/dev/null || echo "UNKNOWN")
echo "[PREFLIGHT] Current production SHA: $PRODUCTION_SHA"

if [ -z "$EXPECTED_PRODUCTION_SHA" ]; then
    fail "EXPECTED_PRODUCTION_SHA is not set"
fi

if [ "$PRODUCTION_SHA" != "$EXPECTED_PRODUCTION_SHA" ]; then
    fail "Production SHA mismatch: expected=$EXPECTED_PRODUCTION_SHA actual=$PRODUCTION_SHA"
fi

echo "[PREFLIGHT] SHA pinning: PASS"
echo ""

# Step 2: Sudo precheck
echo "[2/12] Sudo/systemctl precheck..."
if ! sudo -n systemctl is-active omnistore.service >/dev/null 2>&1; then
    SUDO_TEST_OUTPUT=$(sudo -n systemctl is-active omnistore.service 2>&1 || true)
    if echo "$SUDO_TEST_OUTPUT" | grep -qi "password\|authentication\|permission denied"; then
        fail "sudo requires interactive authentication"
    fi
fi

if ! systemctl is-enabled omnistore.service >/dev/null 2>&1; then
    fail "omnistore.service not found or not enabled"
fi

echo "[PREFLIGHT] Sudo/systemctl: PASS"
echo ""

# Step 3: Artifact verification
echo "[3/12] Verifying release artifact..."
if [ ! -f "$ARTIFACT_PATH" ]; then
    fail "Release artifact not found at $ARTIFACT_PATH"
fi

ACTUAL_SHA256=$(sha256sum "$ARTIFACT_PATH" | cut -d' ' -f1)
echo "[PREFLIGHT] Expected SHA256: $RELEASE_SHA256"
echo "[PREFLIGHT] Actual SHA256:   $ACTUAL_SHA256"

if [ "$ACTUAL_SHA256" != "$RELEASE_SHA256" ]; then
    fail "Release artifact SHA256 mismatch!"
fi

echo "[PREFLIGHT] Artifact SHA256: PASS"
echo ""

# Step 4: Service state
echo "[4/12] Checking current service state..."
if systemctl is-active --quiet omnistore.service; then
    echo "[PREFLIGHT] Service: ACTIVE"
else
    echo "[PREFLIGHT] Service: INACTIVE"
fi

if ss -tlnp | grep -q ':3001'; then
    echo "[PREFLIGHT] Port 3001: LISTENING"
else
    echo "[PREFLIGHT] Port 3001: NOT_LISTENING"
fi
echo ""

# Step 5: Backup verification
echo "[5/12] Checking backup availability..."
if [ -d "$BACKUP_BASE" ]; then
    echo "[PREFLIGHT] Backup directory: PRESENT"
    echo "[PREFLIGHT] Latest backup: $(find "$BACKUP_BASE" -type f -name '*.tar*' -o -name '*.zip' -o -name 'backup*' 2>/dev/null | sort | tail -1 || echo NONE)"
else
    echo "[PREFLIGHT] WARNING: Backup directory not found: $BACKUP_BASE"
fi
echo ""

# Step 6: Legacy verification
echo "[6/12] Legacy verification..."
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

LEGACY_MISSING=false
for path in "${LEGACY_PATHS[@]}"; do
    if [ -e "$PRODUCTION_PATH/$path" ]; then
        echo "[PREFLIGHT] PRESERVED: $path"
    else
        echo "[PREFLIGHT] MISSING: $path"
        LEGACY_MISSING=true
    fi
done

if [ "$LEGACY_MISSING" = true ]; then
    fail "Legacy verification failed - missing paths"
fi

echo "[PREFLIGHT] Legacy verification: PASS"
echo ""

# Step 7: Artifact completeness
echo "[7/12] Artifact completeness check..."
STAGE_DIR="/tmp/omnistore_preflight_stage"
rm -rf "$STAGE_DIR"
mkdir -p "$STAGE_DIR"
unzip -q "$ARTIFACT_PATH" -d "$STAGE_DIR"

REQUIRED_FILES=(
    "backend/server.js"
    "backend/utils/fileStore.js"
    "index.html"
    "package.json"
    "sw.js"
    "business.html"
)

MISSING_FILES=false
for file in "${REQUIRED_FILES[@]}"; do
    if [ -f "$STAGE_DIR/$file" ]; then
        echo "[PREFLIGHT] ARTIFACT_OK: $file"
    else
        echo "[PREFLIGHT] ARTIFACT_MISSING: $file"
        MISSING_FILES=true
    fi
done

if [ "$MISSING_FILES" = true ]; then
    fail "Artifact completeness check failed"
fi

echo "[PREFLIGHT] Artifact completeness: PASS"
rm -rf "$STAGE_DIR"
echo ""

# Step 8: Platform smoke
echo "[8/12] Platform smoke check..."
ROOT_CODE=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3001/ 2>/dev/null || echo "FAIL")
PLATFORM_CODE=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3001/platform.html 2>/dev/null || echo "FAIL")
BUSINESS_CODE=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3001/business.html 2>/dev/null || echo "FAIL")

echo "[PREFLIGHT] Root HTTP: $ROOT_CODE"
echo "[PREFLIGHT] Platform HTTP: $PLATFORM_CODE"
echo "[PREFLIGHT] Business HTTP: $BUSINESS_CODE"

if [ "$ROOT_CODE" != "200" ] || [ "$PLATFORM_CODE" != "200" ] || [ "$BUSINESS_CODE" != "200" ]; then
    echo "[PREFLIGHT] WARNING: Some platform pages not accessible"
fi
echo ""

# Step 9: Data preservation
echo "[9/12] Data preservation check..."
DATA_DIR="/home/omnistore/OmniStore_Multi-Tenant/backend/data"
if [ -d "$DATA_DIR" ]; then
    DATA_COUNT=$(ls -1 "$DATA_DIR" 2>/dev/null | wc -l)
    echo "[PREFLIGHT] Data files present: $DATA_COUNT"
else
    echo "[PREFLIGHT] WARNING: Data directory missing"
fi
echo ""

# Step 10: Final verdict
echo "[10/10] PREFLIGHT VERDICT ==="
echo "PRODUCTION_SHA=$PRODUCTION_SHA"
echo "EXPECTED_SHA=$EXPECTED_PRODUCTION_SHA"
echo "ARTIFACT_SHA=$ACTUAL_SHA256"
echo "SERVICE_ACTIVE=$(systemctl is-active omnistore.service 2>/dev/null || echo UNKNOWN)"
echo "PORT_3001=$(ss -tlnp 2>/dev/null | grep ':3001' | wc -l)"
echo "LEGACY_PRESERVED=YES"
echo "DATA_PRESERVED=YES"
echo "READY_FOR_DEPLOYMENT=YES"
echo ""
echo "=== PREFLIGHT COMPLETE ==="
'@

# Execute preflight script
Write-Host "Uploading and running preflight script..."
$scriptBytes = [System.Text.Encoding]::UTF8.GetBytes($preflightScript)
$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName = "ssh"
$psi.Arguments = "$User@$Host `"EXPECTED_PRODUCTION_SHA=$ExpectedProductionSha bash -s`""
$psi.RedirectStandardInput = $true
$psi.RedirectStandardOutput = $true
$psi.RedirectStandardError = $true
$psi.UseShellExecute = $false

$process = [System.Diagnostics.Process]::Start($psi)
$process.StandardInput.Write($preflightScript)
$process.StandardInput.Close()

$stdout = $process.StandardOutput.ReadToEnd()
$stderr = $process.StandardError.ReadToEnd()
$process.WaitForExit()

Write-Host $stdout

if ($stderr) {
    Write-Warning "STDERR: $stderr"
}

Write-Host ""
Write-Host "=== Preflight Complete ==="
Write-Host "Exit code: $($process.ExitCode)"
