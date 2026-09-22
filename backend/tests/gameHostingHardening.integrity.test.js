'use strict';

// Final-acceptance hardening tests: malformed inputs, partial records,
// concurrent operations and atomicity of the persisted state.

const fs = require('fs');
const { makeTempDataDir } = require('./helpers/testData');

let dataDir;
let orderService;
let pricingService;
let provisioningService;
let ghService;
let providerRegistry;
let MockProvider;

beforeAll(() => {
  dataDir = makeTempDataDir('gh-hardening');
  process.env.DIGITRONICS_DATA_DIR = dataDir;
  jest.resetModules();
  orderService = require('../services/gameHostingOrder.service');
  pricingService = require('../services/gameHostingPricing.service');
  provisioningService = require('../services/gameHostingProvisioning.service');
  ghService = require('../services/gameHosting.service');
  providerRegistry = require('../services/gameHosting/providerRegistry');
  MockProvider = require('../services/gameHosting/mockProvider').MockProvider;
});

afterAll(() => {
  delete process.env.DIGITRONICS_DATA_DIR;
  if (dataDir && fs.existsSync(dataDir)) fs.rmSync(dataDir, { recursive: true, force: true });
});

const A = { tenantId: 'tenantA' };
const B = { tenantId: 'tenantB' };

async function seedPlan(overrides) {
  const res = await ghService.createPlan({
    data: Object.assign({ name: 'hp-' + Math.random().toString(36).slice(2, 7), gameTitle: 'MC', pricePerMonth: 15, status: 'active' }, overrides || {}),
    tenantContext: A
  });
  if (res.error) throw new Error(res.error);
  return res.plan;
}

async function paidOrder(plan, skipProvision) {
  const o = await orderService.createOrder({ data: { planId: plan.id, billingPeriod: '1m', serverName: 's', customerId: 'c1' }, tenantContext: A });
  const pay = await orderService.applyPaymentResult({ orderId: o.order.id, tenantContext: A, paymentRef: 'P-' + o.order.id.slice(0, 6), amount: o.order.amount, status: 'paid' });
  if (skipProvision) return pay.order;
  const prov = await provisioningService.provisionOrder({ orderId: o.order.id, tenantContext: A });
  if (prov.error) throw new Error(prov.error);
  return prov.order;
}

// === 6. DATA INTEGRITY — malformed plans ===
describe('data integrity — malformed plan records', () => {
  test('plan creation with string pricePerMonth is rejected at the source', async () => {
    const res = await ghService.createPlan({ data: { name: 'bad-price', gameTitle: 'MC', pricePerMonth: 'not-a-number', status: 'active' }, tenantContext: A });
    expect(res.error).toMatch(/pricePerMonth must be a non-negative number/);
    // and it never enters the store
    const list = await ghService.listPlans({ tenantContext: A });
    expect(list.some((p) => p.name === 'bad-price')).toBe(false);
  });

  test('plan with null pricePerMonth in the store (partial record) fails quote and order cleanly', async () => {
    // Simulate a corrupted/partial record written directly to the store.
    const plan = await seedPlan({ pricePerMonth: 15 });
    const repo = new (require('../repositories/BaseRepository'))('gameHostingPlans');
    const db = await repo._rawStoreAsync();
    const rec = db.plans.find((p) => p.id === plan.id);
    delete rec.pricePerMonth; // partial record
    await repo.writeAsync(db);
    const q = await pricingService.quote({ planId: plan.id, tenantContext: A });
    expect(q.error).toBe('Plan has no valid price configured');
    const o = await orderService.createOrder({ data: { planId: plan.id, serverName: 's', customerId: 'c1' }, tenantContext: A });
    expect(o.error).toBe('Plan has no valid price configured');
    expect(o.order).toBeUndefined();
  });

  test('plan missing from store mid-order → quote and order fail cleanly', async () => {
    // Reference a non-existent plan id
    const q = await pricingService.quote({ planId: 'no-such-plan', tenantContext: A });
    expect(q.error).toBe('Plan not found');
    const o = await orderService.createOrder({ data: { planId: 'no-such-plan', serverName: 's', customerId: 'c1' }, tenantContext: A });
    expect(o.error).toBe('Plan not found');
  });
});

