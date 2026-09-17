# OmniStore UAT Engine

Phase 16 is a read-only production-readiness and customer-acceptance layer. It inspects capability snapshots, navigation metadata, PWA declarations, permission scenarios, demo-data readiness, and recorded regression results.

```js
const result = OmniUAT.UATEngine.run(context);
console.log(result.report.productionReadinessScore);
```

The engine never invokes ERP workflows. Its result explicitly states that it is read-only, unpersisted, unposted, and has not touched the database or localStorage.

Load `FeatureCoverageChecker.js` first because it defines the shared utilities. Load `UATEngine.js` after all checkers and builders. `uatUi.js` is optional.
