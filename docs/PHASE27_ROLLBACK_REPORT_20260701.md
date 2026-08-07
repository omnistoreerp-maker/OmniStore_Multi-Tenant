# Phase 27 Rollback Report

## Code rollback

1. Remove `services/customerProvisioning`.
2. Remove `supabase/functions/omnistore-installer/provisioning.ts`.
3. Restore the Phase 26 migration manifest/version and remove migration `20260701_005_workspaces`.
4. Remove Phase 27 scripts, pages, navigation, styles, permissions and render hooks.
5. Restore the Phase 26 Service Worker version and cache assertions.
6. Run the 699-test Phase 26 baseline.

## Customer rollback

Use Reports → Provision Rollback:

1. Preview tenant counts and confirm `otherTenantsAffected = 0`.
2. Type the exact `DELETE_CUSTOMER:<tenant-id>` phrase.
3. Accept the final confirmation.
4. The Edge Function deletes one tenant transaction, then removes that tenant’s Auth users and logo objects.

Never use a broad schema drop for customer rollback.
