# Phase 31 Non-Destructive Rollback

1. Remove only `services/platformAutomation/`.
2. Remove Phase 31 scripts, styles, administration navigation, page containers, permission mappings, and render mappings from `DigiTronics_v5.html`.
3. Remove Phase 31 assets from `sw.js` and restore the previous cache version.
4. Remove the Phase 31 reports.

No data rollback, SQL, tenant cleanup, posting reversal, backup restoration, or customer change is required because the layer performs no writes.
