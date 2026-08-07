# Phase 7 Non-Destructive Rollback

No journal or operational data was created. Rollback needs no SQL, migration or data repair.

## Steps

1. Remove the nine `services/accountingRules/*.js` script tags from `DigiTronics_v5.html`.
2. Remove `page-accounting-configuration`, its render hook and permission rule.
3. Remove `accounting_rules` from `services/modulePlatform/moduleRegistry.js`.
4. Remove Phase 7 assets from `sw.js`, then advance the cache version.
5. Remove the additive Phase 7 accounts from `services/accountingCore/chartOfAccounts.js` only if no later phase uses them.
6. Delete `services/accountingRules/` and the three Phase 7 report files.
7. Optionally remove only `omnistore_accounting_rules_settings_v1` from local storage.

Do not remove or edit `cairo_db_v7`. No Supabase action is required.

