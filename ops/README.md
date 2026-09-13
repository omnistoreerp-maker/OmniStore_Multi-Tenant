# OmniStore Production Operations Kit

## Purpose

This `ops/` directory is the permanent, portable control center for OmniStore Production operations from a Windows development machine.

It provides safe, auditable, and repeatable procedures for:
- Connecting to Production
- Verifying Production state
- Running read-only preflight checks
- Deploying releases
- Recovering from failures

## Structure

```
ops/
  README.md                     # This file
  PRODUCTION_OPERATIONS.md      # Detailed operations guide
  NEW_MACHINE_SETUP.md          # Portability/migration guide
  config/                       # Non-sensitive configuration
  connect/                      # SSH connection helpers
  deploy/                       # Deployment scripts
  verify/                       # Verification scripts
  recovery/                     # Recovery scripts
  logs/                         # Operation logs
```

## Quick Reference

From PowerShell (interactive), run:

```powershell
# Connect to Production
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "E:\Projects\OmniStore_Multi-Tenant\ops\connect\connect-production.ps1"

# Verify Production state
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "E:\Projects\OmniStore_Multi-Tenant\ops\verify\verify-production.ps1"

# Run read-only preflight
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "E:\Projects\OmniStore_Multi-Tenant\ops\preflight\preflight-production.ps1"

# Deploy (requires explicit confirmation)
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "E:\Projects\OmniStore_Multi-Tenant\ops\deploy\deploy-production.ps1"

# Recovery
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "E:\Projects\OmniStore_Multi-Tenant\ops\recovery\recover-production.ps1"
```

## Safety Rules

1. **NEVER** commit private SSH keys, passwords, tokens, or credentials to this repository.
2. **NEVER** run deployment scripts without explicit human approval.
3. **NEVER** use `git reset --hard` or `git clean -fd` on Production.
4. **NEVER** delete `backend/data` files based only on git status.
5. **ALWAYS** verify backup before deployment.
6. **ALWAYS** run read-only preflight before deployment.
7. **ALWAYS** use the approved deployment script from `scripts/deploy-production.sh`.

## Production Server

- **Host:** 192.168.1.64
- **User:** omnistore
- **SSH Client:** Windows OpenSSH (`C:\Windows\System32\OpenSSH\ssh.exe`)
- **Authentication:** SSH key-based (preferred) or interactive password
- **Service:** omnistore.service
- **Application Port:** 3001
- **Repository Path:** /home/omnistore/OmniStore_Multi-Tenant
- **Baseline SHA:** d596f2aabdb5c7a562dfe53af7c4b8b6673c4a6b

## Known Limitations

- SSH automation from Windows requires an interactive PowerShell session for password entry.
- No TTY automation is available in non-interactive environments.
- SSH key-based authentication is the recommended long-term solution.

## Support

For issues or questions, refer to:
- `ops/PRODUCTION_OPERATIONS.md` for detailed procedures
- `ops/NEW_MACHINE_SETUP.md` for portability
- `production-recovery/RECOVERY_INDEX.md` for recovery points
