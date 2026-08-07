# Phase 35 Non-Destructive Rollback

1. Remove only `services/aiCopilot/`.
2. Remove Phase 35 scripts, styles, Analytics navigation, pages, permission mappings, and render mappings from `DigiTronics_v5.html`.
3. Remove Phase 35 assets from `sw.js` and restore the previous cache version.
4. Remove the Phase 35 reports.

No model disconnection, API-key rotation, SQL rollback, customer restoration, posting reversal, or business-module rollback is needed because the Copilot is local and read-only.
