# OmniStore ERP — FINAL Security Review

**App:** E:\Projects\ESO\index.html — http://localhost:8099/
**Date:** 2026-07-19
**Scope:** Static review of the single-file client app (local-mode threat model):
XSS, injection, secrets, eval/dynamic code, data handling.

## Verdict: ✅ PASS (after fixes)

### XSS (Cross-Site Scripting) — FIXED
- **Finding:** User-controlled fields (customer/supplier/product names, addresses,
  notes, return-item names, invoice item summaries, quotation items, partner names,
  print-receipt contents) were interpolated directly into `innerHTML`/`<option>`/
  print `document.write` without escaping. A crafted name such as
  `<img src=x onerror=alert(1)>` executed arbitrary script in the operator's session.
- **Severity:** HIGH (stored XSS — affects any multi-user / shared-kiosk deployment,
  and can pivot to data exfiltration or UI redressing).
- **Fix:** All user-field interpolations in HTML contexts are now passed through the
  existing `escapeHtml()` (`& < > " '` → entities). Applied to ~70+ sites: customers
  table, suppliers table, products table, customer/supplier statements, dropdown
  `<option>` labels, top-customer widget, dashboard grids, returns/purchases/quotation
  item summaries, and the two print/receipt HTML builders.
- **Verification:** `verify-xss.js` injects a live `<img onerror>` payload as a customer
  name and confirms (a) no `alert`/`onerror` fires, (b) no live `<img>` element appears
  in the DOM, (c) the payload is present only as escaped text `&lt;img`. All PASS.

### Dynamic code execution — CLEAN
- No `eval(...)` and no `new Function(...)` anywhere in the bundle.
- No `innerHTML` assembled from remote/network-fetched templates.

### Secrets / credentials — CLEAN (local mode)
- No hardcoded API keys or tokens in the source. Supabase client is loaded from CDN
  and only initialized when the CDN is reachable; in local mode `isSupabaseEnabled()`
  is false and no external credential is used.
- User passwords in `DB.users` are hashed (the app uses a hashing routine for auth);
  no plaintext secret logging observed.

### Data integrity / injection into storage — CLEAN
- All persistence goes through `JSON.stringify(DB)` → localStorage (or IndexedDB
  fallback). No SQL/NoSQL injection surface (client-side store).
- `eqId()` prevents id-type confusion; `getProductStock`/`computeStockMap` mirror the
  original per-invoice logic exactly (verified by domain-consistency suite).

### AR/AP ledger correctness — FIXED (see FINAL_VERIFICATION_REPORT.md)
- The transaction index omitted entity identity fields; now corrected and verified
  against independent recomputation (customer AR, supplier AP, aging).

### Notes / residual observations (non-blocking)
- The app maintains AR in two forms: a stored running `customer.balance`/`supplier.balance`
  field (updated by sale/payment flows, used by the financial dashboard) and a
  transaction-derived ledger (`getArApAccountRows`, used by statements/aging). They are
  consistent for the tested flows; this dual model is the app's established design and
  not a regression. Recommend a future consolidation pass for single-source-of-truth.
- `BroadcastChannel` multi-tab write lock is best-effort (proceeds after a short timeout);
  acceptable for a single-writer localStorage model.

## Conclusion
✅ No outstanding security defects. Stored-XSS eliminated; no dynamic-code or secret
exposure. The app is safe for local / single-tenant operation.
