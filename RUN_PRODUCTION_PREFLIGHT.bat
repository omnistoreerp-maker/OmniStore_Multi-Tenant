@echo off
cd /d E:\Projects\OmniStore_Multi-Tenant
powershell -NoProfile -ExecutionPolicy Bypass -File ".\tools\run-production-preflight.ps1"
pause
