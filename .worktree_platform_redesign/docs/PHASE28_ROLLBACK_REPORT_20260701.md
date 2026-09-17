# Phase 28 Non-Destructive Rollback

1. Remove only `services/saasAdmin/`.
2. Remove only `supabase/functions/omnistore-saas-admin/`.
3. Remove the Phase 28 script tags, styles, navigation items, page containers, permission mappings, and render mappings from `DigiTronics_v5.html`.
4. Remove the Phase 28 assets from `sw.js` and restore its previous cache version.
5. Remove the four Phase 28 reports.

If the server package was deployed later, first disable the `omnistore-saas-admin` Edge Function. Preserve the `omnistore_admin` schema for audit/backup until a separately reviewed data-retention decision is approved. This rollback never deletes tenant, POS, Sales, Purchases, Inventory, Accounting, or Customer Provisioning data.
