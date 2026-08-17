'use strict';

// 3B.2-0 — AsyncLocalStorage tenant isolation.
//
// The tenant store must keep each request's tenant fully isolated across
// interleaved asynchronous work. The previous module-level singleton breaks
// the moment `await` enters the request path:
//
//   Request A -> set('tenant-a') -> await ...
//   Request B -> set('tenant-b')
//   Request A resumes -> get() -> 'tenant-b'   <-- cross-tenant leak
//
// These tests simulate exactly that interleaving and prove each async chain
// keeps its own tenant. They FAIL against the old singleton and PASS against
// the AsyncLocalStorage implementation.

const tenantStore = require('../middleware/tenantStore');

// Run `handler` inside a fresh per-request ALS context (the same way
// server.js mounts tenantStore.middleware before tenantCarry).
function runRequest(handler) {
  return new Promise((resolve, reject) => {
    tenantStore.middleware({}, {}, () => {
      Promise.resolve(handler()).then(resolve, reject);
    });
  });
}

// A shared barrier: both sides park on `await gate` so the two async chains
// are guaranteed to interleave (A sets, B sets, THEN both resume).
function makeGate() {
  let release;
  const gate = new Promise((r) => { release = r; });
  return { gate, release };
}

describe('3B.2-0 — AsyncLocalStorage tenant isolation', () => {
  // Test 1 — Tenant A context does not leak to Tenant B.
  test('interleaved requests keep their own tenant (A does not leak to B)', async () => {
    const { gate, release } = makeGate();

    const a = runRequest(async () => {
      tenantStore.set({ tenantId: 'tenant-a' });
      await gate;                       // async boundary — B sets in between
      return tenantStore.get();
    });
    const b = runRequest(async () => {
      tenantStore.set({ tenantId: 'tenant-b' });
      await gate;
      return tenantStore.get();
    });

    release();                          // resume both interleaved chains
    const [ta, tb] = await Promise.all([a, b]);

    expect(ta).toEqual({ tenantId: 'tenant-a' });
    expect(tb).toEqual({ tenantId: 'tenant-b' });
  });

  // Test 2 — Tenant B context does not leak to Tenant A (reverse start order).
  test('interleaved requests keep their own tenant (B does not leak to A)', async () => {
    const { gate, release } = makeGate();

    const b = runRequest(async () => {
      tenantStore.set({ tenantId: 'tenant-b' });
      await gate;
      return tenantStore.get();
    });
    const a = runRequest(async () => {
      tenantStore.set({ tenantId: 'tenant-a' });
      await gate;
      return tenantStore.get();
    });

    release();
    const [tb, ta] = await Promise.all([b, a]);

    expect(tb).toEqual({ tenantId: 'tenant-b' });
    expect(ta).toEqual({ tenantId: 'tenant-a' });
  });

  // Test 3 — Nested async operations preserve the correct tenant.
  test('nested async operations preserve the tenant', async () => {
    const { gate, release } = makeGate();

    async function nestedA() {
      tenantStore.set({ tenantId: 'tenant-a' });
      await gate;
      await Promise.resolve();
      const seen = tenantStore.get();
      await Promise.resolve();
      return { seen, again: tenantStore.get() };
    }
    async function nestedB() {
      tenantStore.set({ tenantId: 'tenant-b' });
      await gate;
      await Promise.resolve();
      const seen = tenantStore.get();
      await Promise.resolve();
      return { seen, again: tenantStore.get() };
    }

    const pa = runRequest(nestedA);
    const pb = runRequest(nestedB);
    release(); // both chains parked on the gate — resume them interleaved
    const [a, b] = await Promise.all([pa, pb]);

    expect(a.seen).toEqual({ tenantId: 'tenant-a' });
    expect(a.again).toEqual({ tenantId: 'tenant-a' });
    expect(b.seen).toEqual({ tenantId: 'tenant-b' });
    expect(b.again).toEqual({ tenantId: 'tenant-b' });
  });

  // Test 4 — After request/context completion there is no global tenant state.
  test('no global tenant state survives after requests complete', async () => {
    await runRequest(async () => {
      tenantStore.set({ tenantId: 'tenant-a' });
    });
    // Outside any request context the store must be empty — a fresh request
    // must never inherit a previous request's tenant.
    expect(tenantStore.get()).toBeNull();

    // A brand-new request starts clean even though the previous one set a tenant.
    const fresh = await runRequest(async () => tenantStore.get());
    expect(fresh).toBeNull();
  });

  // Test 5 — clear() inside one request does not clear another request.
  test('clear() only affects its own request context', async () => {
    const { gate, release } = makeGate();

    const a = runRequest(async () => {
      tenantStore.set({ tenantId: 'tenant-a' });
      await gate;
      tenantStore.clear();
      return tenantStore.get();
    });
    const b = runRequest(async () => {
      tenantStore.set({ tenantId: 'tenant-b' });
      await gate;
      return tenantStore.get();
    });

    release();
    const [ta, tb] = await Promise.all([a, b]);

    expect(ta).toBeNull();              // cleared within its own request
    expect(tb).toEqual({ tenantId: 'tenant-b' }); // untouched by A's clear
  });

  // Test 6 — createAccessor() continues to return the CURRENT request tenant.
  test('createAccessor() returns the current request tenant', async () => {
    const accessor = tenantStore.createAccessor();
    const { gate, release } = makeGate();

    const a = runRequest(async () => {
      tenantStore.set({ tenantId: 'tenant-a' });
      await gate;
      return accessor.getCurrentTenant();
    });
    const b = runRequest(async () => {
      tenantStore.set({ tenantId: 'tenant-b' });
      await gate;
      return accessor.getCurrentTenant();
    });

    release();
    const [ta, tb] = await Promise.all([a, b]);

    expect(ta).toEqual({ tenantId: 'tenant-a' });
    expect(tb).toEqual({ tenantId: 'tenant-b' });
  });

  // Test 7 — many concurrent interleaved requests all keep their own tenant.
  test('20 interleaved requests each keep their own tenant', async () => {
    const { gate, release } = makeGate();

    const chains = Array.from({ length: 20 }, (_, i) => {
      const id = 'tenant-' + i;
      return runRequest(async () => {
        tenantStore.set({ tenantId: id });
        await gate;
        await Promise.resolve();
        return tenantStore.get();
      });
    });

    release();
    const results = await Promise.all(chains);

    results.forEach((tenant, i) => {
      expect(tenant).toEqual({ tenantId: 'tenant-' + i });
    });
  });
});
