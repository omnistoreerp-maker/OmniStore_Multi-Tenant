# Phase 16 Developer Guide

## Context

`UATEngine.run(context)` accepts:

- `features` and `workflows`
- `navigation.routes/pages/menus`
- `performance`
- `permissionMatrix`
- `demoData`
- `ui`
- `pwa`
- `regressionSuites`

Checkers must remain pure and return `UATUtils.group(...)`. A blocking issue prevents `ready_for_uat`; warnings reduce scores but do not invoke fixes.

## Extending

Add a pure checker, load it before `UATEngine.js`, and register its name/method in `UATEngine.RUNNERS`. Do not call POS, sales, purchase, posting, persistence, network, or storage APIs.

## Test

```powershell
node services/uat/UAT.test.js
```
