# READ-ONLY Production Preflight Script
# Target: omnistore@192.168.1.64
# DO NOT MODIFY PRODUCTION
# DO NOT DEPLOY
# DO NOT RESTART SERVICES

$ErrorActionPreference = 'Stop'

$script = @'
set -euo pipefail
HOST='192.168.1.64'
USER='omnistore'
REPO='/home/omnistore/OmniStore_Multi-Tenant'
SERVICE='omnistore.service'
PORT='3001'
PUBLIC_URL='https://app.omnistoreerp.com/'
EXPECTED_PRODUCTION_SHA='d596f2aabdb5c7a562dfe53af7c4b8b6673c4a6'
RC_SHA='1c35b47a469ea5b6f2d1f819010b3edee0d2bb82'
printf 'PRODUCTION_PREFLIGHT=START\n'
printf 'HOST=%s\nUSER=%s\n' "$HOST" "$USER"
hostname || true
whoami || true
uname -a || true
cat /etc/os-release || true
node --version || true
npm --version || true
cd "$REPO" || true
printf 'PRODUCTION_BRANCH='; git branch --show-current 2>/dev/null || true
printf 'PRODUCTION_HEAD='; git rev-parse HEAD 2>/dev/null || true
printf 'PRODUCTION_HEAD_MATCH_EXPECTED='; if [ "$(git rev-parse HEAD 2>/dev/null || echo)" = "$EXPECTED_PRODUCTION_SHA" ]; then echo PASS; else echo FAIL; fi
printf 'WORKTREE_CLEAN='; if git status --short 2>/dev/null | grep -q .; then echo FAIL; else echo PASS; fi
printf 'SERVICE_ACTIVE='; systemctl is-active "$SERVICE" 2>/dev/null || true
printf 'SERVICE_ENABLED='; systemctl is-enabled "$SERVICE" 2>/dev/null || true
printf 'PORT_3001='; if ss -ltnp | grep -q ":$PORT"; then echo LISTENING; else echo NOT_LISTENING; fi
printf 'LOCAL_HEALTH='; curl -fsS -o /tmp/omnistore_health.txt -w '%{http_code}' "http://127.0.0.1:$PORT/health" 2>/dev/null || echo UNKNOWN
printf 'LOCAL_READY='; curl -fsS -o /tmp/omnistore_ready.txt -w '%{http_code}' "http://127.0.0.1:$PORT/ready" 2>/dev/null || echo UNKNOWN
printf 'LOCAL_LIVENESS='; curl -fsS -o /tmp/omnistore_live.txt -w '%{http_code}' "http://127.0.0.1:$PORT/liveness" 2>/dev/null || echo UNKNOWN
printf 'NGINX_CONFIG='; nginx -t 2>&1 | grep -q 'test is successful' && echo PASS || echo FAIL
printf 'NGINX_UPSTREAM='; grep -R "127.0.0.1:$PORT" /etc/nginx 2>/dev/null | head -n 1 || echo UNKNOWN
printf 'PUBLIC_URL_HTTP='; curl -fsS -o /tmp/omnistore_public.txt -w '%{http_code}' "$PUBLIC_URL" 2>/dev/null || echo UNKNOWN
printf 'PUBLIC_ROOT='; if curl -fsS "$PUBLIC_URL" 2>/dev/null | grep -q 'OmniStore'; then echo PASS; else echo FAIL; fi
printf 'PLATFORM_HTML='; curl -fsS -o /tmp/platform_html.txt -w '%{http_code}' "$PUBLIC_URL/platform.html" 2>/dev/null || echo UNKNOWN
printf 'BUSINESS_HTML='; curl -fsS -o /tmp/business_html.txt -w '%{http_code}' "$PUBLIC_URL/business.html" 2>/dev/null || echo UNKNOWN
printf 'LEGACY_ERP_INDEX='; curl -fsS -o /tmp/index_html.txt -w '%{http_code}' "$PUBLIC_URL/index.html" 2>/dev/null || echo UNKNOWN
printf 'PLATFORM_STATS='; curl -fsS "$PUBLIC_URL/api/v1/platform-public/stats" 2>/dev/null | grep -q 'visitorsNow' && echo PASS || echo FAIL
printf 'MARKETPLACE_COMPANIES='; curl -fsS "$PUBLIC_URL/api/v1/platform-public/marketplace/companies" 2>/dev/null | grep -q 'companies' && echo PASS || echo FAIL
printf 'BACKUP_EVIDENCE='; if [ -d /home/omnistore/backups ] && ls /home/omnistore/backups/*.tar.gz 1>/dev/null 2>&1 || ls /home/omnistore/backups/*.zip 1>/dev/null 2>&1; then echo FOUND; else echo NOT_FOUND; fi
printf 'BACKUP_TIMESTAMP='; ls -t /home/omnistore/backups/*.tar.gz /home/omnistore/backups/*.zip 2>/dev/null | head -n 1 | xargs basename || echo UNKNOWN
printf 'BACKUP_LOCATION=/home/omnistore/backups\n'
printf 'DISK_STATUS='; df -h / | awk 'NR==2{if($5+0 > 90) print "WARN"; else print "PASS"}' || echo UNKNOWN
printf 'MEMORY_STATUS='; free -h | awk 'NR==2{if($7+0 < 100) print "WARN"; else print "PASS"}' || echo UNKNOWN
printf 'RC_SHA_PRESENT='; git cat-file -t "$RC_SHA" 2>/dev/null && echo YES || echo NO
printf 'RC_SHA_REACHABLE='; git merge-base --is-ancestor "$RC_SHA" HEAD 2>/dev/null && echo YES || echo NO
printf 'PRODUCTION_DATA_MODIFIED=NO\n'
printf 'PRODUCTION_PREFLIGHT=COMPLETE\n'
'@ | ssh -o StrictHostKeyChecking=yes omnistore@192.168.1.64 "bash -s"
