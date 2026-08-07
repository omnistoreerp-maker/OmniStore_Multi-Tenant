# Phase 33 Non-Destructive Rollback

1. Remove only `services/performanceScale/`.
2. Remove Phase 33 scripts, styles, Reports navigation, page containers, permission mappings, and render mappings from `DigiTronics_v5.html`.
3. Remove Phase 33 assets from `sw.js` and restore the previous cache version.
4. Remove the Phase 33 reports.

No SQL rollback, data restoration, cache cleanup, Worker shutdown, customer change, posting reversal, or business-module rollback is required because Phase 33 performs no writes.
