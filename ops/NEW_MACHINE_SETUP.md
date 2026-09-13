# OmniStore Production — New Windows Machine Setup

## Objective

Move OmniStore Production operations to a new Windows computer with minimal friction.

## Prerequisites

- Windows 10/11 with PowerShell 5.1+
- Git for Windows (includes OpenSSH client)
- Internet access to GitHub
- Access to Production server `192.168.1.64`

## Step 1: Clone Repository

```powershell
git clone https://github.com/omnistoreerp-maker/OmniStore_Multi-Tenant.git
cd OmniStore_Multi-Tenant
```

## Step 2: Install OpenSSH Client

```powershell
# Check if already installed
ssh.exe --version

# If not installed, install via Settings:
# Settings → Apps → Optional Features → Add a feature → OpenSSH Client
```

## Step 3: Create SSH Key (One-Time)

```powershell
# Generate new SSH key (do NOT overwrite existing keys)
ssh-keygen -t ed25519 -C "omnistore-production" -f "$env:USERPROFILE\.ssh\omnistore_production"

# Start ssh-agent
Start-Service ssh-agent
ssh-add "$env:USERPROFILE\.ssh\omnistore_production"
```

## Step 4: Add Public Key to Production

**This requires one-time manual administrative access to the Production server.**

Option A: If you have physical/console access to the Production server:
```bash
# On Ubuntu Production (192.168.1.64)
mkdir -p ~/.ssh
echo "<public-key-content>" >> ~/.ssh/authorized_keys
chmod 700 ~/.ssh
chmod 600 ~/.ssh/authorized_keys
```

Option B: Ask a Production administrator to add the public key to `/home/omnistore/.ssh/authorized_keys`

The public key content is in:
```
C:\Users\<your-user>\.ssh\omnistore_production.pub
```

## Step 5: Test Connection

```powershell
# Test SSH connection
ssh -i "$env:USERPROFILE\.ssh\omnistore_production" omnistore@192.168.1.64
```

If successful, you should see:
```
omnistore@omnistore:~$
```

## Step 6: Verify Operations Kit

```powershell
# Run read-only verification
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "E:\Projects\OmniStore_Multi-Tenant\ops\verify\verify-production.ps1"
```

## Step 7: Configure PowerShell Profile (Optional)

Add to your PowerShell profile for convenience:

```powershell
# Open profile
notepad $PROFILE

# Add:
Set-Alias omnistore-ssh "ssh -i `"$env:USERPROFILE\.ssh\omnistore_production`" omnistore@192.168.1.64"
Set-Alias omnistore-verify "powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"E:\Projects\OmniStore_Multi-Tenant\ops\verify\verify-production.ps1`""
Set-Alias omnistore-preflight "powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"E:\Projects\OmniStore_Multi-Tenant\ops\preflight\preflight-production.ps1`""
```

## Security Notes

- **NEVER** copy the private key (`omnistore_production`) to another machine without revoking it first.
- **NEVER** commit the private key to Git.
- **NEVER** share the private key via email/chat.
- If the key is compromised, generate a new one and remove the old public key from Production.

## Troubleshooting

### "Permission denied (publickey)"
- Verify the public key is in `/home/omnistore/.ssh/authorized_keys` on Production
- Verify the private key path in the SSH command
- Check file permissions on Production: `chmod 700 ~/.ssh && chmod 600 ~/.ssh/authorized_keys`

### "Could not resolve hostname"
- Verify network connectivity to `192.168.1.64`
- Verify the host is on the correct network segment

### "Connection refused"
- Verify SSH daemon is running on Production: `sudo systemctl status sshd`
- Verify port 22 is open: `sudo ss -tlnp | grep :22`
