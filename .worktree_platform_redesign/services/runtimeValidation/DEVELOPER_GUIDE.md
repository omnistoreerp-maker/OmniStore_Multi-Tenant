# Runtime Validation Developer Guide

## Adding a check

Add a pure check to the validator responsible for that domain. Return issues through `RuntimeValidationUtils.issue(code, message, options)` and checklist results through `RuntimeValidationUtils.result(...)`.

Use `severity: "critical"` and `blocking: true` only when future posting must be refused. A validator must never mutate its input and must never call database, storage, inventory transaction, or accounting posting APIs.

## Context contract

- `businessProfile`: business identity and accounting configuration
- `accountingEngine` or `accountingState`: chart and fiscal calendar
- `warehouses`, `products`, `documents`: runtime snapshot
- `previews`: Phase 12/10 preview output
- `currencySettings`, `taxConfiguration`
- `role`, `permissions`
- `reconciliation`: `{ inventoryBalanced, accountingBalanced }`

## UI contract

`runtimeValidationUi.js` keeps the latest report in memory only. Export creates a client-side JSON download and does not write application storage.

## Test

```powershell
node services/runtimeValidation/RuntimeValidation.test.js
```
