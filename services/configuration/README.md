# OmniStore Configuration Engine

Phase 21 centralizes ERP configuration in Preview Mode.

- All edits are held in JavaScript memory only.
- Export produces a JSON preview download.
- Import parses, validates, and displays differences without applying them.
- Locked safety options keep real accounting posting and automatic backup disabled.
- No database, Supabase, SQL, migration, localStorage, accounting, inventory, POS, Sales, Purchases, or Reports logic is touched.

```js
const engine = OmniConfiguration.ConfigurationEngine.createEngine();
engine.setValue('theme', 'mode', 'dark');
console.log(engine.validate());
console.log(engine.exportPreview());
```

Reloading the page discards all in-memory edits.
