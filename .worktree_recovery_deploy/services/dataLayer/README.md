# OmniStore Live Data Abstraction Layer

Phase 22 defines provider, adapter, repository, transaction, sync, offline queue, health, and conflict-resolution interfaces.

All adapters are Preview Only:

- No database connection
- No SQL
- No Supabase client
- No SQLite driver
- No IndexedDB API
- No localStorage
- No network sync
- No data mutation or posting

`MemoryAdapter` exposes immutable snapshot reads. Its create/update/delete methods return operation previews and never mutate the snapshot.

```js
const adapter = OmniDataLayer.MemoryAdapter.create({ products: [{ id: 1 }] });
const repository = OmniDataLayer.DataRepository.create(adapter, 'products');
console.log(repository.list());
console.log(repository.previewCreate({ id: 2 }));
```
