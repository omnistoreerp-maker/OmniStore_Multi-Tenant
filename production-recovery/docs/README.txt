OMNISTORE PRODUCTION PREFLIGHT — LOCAL INFRASTRUCTURE
======================================================

PURPOSE
-------
This directory contains a READ-ONLY production audit infrastructure
for the OmniStore ERP production server at 192.168.1.64.

FILES
-----
production-preflight-v4.sh   -> Bash script that runs on production
run-production-preflight.ps1 -> PowerShell wrapper that pipes the bash script via SSH
README.txt                    -> This file

HOW TO RUN
----------
1. Open PowerShell on Windows
2. cd to this directory:
   cd E:\Projects\OmniStore_Production
3. Run:
   .\run-production-preflight.ps1
4. Enter your SSH password for omnistore@192.168.1.64 when prompted
5. The script will:
   a. Pipe production-preflight-v4.sh to production via SSH
   b. Execute it on production
   c. Retrieve the generated report
   d. Display it in PowerShell

SECURITY
--------
- NO password is stored anywhere
- NO private keys are used or created
- NO sshpass or password automation
- NO WSL or additional tools required
- Uses Windows built-in OpenSSH client (ssh.exe)
- Host key verification is ENABLED (StrictHostKeyChecking=no is NOT used)
- All commands on production are READ-ONLY
- No files are modified on production
- No services are restarted
- No deployments are performed

PRODUCTION HOST
---------------
Host: 192.168.1.64
User: omnistore
Path: /home/omnistore/OmniStore_Multi-Tenant (expected)

REPORT OUTPUT
-------------
The bash script generates a timestamped report at:
  /tmp/production_preflight_v4_YYYYMMDD_HHMMSS.txt

The PowerShell wrapper retrieves and displays this report.

TROUBLESHOOTING
---------------
If SSH password prompt does not appear:
  - Ensure you are running PowerShell in interactive mode
  - Try running: ssh omnistore@192.168.1.64 manually first
  - If host key is unknown, accept it manually first

If report is not found after execution:
  - Check that the bash script executed successfully on production
  - Verify /tmp is writable on production
  - Check production logs for errors

DO NOT
------
- Do not modify any files in this directory
- Do not modify production-preflight-v4.sh unless instructed
- Do not run this script against non-production hosts
- Do not store the production password anywhere
