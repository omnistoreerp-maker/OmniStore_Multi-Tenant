# OmniStore Production Recovery Index

**Last Updated:** 2026-09-11T00:31:00Z  
**Status:** READY — Deployment package prepared, access method documented, interactive SSH session required for execution  
**Production Server:** `omnistore@192.168.1.64`

---

## 1. Last Known Production Release

- **Release SHA256:** `e78438f53b0b1034e08b00286b5ae9e1328f335fd1e68732dfee4f65fc551c2e`
- **Manifest SHA256:** `a7ffc6f8bf1ed76651c14756a061d662f580ff4de43b49fa82d80a4b80f8434a`
- **Phase 5 RC SHA (DO NOT DEPLOY):** `1f688ac4241df947d9ac0493501dae1c04478a76`

## 2. Verified Artifacts

| Artifact | Location | SHA256 |
|----------|----------|--------|
| Release ZIP | `production-recovery\releases\RELEASE_ARTIFACT.zip` | `e78438f53b0b1034e08b00286b5ae9e1328f335fd1e68732dfee4f65fc551c2e` |
| Deploy Script | `production-recovery\scripts\deploy-production.sh` | `e41dc34679fbd5cc3bcbbd791b0a82bcf5d02f767aa10f2c0272955e7401f2cc` |
| Preflight Script | `production-recovery\scripts\production-preflight-v4.sh` | `c22ca3bd285a775ce325bc53163b5374cc683959c99ad29f65499023e9d3fde4` |
| Run Wrapper | `production-recovery\scripts\run-production-preflight.ps1` | `14628017c931888d53ff16318d51bf33c83a233fa04c09b472ec7dc83e05a37b` |

## 3. Access Method

**Method:** Interactive SSH password authentication  
**Target:** `omnistore@192.168.1.64`  
**SSH Client:** Windows OpenSSH (`C:\Windows\System32\OpenSSH\ssh.exe`)  
**Auth:** Password prompt (manual entry required — not stored)  
**TTY Required:** YES — automation not supported from Windows without TTY provider  
**Evidence:** PowerShell history, `E:\Projects\OmniStore_Production\`, `known_hosts`

### Working Command

```powershell
ssh -v omnistore@192.168.1.64
```

### Deployment Sequence (to be run interactively)

```powershell
# 1. Upload artifact
scp C:\Users\hp\AppData\Local\Temp\kilo\RELEASE_ARTIFACT.zip omnistore@192.168.1.64:/tmp/RELEASE_ARTIFACT.zip

# 2. Upload deploy script
scp E:\Projects\OmniStore_Multi-Tenant\production-recovery\scripts\deploy-production.sh omnistore@192.168.1.64:/tmp/deploy-production.sh

# 3. Execute
ssh omnistore@192.168.1.64 "sudo bash /tmp/deploy-production.sh"
```

## 4. Backup Locations

| Backup | Path | Timestamp |
|--------|------|-----------|
| Local Backup | `E:\Projects\OmniStore_Multi-Tenant\backups\pre_deploy_final\` | 2026-09-10 |
| Recovery Root | `E:\Projects\OmniStore_Multi-Tenant\production-recovery\` | 2026-09-11 |

## 5. Production Safety Rules

- **DO NOT** deploy Phase 5 RC (`1f688ac...`) — it deletes legacy functionality
- **DO NOT** use `git reset --hard` or `git clean -fd` on production
- **DO NOT** delete legacy files: `services/`, `plugins/`, `backend/data/`, etc.
- **DO NOT** replace `.env` or systemd/nginx configuration
- **DO NOT** perform deployment without verified backup
- **DO NOT** restart service unless deployment succeeds

## 6. Rollback Plan

If deployment fails:
1. The `deploy-production.sh` script auto-rolls back to backup
2. Manual rollback: restore files from `/home/omnistore/backups/pre_deploy_<timestamp>/`
3. Service restart: `sudo systemctl restart omnistore.service`

## 7. Verification Checklist

After deployment, verify on Ubuntu Production:
- [ ] `systemctl is-active omnistore.service` → `active (running)`
- [ ] `ss -tlnp | grep ':3001'` → listening
- [ ] `curl -s http://localhost:3001/api/v1/health` → 200
- [ ] `curl -s http://localhost:3001/api/v1/ready` → 200
- [ ] `curl -s http://localhost:3001/api/v1/liveness` → 200
- [ ] `curl -s http://localhost:3001/` → serves Platform Home
- [ ] `curl -s http://localhost:3001/platform.html` → 200
- [ ] `curl -s http://localhost:3001/business.html` → 200
- [ ] Legacy routes: `/api/v1/platform-public/catalog` → 200
- [ ] `git rev-parse HEAD` → matches expected production SHA

## 8. Recovery Points

| Type | Path |
|------|------|
| Recovery Root | `E:\Projects\OmniStore_Multi-Tenant\production-recovery\` |
| Access Docs | `production-recovery\access\PRODUCTION_ACCESS.md` |
| Scripts | `production-recovery\scripts\` |
| Releases | `production-recovery\releases\` |
| Backups | `production-recovery\backups\` |
| Sessions | `production-recovery\sessions\` |
| Logs | `production-recovery\logs\` |
| Session 2026-09-11 | `production-recovery\sessions\2026-09-11_pre-deploy\` |

## 9. Known Limitations

- **SSH Automation:** Not possible from Windows without interactive TTY
- **Password Storage:** Not stored — must be entered manually each session
- **WSL:** Not installed on this machine
- **SSH Keys:** None configured
- **node-pty:** Not available
- **Production Access:** Blocked until interactive SSH session is established

## 10. Future Deployment Safety

- Always create timestamped backup before deployment
- Always verify artifact SHA256 before deployment
- Always run `deploy-production.sh` from production server
- Never skip pre-deployment verification
- Keep at least 2 previous release artifacts
- Document every deployment in `sessions\<timestamp>\`

## 11. Current Blocker

**PRODUCTION_ACCESS=BLOCKED**

Technical reason: SSH server at `192.168.1.64:22` is reachable and offers password authentication, but automated non-interactive SSH execution is impossible from this Windows environment. No SSH private keys are present, ssh-agent has no loaded keys, and no TTY provider (winpty/conpty/node-pty/WSL/Git Bash/expect/sshpass) is available. Interactive PowerShell/OpenSSH session requires manual password entry, which cannot be performed by the Kilo agent environment.

**Next Step:** Establish interactive SSH session manually via PowerShell, then execute:
```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "E:\Projects\OmniStore_Multi-Tenant\production-recovery\scripts\run-production-preflight.ps1"
```
