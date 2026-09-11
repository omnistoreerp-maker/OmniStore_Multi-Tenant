# OmniStore Production Operations — Detailed Procedures

## 1. Connection

### Interactive SSH
```powershell
ssh omnistore@192.168.1.64
```

### Using Operations Kit
```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "E:\Projects\OmniStore_Multi-Tenant\ops\connect\connect-production.ps1"
```

## 2. Verification (Read-Only)

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "E:\Projects\OmniStore_Multi-Tenant\ops\verify\verify-production.ps1"
```

Checks:
- Production SHA
- Service state
- PID
- Port 3001
- Health endpoints
- Data preservation

## 3. Preflight (Read-Only)

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "E:\Projects\OmniStore_Multi-Tenant\ops\preflight\preflight-production.ps1" -ExpectedProductionSha d596f2aabdb5c7a562dfe53af7c4b8b6673c4a6b
```

Checks:
- Artifact SHA256
- Production SHA pinning
- Sudo availability
- Service unit configuration
- Legacy paths
- Platform smoke
- Data preservation

**This command NEVER modifies Production.**

## 4. Deployment (Explicit Human Approval Required)

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "E:\Projects\OmniStore_Multi-Tenant\ops\deploy\deploy-production.ps1" -ExpectedProductionSha d596f2aabdb5c7a562dfe53af7c4b8b6673c4a6b -Confirm
```

Pre-deployment:
1. Verify artifact SHA256
2. Verify Production SHA
3. Create backup
4. Verify legacy paths

Deployment:
1. Deploy selective integration files
2. Verify legacy preservation
3. Restart service if needed
4. Run health checks

Post-deployment:
- Auto-rollback on any failure
- Verify all endpoints

## 5. Recovery

### Read-Only Verification
```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "E:\Projects\OmniStore_Multi-Tenant\ops\recovery\recover-production.ps1" -BackupPath /home/omnistore/backups/pre_deploy_20260911_131032
```

### Actual Restore
```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "E:\Projects\OmniStore_Multi-Tenant\ops\recovery\recover-production.ps1" -BackupPath /home/omnistore/backups/pre_deploy_20260911_131032 -Restore
```

## 6. Safety Rules

1. **NEVER** commit secrets to Git
2. **NEVER** run deployment without preflight
3. **NEVER** skip backup verification
4. **NEVER** delete `backend/data` blindly
5. **NEVER** use `git reset --hard` on Production
6. **ALWAYS** verify SHA256 before deployment
7. **ALWAYS** check service state after deployment
8. **ALWAYS** use the approved deployment script

## 7. Rollback Procedure

If deployment fails:
1. Script auto-rolls back files from backup
2. Service is restarted with old code
3. Verify health endpoints return 200
4. If auto-rollback fails, use manual recovery from `/home/omnistore/backups/`

## 8. Emergency Procedures

### Service Not Starting
```bash
sudo systemctl status omnistore.service
sudo journalctl -u omnistore.service -n 50
```

### Rollback to Backup
```bash
sudo cp /home/omnistore/backups/pre_deploy_<timestamp>/* /home/omnistore/OmniStore_Multi-Tenant/
sudo systemctl restart omnistore.service
```

### Data Preservation
- Never delete `backend/data/*.json` files
- Never modify `backend/data` without explicit backup
- Always verify data integrity after recovery

## 9. SSH Key Rotation

If SSH key is compromised:
1. Generate new key on Windows
2. Add new public key to Production
3. Remove old public key from Production
4. Update local SSH config

## 10. Moving to New Windows Device

1. Clone repository
2. Install OpenSSH client
3. Create new SSH key
4. Add public key to Production
5. Test connection
6. Run verification
7. Update PowerShell profile

See `ops/NEW_MACHINE_SETUP.md` for detailed steps.
