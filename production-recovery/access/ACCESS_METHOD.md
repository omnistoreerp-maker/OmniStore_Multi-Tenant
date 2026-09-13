# OmniStore Production Recovery — Access Method

## ORIGINAL WORKING ACCESS METHOD

**Discovered from:** PowerShell history + `E:\Projects\OmniStore_Production\`

### Method: Interactive SSH with Password

**SSH Target:** `omnistore@192.168.1.64`

**SSH Client:** Windows built-in OpenSSH (`C:\Windows\System32\OpenSSH\ssh.exe`)

**Authentication:** Password-based (interactive prompt)

**Working Directory:** `E:\Projects\OmniStore_Production\`

### Original Command Pattern

```powershell
# Read script and pipe to production via SSH
Get-Content -Raw "E:\Projects\production_preflight_v4.sh" | ssh omnistore@192.168.1.64 "bash -s"
```

Or via PowerShell wrapper:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "E:\Projects\OmniStore_Production\run-production-preflight.ps1"
```

### Evidence

1. `C:\Users\hp\.ssh\known_hosts` contains `192.168.1.64` (accepted host key)
2. `E:\Projects\OmniStore_Production\` exists with:
   - `production-preflight-v4.sh`
   - `run-production-preflight.ps1`
   - `README.txt`
3. PowerShell history shows successful SSH commands to `omnistore@192.168.1.64`
4. Ping to `192.168.1.64` succeeds
5. Port 22 is open on `192.168.1.64`

### Limitations from Windows

- **No SSH private keys** in `C:\Users\hp\.ssh\`
- **ssh-agent** has no loaded keys
- **No TTY automation** available (no winpty, conpty, node-pty, WSL, expect, sshpass)
- **Password cannot be automated** from Windows non-interactive sessions
- **Interactive PowerShell ISE/Console** works because it provides a real TTY

### Required for Deployment

When executing on the production server:

```powershell
# 1. Upload artifact
scp C:\Users\hp\AppData\Local\Temp\kilo\RELEASE_ARTIFACT.zip omnistore@192.168.1.64:/tmp/RELEASE_ARTIFACT.zip

# 2. Upload deploy script
scp E:\Projects\OmniStore_Multi-Tenant\scripts\deploy-production.sh omnistore@192.168.1.64:/tmp/deploy-production.sh

# 3. Execute deployment
ssh omnistore@192.168.1.64 "sudo bash /tmp/deploy-production.sh"
```

### Security Notes

- Password is never stored in this repository
- Password must be entered interactively when prompted by SSH
- Host key verification is enabled (StrictHostKeyChecking=no is NOT used)
- All production commands are executed via the vetted `deploy-production.sh` script
