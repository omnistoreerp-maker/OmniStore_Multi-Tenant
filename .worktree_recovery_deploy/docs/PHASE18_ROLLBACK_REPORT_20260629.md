# Phase 18 Non-Destructive Rollback

1. Remove `services/uatFeedback/`.
2. Remove only Phase 18 script tags, feedback styles, four Reports navigation items, four page blocks, permission mappings, and render hooks from `DigiTronics_v5.html`.
3. Remove only Phase 18 cache assets from `sw.js`.
4. Restore cache identifier `omnistore-erp-v23-demo-polish`.
5. Restore prior cache assertions in regression tests.
6. Reload the service worker/application.

No data rollback is required because feedback is never stored in the database or localStorage.
