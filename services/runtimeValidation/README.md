# OmniStore Runtime Validation Layer

Phase 15 provides a read-only gate immediately before any future posting workflow. It consumes snapshots and previews, runs isolated validators, and returns a frozen report. It never saves, posts, repairs, changes inventory, executes SQL, connects to Supabase, or writes localStorage.

## Load order

1. `BusinessRuleValidator.js` (also defines shared pure utilities)
2. Warehouse, inventory, accounting, currency, tax, document, permission, and posting validators
3. `RuntimeValidationReportBuilder.js`
4. `RuntimeValidationEngine.js`
5. Optional `runtimeValidationUi.js`

## API

```js
const result = OmniRuntimeValidation.RuntimeValidationEngine.validate(context);
console.log(result.report.postingEligibility);
```

Input is a plain read-only context containing business profile, accounting engine/state, warehouses, products, documents, previews, permissions, tax/currency settings, and reconciliation results.

The result explicitly reports `readOnly: true`, `persisted: false`, `posted: false`, `inventoryUpdated: false`, and `databaseTouched: false`.