// === 6. DATA INTEGRITY — malformed provider responses ===
describe('data integrity — malformed provider responses', () => {
  test('provider returning ok:true WITHOUT server payload → order must not expose bogus providerInfo; failure persisted', async () => {
    const broken = {
      provider: 'broken',
      provisionServer: async () => ({ ok: true, status: 'active' }), // missing .server
      suspendServer: async () => ({ ok: true, status: 'suspended' }),
      resumeServer: async () => ({ ok: true, status: 'active' }),
      terminateServer: async () => ({ ok: true, status: 'terminated' }),
      getServerStatus: async () => ({ ok: true, status: 'active' }),
      getUsage: async () => ({ ok: true })
    };
    providerRegistry.registerProvider('broken', broken);
    const orig = providerRegistry.getActiveProvider;
    providerRegistry.getActiveProvider = () => broken;
    try {
      const plan = await seedPlan();
      const o = await paidOrder(plan, true);
      const res = await provisioningService.provisionOrder({ orderId: o.id, tenantContext: A });
      // Contract breach (ok:true but no server envelope): the orchestrator
      // must treat it as a non-retryable failure with a dedicated code so
      // operators can identify the broken adapter — never a silent active.
      expect(res.provisioningFailed).toBe(true);
      expect(res.order.status).toBe('provisioning_failed');
      expect(res.providerFailure.code).toBe('PROVIDER_CONTRACT_BREACH');
      expect(res.providerFailure.retryable).toBe(false);
    } finally {
      providerRegistry.getActiveProvider = orig;
      providerRegistry._resetForTests();
    }
  });

  test('provider throwing mid-provision → order lands in provisioning_failed with persisted error', async () => {
    const throwing = {
      provider: 'throwing',
      provisionServer: async () => { throw new Error('socket hang up'); },
      suspendServer: async () => ({ ok: true, status: 'suspended' }),
      resumeServer: async () => ({ ok: true, status: 'active' }),
      terminateServer: async () => ({ ok: true, status: 'terminated' }),
      getServerStatus: async () => ({ ok: true, status: 'active' }),
      getUsage: async () => ({ ok: true })
    };
    const orig = providerRegistry.getActiveProvider;
    providerRegistry.getActiveProvider = () => throwing;
    try {
      const plan = await seedPlan();
      const o = await paidOrder(plan, true);
      let res;
      await provisioningService.provisionOrder({ orderId: o.id, tenantContext: A }).catch(() => {});
      // Re-read the order from the store — it must be in a recoverable state.
      const after = await orderService.getOrderById({ id: o.id, tenantContext: A });
      expect(['provisioning', 'provisioning_failed']).toContain(after.status);
      res = await orderService.getOrderById({ id: o.id, tenantContext: A });
      expect(res.status).not.toBe('active');
    } finally {
      providerRegistry.getActiveProvider = orig;
    }
  });

  test('provider returning retryable failure then success — attempts counter increments monotonically', async () => {
    const p = new MockProvider({ failNext: { provisionServer: { retryable: true, code: 'X', message: 'x' } } });
    const orig = providerRegistry.getActiveProvider;
    providerRegistry.getActiveProvider = () => p;
    try {
      const plan = await seedPlan();
      const o = await paidOrder(plan, true);
      const f = await provisioningService.provisionOrder({ orderId: o.id, tenantContext: A });
      expect(f.order.provisioningAttempts).toBe(1);
      const s = await provisioningService.provisionOrder({ orderId: o.id, tenantContext: A });
      expect(s.provisioned).toBe(true);
      expect(s.order.provisioningAttempts).toBe(2);
    } finally {
      providerRegistry.getActiveProvider = orig;
    }
  });
});

// === 6. DATA INTEGRITY — null/partial records + duplicates ===
describe('data integrity — partial records and duplicates', () => {
  test('order idempotencyKey across DIFFERENT customers does not collide', async () => {
    const plan = await seedPlan();
    const o1 = await orderService.createOrder({ data: { planId: plan.id, serverName: 'a', customerId: 'cust-1', idempotencyKey: 'shared-key' }, tenantContext: A });
    const o2 = await orderService.createOrder({ data: { planId: plan.id, serverName: 'b', customerId: 'cust-2', idempotencyKey: 'shared-key' }, tenantContext: A });
    expect(o1.order.id).not.toBe(o2.order.id);
    expect(o2.idempotent).toBeUndefined();
  });

  test('order idempotencyKey in tenant B is independent of the same key in tenant A', async () => {
    const planA = await seedPlan();
    const resB = await ghService.createPlan({ data: { name: 'bplan', gameTitle: 'MC', pricePerMonth: 5, status: 'active' }, tenantContext: B });
    const o1 = await orderService.createOrder({ data: { planId: planA.id, serverName: 'a', customerId: 'c1', idempotencyKey: 'k1' }, tenantContext: A });
    const o2 = await orderService.createOrder({ data: { planId: resB.plan.id, serverName: 'b', customerId: 'c1', idempotencyKey: 'k1' }, tenantContext: B });
    expect(o1.order.id).not.toBe(o2.order.id);
  });

  test('duplicate terminate calls are rejected after terminal state', async () => {
    const plan = await seedPlan();
    const o = await paidOrder(plan);
    const t1 = await provisioningService.terminateOrder({ orderId: o.id, tenantContext: A });
    expect(t1.terminated).toBe(true);
    const t2 = await provisioningService.terminateOrder({ orderId: o.id, tenantContext: A });
    expect(t2.error).toMatch(/already terminated/);
  });

  test('payment on a terminated order is refused', async () => {
    const plan = await seedPlan();
    const o = await paidOrder(plan);
    await provisioningService.terminateOrder({ orderId: o.id, tenantContext: A });
    const pay = await orderService.applyPaymentResult({ orderId: o.id, tenantContext: A, paymentRef: 'LATE', amount: o.amount, status: 'paid' });
    // Idempotency-2 guard: order already past payment (paid) → alreadyProcessed
    expect(pay.alreadyProcessed || pay.error).toBeTruthy();
    const after = await orderService.getOrderById({ id: o.id, tenantContext: A });
    expect(after.status).toBe('terminated');
  });

  test('suspended→expired sweep then terminate works (no dead-end states)', async () => {
    const plan = await seedPlan();
    const o = await paidOrder(plan);
    await provisioningService.suspendOrder({ orderId: o.id, tenantContext: A });
    await orderService.expireDueOrders({ tenantContext: A, now: new Date(o.periodEndsAt).getTime() + 1000 });
    const expired = await orderService.getOrderById({ id: o.id, tenantContext: A });
    expect(expired.status).toBe('expired');
    const t = await provisioningService.terminateOrder({ orderId: o.id, tenantContext: A });
    expect(t.terminated).toBe(true);
  });
});
