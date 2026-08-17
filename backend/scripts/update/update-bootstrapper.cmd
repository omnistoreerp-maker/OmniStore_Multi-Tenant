@echo off
rem ============================================================================
rem OmniStore Updater Bootstrapper (Windows)
rem ============================================================================
rem Launches the SAFE updater as a separate process. The main application
rem spawns this with `start /min` (see services/update.service.js) so the
rem updater keeps running even after the main application exits - it must, to
rem stop/restart the backend during the swap.
rem
rem IMPORTANT: the updater process must NEVER have its working directory inside
rem the install dir. Windows refuses to rename a directory that is any
rem process's current directory (the backup/swap renames <InstallDir>\app ->
rem <InstallDir>\app.previous-<v> would fail with EBUSY). So this script cd's
rem to the PARENT of the app dir and invokes the updater with absolute paths.
rem The update log goes to <InstallDir>\backups\update-run.log (OUTSIDE the app
rem dir, so it survives the swap).
rem
rem Exit codes from apply-update.js:
rem   0  up to date / update successful
rem   1  update failed (download / checksum / extract)
rem   2  safety abort (data dir inside install dir)
rem   3  rollback succeeded
rem   4  rollback failed (manual intervention required)
rem ============================================================================
setlocal
set "APP_DIR=%~dp0..\..\.."
set "OUTER_DIR=%APP_DIR%\.."
if not exist "%APP_DIR%\backend\scripts\update\apply-update.js" (
  echo [updater] apply-update.js not found
  exit /b 1
)
cd /d "%OUTER_DIR%"
if not exist "backups" mkdir "backups"
node "%APP_DIR%\backend\scripts\update\apply-update.js" > "backups\update-run.log" 2>&1
exit /b %errorlevel%
