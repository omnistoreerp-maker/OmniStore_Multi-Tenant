# DigiTronics Supabase Phase 1 Report

## What changed

- `DigiTronics_v5.html`
  - Added the Supabase JS client from CDN.
  - Added optional Supabase configuration detection.
  - Added `digitronicsDataAdapter`.
  - Kept LocalStorage and GitHub/Gist sync untouched.
  - Routed only `create_sale` through the adapter.
  - Kept all screens, UI, and current legacy storage behavior.

- `supabase_schema.sql`
  - Added tables:
    `products`, `sales`, `sale_items`, `purchases`, `purchase_items`,
    `cash_transactions`, `stock_transactions`, `daily_closing`,
    `audit_logs`, `user_roles`.
  - Added RPC functions:
    `create_sale`, `create_purchase`, `cancel_sale`, `close_day`.
  - Treasury balance is derived from `cash_transactions`.
  - Product stock is derived from `stock_transactions`.
  - No direct cash balance or direct product stock quantity field is used.

## Current behavior

- If Supabase is not configured, the program uses the old LocalStorage/GitHub flow.
- If Supabase is configured, sale creation calls `create_sale` first.
- If Supabase fails, the sale is saved locally and the user sees a warning.
- Purchases, cancel sale, and close day still use the legacy flow in the app for now.

## Vercel ENV

Set these variables in Vercel:

```text
VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_SUPABASE_ANON_KEY
```

For the current single-file HTML phase, inject those values into:

```html
<script>
  window.DIGITRONICS_SUPABASE = {
    url: "https://YOUR_PROJECT.supabase.co",
    anonKey: "YOUR_SUPABASE_ANON_KEY"
  };
</script>
```

When the app is moved to a Vite build later, map:

```js
window.DIGITRONICS_SUPABASE = {
  url: import.meta.env.VITE_SUPABASE_URL,
  anonKey: import.meta.env.VITE_SUPABASE_ANON_KEY
};
```

## Setup steps

1. Open Supabase SQL Editor.
2. Run `supabase_schema.sql`.
3. Configure `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in Vercel.
4. Inject `window.DIGITRONICS_SUPABASE` for the current HTML deployment.
5. Test one sale.
6. Confirm rows are created in:
   `sales`, `sale_items`, `cash_transactions`, `stock_transactions`.

## Notes

- GitHub/Gist sync was not removed.
- LocalStorage was not removed.
- No screens or design were changed.
- This is intentionally phase 1 only.

## Phase 2 update

- `DigiTronics_v5.html` now reads Supabase config from `window.DIGITRONICS_SUPABASE`.
- Only sales use Supabase.
- `create_sale` calls the Supabase RPC when Supabase is configured and available.
- Purchases, inventory management, and daily closing remain on the legacy flow.
- Fallback mode remains active: if Supabase is missing or the RPC fails, the sale is saved through LocalStorage/GitHub as before.
- A small sidebar status badge shows:
  - `Supabase Connected`
  - `Supabase Offline`

## Phase 2 test instructions

1. Run `supabase_schema.sql` in Supabase if it has not already been run.
2. Inject config before the app script:

```html
<script>
  window.DIGITRONICS_SUPABASE = {
    url: "https://YOUR_PROJECT.supabase.co",
    anonKey: "YOUR_SUPABASE_ANON_KEY"
  };
</script>
```

3. Hard refresh the app.
4. Confirm the sidebar badge says `Supabase Connected`.
5. Create one sale.
6. Confirm a success toast appears for Supabase.
7. Confirm rows exist in:
   `sales`, `sale_items`, `cash_transactions`, `stock_transactions`.
8. Disable the config or internet and create another sale.
9. Confirm the app falls back to LocalStorage/GitHub and does not break.

## Rollback instructions

- Remove or comment `window.DIGITRONICS_SUPABASE`.
- Hard refresh the browser.
- The app will automatically use legacy LocalStorage/GitHub mode.
- No database rollback is required because local behavior remains intact.
