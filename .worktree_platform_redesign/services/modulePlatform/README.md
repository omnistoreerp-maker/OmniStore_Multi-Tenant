# OmniStore Modular Platform

## Architecture

```text
moduleRegistry.js
  └─ immutable module contracts

moduleLoader.js
  ├─ local feature flags
  ├─ dependency resolution
  ├─ Business Type compatibility
  ├─ module settings
  ├─ route guard
  └─ lifecycle: register → boot → shutdown

moduleAdapters.js
  └─ compatibility adapters around existing page/business functions

navigationBuilder.js
  └─ rebuilds existing sidebar dropdown groups from active modules

dashboardBuilder.js
  └─ builds active-module widgets and hides unavailable legacy widgets
```

Local module configuration is stored in `omnistore_modules_v1`. It is independent of products, invoices, stock, customers, and all other operational data.

## Module contract

Every registry entry defines:

```js
{
  id: "products",
  name: "Products",
  icon: "📦",
  route: "products",
  permissions: ["viewProducts"],
  businessTypes: "*",
  dependencies: [],
  enabled: true,
  defaultSettings: {},
  navigation: [],
  widgets: []
}
```

`businessTypes` is either `"*"` or an array. For example, Repairs is compatible with Computer Shop, Mobile Shop, and Electronics. It is automatically inactive for Restaurant, Pharmacy, Fashion, and Supermarket profiles.

## Resolution flow

1. Read `omnistore_modules_v1`.
2. Merge requested feature flags with registry defaults.
3. Check the active Business Type.
4. Resolve dependencies until state is stable.
5. Call `register()` once for every known adapter.
6. Call `boot()` only for active modules.
7. Call `shutdown()` when a booted module becomes inactive.
8. Rebuild navigation and dashboard.
9. Guard routes through `isRouteEnabled(route)`.

## Feature flags and settings

The Advanced tab in OmniStore Settings contains Module Settings & Feature Flags.

- Toggle a module locally.
- See dependency/business-profile status.
- Edit its JSON settings.
- Reset all modules to defaults.

The Settings module is kept as a platform core in the UI so feature flags cannot permanently lock the administrator out.

Administrative features are separate modules as well: Identity, Governance, Automation, Branches, Integrations, Documents/Recovery, Backup/Sync, and Platform Tools. They can be toggled independently.

## Existing logic compatibility

The original single-file page functions are retained. Module adapters own registration, boot, shutdown, and route lifecycle around those functions. This avoids duplicating or rewriting high-risk sales, purchases, stock, treasury, maintenance, and reporting logic.

This is a strangler-style modular migration: new functionality can move into a module adapter incrementally while its legacy implementation stays available until safely retired.

## Add a module

1. Add one entry to `moduleRegistry.js`.
2. Add navigation and optional dashboard widgets.
3. Add a lifecycle adapter in `moduleAdapters.js` only if custom boot/shutdown work is needed.
4. Add a test.

Example:

```js
delivery: module({
  id: "delivery",
  name: "Delivery",
  icon: "🚚",
  route: "delivery",
  permissions: ["manageDelivery"],
  businessTypes: ["restaurant", "supermarket"],
  dependencies: ["sales", "customers"],
  enabled: true,
  defaultSettings: { zonesEnabled: true },
  navigation: [nav("delivery", "التوصيل", "🚚", "sales")],
  widgets: []
})
```

## Public loader API

- `register(id, hooks)`
- `boot()`
- `setEnabled(id, enabled)`
- `reset()`
- `getSettings(id)`
- `updateSettings(id, patch)`
- `getState()`
- `getModuleState(id)`
- `getActiveModules()`
- `findByRoute(route)`
- `isRouteEnabled(route)`
- `notifyRoute(route)`

## Tests

```powershell
node --test services/modulePlatform/tests/modulePlatform.test.js
```

Coverage includes contracts, lifecycle, dependencies, Business Type profiles, local persistence, module settings, route guards, navigation generation, and dashboard generation.

## Local-only guarantee

The platform service contains no Supabase client, SQL, migration, or network code.
