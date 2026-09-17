# Accounting Rules JSON SDK

## Add a business in under five minutes

1. Copy `example_custom_profile.json`.
2. Change `id`, names, aliases and settings.
3. Keep the required template IDs or remove operations the business does not use.
4. Validate the file against `profile.schema.json`.
5. Register its JSON text:

```js
OmniAccountingRuleLoader.load(jsonText);
```

The new profile is immediately available through the Registry without changing the engine.

## Add a custom rule using JSON only

Copy `example_custom_rule_profile.json` and edit the object under `rules`.

Required fields:

```json
{
  "ruleName": "Service Income",
  "ruleId": "service_center.service_income",
  "templateId": "service_income",
  "description": "Preview service income",
  "enabled": true,
  "requiredAccounts": ["cash", "other_income"],
  "affectedModules": ["sales", "treasury"],
  "validationRules": ["accounts_exist", "balanced", "currency_valid"],
  "journalPreview": [
    { "account": "cash", "side": "debit", "amount": "amount" },
    { "account": "other_income", "side": "credit", "amount": "amount" }
  ],
  "inventoryImpact": "none",
  "cashImpact": "increase",
  "taxImpact": "none",
  "profitImpact": "increase"
}
```

Load and preview:

```js
OmniAccountingRuleLoader.load(jsonText);
const result = OmniAccountingRulePreview.preview(
  'service_center',
  'service_income',
  { amount: 500, currency: 'EGP' },
  OmniAccountingRulesSettings.load()
);
```

## Supported validation names

- `accounts_exist`
- `balanced`
- `cost_required`
- `stock_available`
- `currency_valid`
- `tax_valid`
- `discount_valid`
- `manual_lines_required`
- `distinct_transfer_accounts`

## Safety contract

A JSON rule can describe and preview accounting lines. The SDK deliberately exposes no post, insert, update, delete or migration API.

