# Developer Guide — Enterprise Accounting Engine

## Quick Start

Load the engine files in this order:

1. `AccountingValidator.js`
2. `JournalEngine.js`
3. `AccountBalanceEngine.js`
4. `LedgerEngine.js`
5. `TrialBalanceEngine.js`
6. `FiscalYearEngine.js`
7. `VoucherEngine.js`
8. `PostingEngine.js`
9. `OpeningBalanceEngine.js`
10. `AccountingEngine.js`

Then:

```js
const engine = OmniEnterpriseAccounting.AccountingEngine.createEngine();
const voucher = engine.createVoucher({
  voucherType: 'SALE',
  postingDate: '2026-06-29',
  lines: [
    { account: 'cash_on_hand', debit: 100, credit: 0 },
    { account: 'sales_revenue', debit: 0, credit: 100 }
  ]
});
const preview = engine.preview(voucher);
```

## Adding a Business Profile

No engine code changes are required. Set `businessProfile` when creating vouchers:

```js
engine.createVoucher({
  businessProfile: 'new_business_type',
  voucherType: 'JV',
  postingDate: '2026-06-29',
  lines: [...]
});
```

Reports can filter by:

```js
engine.trialBalance({ businessProfile: 'new_business_type' });
engine.ledger('cash_on_hand', { businessProfile: 'new_business_type' });
```

## Adding Accounts

Pass a custom `chartOfAccounts` to `createEngine`.

Each account should include:

- `id`
- `code`
- `name`
- `type`
- `group`
- `category`
- `normalSide`
- `active`
- optional `readOnly`

## Posting Is In-Memory

`post()`, `unPost()`, and `reverse()` update only the engine instance state and return the new state. They do not save to Supabase or any database.

## Permission Roles

Supported roles:

- Owner
- Admin
- Accountant
- Auditor
- Manager
- Cashier

Use:

```js
engine.post(voucher, { role: 'Accountant', user: 'mona' });
```

## Closing Periods

```js
const state = engine.getState();
engine.setState(engine.fiscal.closePeriod(state, 'FY-2026', '2026-06'));
```

Posting into a closed period will fail validation.
