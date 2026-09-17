# Phase 21 Non-Destructive Rollback

1. Remove `services/configuration/`.
2. Remove `templates/config/`.
3. Remove only Phase 21 scripts, styles, eleven navigation entries, eleven pages, permission entries, and render hooks from `DigiTronics_v5.html`.
4. Remove Phase 21 assets from `sw.js`.
5. Restore cache identifier `omnistore-erp-v26-master-release`.
6. Restore previous cache assertions.
7. Reload the application/service worker.

No configuration-data rollback is required because all edits and imports are memory-only previews.
