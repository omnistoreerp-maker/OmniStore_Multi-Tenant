# Phase 7 — Accounting Rules Engine

Date: 2026-06-29

## Result

Implemented a standalone, declarative Accounting Rules Engine that chooses accounting behavior by business type, operation and local company settings.

- Business Profiles: **12**
- Rules per profile: **15**
- Compiled bundled Rules: **180**
- Automated test cases: **16**
- New files: **32** (29 under `services/accountingRules/` + 3 Phase reports)
- Modified files: **4**
- Journal persistence: **0**

No SQL, migration, Supabase connection or operational-data change was made.

## New files

See `services/accountingRules/`:

- 9 runtime JavaScript files.
- 12 JSON business profiles.
- 4 JSON SDK/schema examples.
- 2 test files.
- Engine and SDK documentation.

Phase reports:

- `PHASE7_IMPLEMENTATION_REPORT_20260629.md`
- `PHASE7_TEST_REPORT_20260629.md`
- `PHASE7_ROLLBACK_REPORT_20260629.md`

## Modified files

- `DigiTronics_v5.html`: scripts, Accounting Configuration page, Simulator route and permission.
- `services/accountingCore/chartOfAccounts.js`: additive preview accounts for tax, returns, discounts, transfers and opening balances.
- `services/modulePlatform/moduleRegistry.js`: registered `accounting_rules`.
- `sw.js`: cached Phase 7 assets and advanced the app-shell version.

## Added UI

**Accounting Configuration** provides:

- Default Accounts.
- Default Tax.
- Inventory Method.
- Profit Calculation Method.
- Allow Negative Stock.
- Auto Journal Preview.
- Enable Accounting Validation.
- Currency.

The Simulator accepts Business Type, Operation, Amount, Cost, Tax, Discount, Quantity, Available Stock, Payment Type and Inventory Direction, then displays the journal, validation, inventory effect, cash effect, tax effect and profit effect.

## Compatibility

- Existing DigiTronics functions and data shapes were not replaced.
- `computer_shop` remains the fallback profile.
- Existing aliases such as `auto_parts` and `generic_store` resolve safely.
- No table or existing storage key was renamed.
- No breaking changes were detected.

## How to test

1. Open OmniStore as Owner, Admin or Manager.
2. Open Reports → **إعدادات وقواعد المحاسبة**.
3. Select a business and operation.
4. Change simulator values and click **Preview Rule**.
5. Verify Debit equals Credit and review validation/effects.
6. Save settings as Owner/Admin and reload; only the isolated Phase 7 settings should persist.
7. Run:

```powershell
node --test services/accountingRules/tests/accountingRules.test.js
```
