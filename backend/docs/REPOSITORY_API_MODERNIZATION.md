# Repository API Modernization — Design Proposal

- Status: **Proposed** (no implementation)
- Phase: Next (after static deferral of Phase 14)
- Scope: `backend/repositories/BaseRepository.js` (+ optional thin helpers)
- Constraints honored: no services / controllers / routing / business-logic / storage changes; no new feature flags; 100% backward compatibility.

## 1. Context — why this is needed now

Phase 13 introduced *read-time* filtering at the collection level (`read()`),
and Phase 14 was **deferred** because `write()` is a *whole-document* persistence
boundary:

- Services load the full document (`read()`), mutate a single record, then
  persist the entire document again (`write(db)`).
- `write()` receives no action intent, so it **cannot reliably infer** whether an
  entity was created, updated, or deleted — a problem only made worse by
  Phase 13 filtering (a routine save looks indistinguishable from "removing
  another tenant's rows").

To give the repository entity-level awareness (the natural place for tenant-safe
UPDATE / DELETE later), the persistence surface must move from
*document-oriented* (read/write whole document) to *entity-oriented*
(create/update/delete one record) — **without breaking** the existing
`read()`/`write()` contract that all services already depend on.

## 2. Goal

Introduce additive, entity-oriented methods that sit **on top of** the existing
storage primitives:

```
createEntity(collection, entity) -> entity|null
updateEntity(collection, id, patch) -> entity|null
deleteEntity(collection, id) -> boolean
findEntity(collection, predicate) -> entity|null
```

These are **optional, opt-in helpers** — no service is required to use them, and
no service changes at all are needed in this phase.

## 3. Backward Compatibility Strategy (the core guarantee)

The new methods **must not** change the behaviour of `read()` / `write()` in any
code path. Compatibility is achieved by:

1. **Delegation, not replacement.** Each entity method is implemented purely in
   terms of the existing primitives:
   - reads via `this.read()`
   - persists via `this._save(collection, data)` which internally calls
     `this.write(data)` **exactly as today**.
2. **Same store documents.** The underlying JSON schema, store names, id
   conventions, and file layout are unchanged. Entity methods operate on the
   same arrays (e.g. `db.invoices`) that services already use.
3. **No API changes.** Existing `read()` / `write()` signatures, return types,
   and side effects are identical. All current tests (447) are unaffected
   because the new methods are simply not called by services in this phase.
4. **Dormant by construction.** Like Phases 10–13 helpers, these methods are
   additive. With no tenant accessor and all feature flags default **false**,
   they behave as plain collections: no filtering, no stamping, no isolation.

## 4. Coexistence model

| Concern | Existing API | New API |
|---|---|---|
| Read whole document | `read()` | unchanged |
| Persist whole document | `write(data)` | unchanged (internal engine for `_save`) |
| Read one entity | (service loops) | `findEntity(col, pred)` — additive |
| Insert one entity | service push + `write` | `createEntity(col, entity)` |
| Update one entity | service index-mutate + `write` | `updateEntity(col, id, patch)` |
| Delete one entity | service `splice` + `write` | `deleteEntity(col, id)` |

The new API is a **superset overlay**, never a replacement. Both can coexist;
a service may even mix them (e.g. `findEntity` for lookups but keep its own
`write` for a specialized batch).

## 5. Where tenant protection could later live

Because entity methods encapsulate a single record, they are the *correct* place
for any future tenant-safety rules (deferred Phase 14):

- `updateEntity` / `deleteEntity` receive an explicit entity + its id, so they
  can check `entity.tenantId` (legacy vs current-tenant) **before** persisting —
  no diff guesswork, no false positives.
- `createEntity` naturally reuses the Phase 12 metadata-stamping logic.
- `findEntity` naturally inherits Phase 13 read-filtering via `this.read()`.

This makes Phase 14's protection implementable without ever touching `write()`.

## 5. Concrete signatures (proposal)

All return `null` / `false` / the entity rather than throwing, matching the
repo's existing safe conventions.

```js
// Collection-level entity API (additive, opt-in, no breaking changes)

// Insert `entity` into `collection` (after any phase-12 tenant stamping),
// returns the persisted entity, or null on failure.
createEntity(collection, entity)

// Merge `patch` into the entity matching `id` (a scalar id value or a
// predicate). Returns the updated entity, or null if not found / failed.
updateEntity(collection, id, patch)

// Remove the entity matching `id`. Returns true if removed, false otherwise.
deleteEntity(collection, id)

// Return first entity where `predicate(entity)` is true, else null.
findEntity(collection, predicate)

// Internal: persist `data` for `collection` through this.write(data).
_saveCollection(collection, data)
```

### Internal persistence flow (single implementation point)

```
createEntity(col, entity):
    data  = this.read()                      // already tenant-filtered in Phase 13 when on
    list  = ensure array data[col]
    stamp/validate identity (deferred rules)
    list.push(entity)
    ok    = this._saveCollection(col, data) // -> this.write(data)
    return ok ? entity : null

updateEntity(col, id, patch):
    data = this.read()
    idx  = findIndex by id
    if idx < 0: return null
    merged = { ...data[col][idx], ...patch, id: data[col][idx].id }
    data[col][idx] = merged
    return this._saveCollection(col, data) ? merged : null

deleteEntity(col, id):
    data = this.read(); idx = findIndex
    if idx < 0: return false
    data[col].splice(idx, 1)
    return this._saveCollection(col, data)

findEntity(col, predicate):
    return (this.read()[col] || []).find(predicate) || null
```

## 6. Why this is minimal and safe

- **One responsibility:** `write()` stays a pure physical write-through; all
  entity logic (id lookup, merge, splice) lives in the new opt-in methods only,
  keeping `write()` a single responsibility instead of bolting diff logic onto it.
- **Single implementation point:** `_saveCollection` is the only new call into
  `write()`, so any future hardening (intercepts, ownership checks) has one
  chokepoint.
- **Read-once, write-once:** `read()` → mutate → `write()` per call, matching the
  services' current throughput and shape, so observable JSON output is unchanged.
- **0 breaking risk:** all existing tests continue to pass; the helpers are DOM.

## 7. Rollout (future phases, out of scope for this doc)

- (future) Phase: add the four entity methods in `BaseRepository.js` + a smoke
  test only — still no service calls.
- (future) Phase: adopt by a handful of services to prove coexistence, run
  447 tests + smoke, then broaden adoption.
- (future) Phase: re-visit deferred Phase 14 tenant-safety on top of these
  methods (ownership gate before persist), enabled solely by the existing
  `ENABLE_TENANT_FILTERING` flag — no new flags.

## 8. Decisions recorded

- **Phase 14: DEFERRED.** Do not implement write()-level UPDATE/DELETE
  protection. The diff-based detection is unreliable after read-time filtering;
  favouring entity-oriented overlays instead.
- **No code changed** for Phase 14; baseline remains `447/447` PASS.

---

*This document is an architecture proposal only. No implementation, no feature
flags, no tests were required or added.*