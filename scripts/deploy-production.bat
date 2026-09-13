@echo off
REM Production Deployment Script for Windows
REM This script prepares the deployment package and provides instructions
REM for manual execution on the production server.

echo === OmniStore Production Deployment Preparation ===
echo.

set RELEASE_SHA256=e78438f53b0b1034e08b00286b5ae9e1328f335fd1e68732dfee4f65fc551c2e
set ARTIFACT_PATH=C:\Users\hp\AppData\Local\Temp\kilo\RELEASE_ARTIFACT.zip
set DEPLOY_SCRIPT=%~dp0deploy-production.sh
set PRODUCTION_USER=omnistore
set PRODUCTION_HOST=192.168.1.64
set PRODUCTION_PATH=/home/omnistore/OmniStore_Multi-Tenant

echo Release SHA256: %RELEASE_SHA256%
echo Artifact: %ARTIFACT_PATH%
echo.

REM Verify artifact exists
if not exist "%ARTIFACT_PATH%" (
    echo ERROR: Release artifact not found at %ARTIFACT_PATH%
    pause
    exit /b 1
)

echo [OK] Release artifact found

REM Calculate actual SHA256
echo.
echo Verifying SHA256...
powershell -Command "$hash = Get-FileHash -Path '%ARTIFACT_PATH%' -Algorithm SHA256; Write-Host 'Actual SHA256:' $hash.Hash"

echo.
echo === DEPLOYMENT INSTRUCTIONS ===
echo.
echo Since automated SSH is not available from this Windows environment,
echo please execute the following steps on the production server:
echo.
echo 1. Upload the release artifact to the production server:
echo    scp "%ARTIFACT_PATH%" %PRODUCTION_USER%@%PRODUCTION_HOST%:/tmp/RELEASE_ARTIFACT.zip
echo.
echo 2. Upload the deployment script:
echo    scp "%DEPLOY_SCRIPT%" %PRODUCTION_USER%@%PRODUCTION_HOST%:/tmp/deploy.sh
echo.
echo 3. SSH to the production server and run:
echo    sudo bash /tmp/deploy.sh
echo.
echo Or execute these commands directly on the production server:
echo.
echo sudo bash -c 'bash -s ^< deploy-production.sh'
echo.
pause
