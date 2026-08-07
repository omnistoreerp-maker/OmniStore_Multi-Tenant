# Phase 7 Test Report

Date: 2026-06-29

## Results

- Behavioral tests: **16/16 passed**.
- All **180** bundled rule previews balance.
- Serial, batch, recipe and invoice-cost selection paths use the configured profit method; the serial-cost path was additionally verified.
- All **12** profiles contain **15** rules.
- Registry and Loader tests passed.
- Template-only and fully custom JSON loading passed.
- Source context/settings immutability passed.
- JavaScript syntax and main inline-script checks passed.
- JSON parsing for profiles, schemas and examples passed.

## Coverage

Sales, Purchase, Returns, Inventory, Treasury, Tax, Discount, Profit, Validation, Rule Preview, Rule Registry and Rule Loader.

Validation fixtures confirmed detection of:

- missing cost;
- insufficient stock;
- incorrect currency;
- tax mismatch;
- excessive discount;
- missing account.

The host shell does not expose a Node executable. The committed `node:test` suite remains ready for normal Node environments; equivalent assertions were executed directly against the same source files and passed.

The local `file://` browser route remains unavailable to automated browser policy, so DOM IDs, script order, routes and syntax were checked statically. Manual UI smoke testing is recommended.
