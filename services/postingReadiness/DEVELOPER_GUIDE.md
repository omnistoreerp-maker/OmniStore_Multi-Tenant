# Developer Guide — Posting Readiness

Load the files in this order:

1. `PostingReadinessValidator.js`
2. `AccountingReadinessChecker.js`
3. `InventoryReadinessChecker.js`
4. `SalesReadinessChecker.js`
5. `PurchaseReadinessChecker.js`
6. `POSReadinessChecker.js`
7. `DataCompletenessChecker.js`
8. `ReconciliationEngine.js`
9. `PostingRiskAnalyzer.js`
10. `ReconciliationReportBuilder.js`
11. `PostingReadinessEngine.js`
12. optional UI: `postingReadinessUi.js`

Usage:

```js
const result = OmniPostingReadiness.PostingReadinessEngine.run({
  accountingEngine,
  products,
  salesInvoices,
  purchaseInvoices,
  customers,
  suppliers
});
```

The result is read-only and contains no persistence side effects.
