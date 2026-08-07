# Phase 6 Test Report

Date: 2026-06-29

## Automated coverage

The test suite covers:

- Sale accounting preview.
- Purchase accounting preview.
- Balanced journal entries.
- Inventory valuation.
- Profit calculation.
- Treasury reconciliation.
- Missing-cost behavior.
- Negative stock and unlinked product detection.
- Full six-report integration.
- Source snapshot immutability.

## Results

- Final core behavioral checks: **10/10 passed**.
- Accounting source/test file syntax: **passed**.
- Main HTML inline JavaScript syntax: **2/2 scripts passed**.
- Module registry and service worker syntax: **passed**.
- Forbidden persistence references inside `services/accountingCore`: **none expected**.

The host shell did not expose a `node` executable, so the committed `node:test` files could not be launched through the shell command. Equivalent behavioral assertions were executed against the same source files in the available JavaScript runtime and all passed.

An attempted local `file://` UI smoke test was blocked by the browser security policy. UI integration was therefore verified by static route, page, script-order and DOM-ID checks (all required IDs present, no syntax errors); a short manual smoke test remains recommended.

## Expected validation findings

The tests deliberately prove that:

- Profit is `null` when purchase cost is missing.
- A missing product link appears as an error.
- Negative inventory appears as a warning.
- A sale associated with negative inventory is flagged as exceeding available stock.
- The source snapshot is byte-for-byte unchanged after auditing.
