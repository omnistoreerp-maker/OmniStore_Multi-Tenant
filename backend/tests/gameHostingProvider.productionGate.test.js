'use strict';

// providerRegistry production-gate regression tests — final-audit hardening.
//
// Shipped defect: _resolveName() resolved an unset GAME_HOSTING_PROVIDER to
// the MockProvider in every environment, so a production process that forgot
// the env var would fulfil paid orders with in-memory infrastructure (the
// order pipeline flips an order to ACTIVE on provider success and the mock
// always succeeds). The gate now makes production resolve 'unavailable' for
// unset / mock / test selections AND for any provider name without a
// registered real adapter, while development/test defaults are unchanged.

const fs = require('fs');
const { makeTempDataDir } = require('./helpers/testData');

let dataDir;

// Load a pristine registry instance with the given env pinned.
function freshRegistry(env) {
  jest.resetModules();
  const prev = {
    nodeEnv: process.env.NODE_ENV,
    prov: process.env.GAME_HOSTING_PROVIDER
  };
  if (Object.prototype.hasOwnProperty.call(env, 'NODE_ENV')) process.env.NODE_ENV = env.NODE_ENV;
  else delete process.env.NODE_ENV;
  if (Object.prototype.hasOwnProperty.call(env, 'GAME_HOSTING_PROVIDER')) process.env.GAME_HOSTING_PROVIDER = env.GAME_HOSTING_PROVIDER;
  else delete process.env.GAME_HOSTING_PROVIDER;
  const reg = require('../services/gameHosting/providerRegistry');
  return {
    reg,
    restore() {
      if (prev.nodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = prev.nodeEnv;
      if (prev.prov === undefined) delete process.env.GAME_HOSTING_PROVIDER;
      else process.env.GAME_HOSTING_PROVIDER = prev.prov;
    }
  };
}

beforeAll(() => {
  dataDir = makeTempDataDir('gh-provider-gate');
  process.env.DIGITRONICS_DATA_DIR = dataDir;
});

afterAll(() => {
  delete process.env.DIGITRONICS_DATA_DIR;
  delete process.env.GAME_HOSTING_PROVIDER;
  if (dataDir && fs.existsSync(dataDir)) fs.rmSync(dataDir, { recursive: true, force: true });
});

describe('provider registry production gate', () => {
  test('production + unset GAME_HOSTING_PROVIDER => unavailable, never mock', () => {
    const { reg, restore } = freshRegistry({ NODE_ENV: 'production' });
    try {
      const status = reg.getStatus();
      expect(status.configured).toBe('unavailable');
      expect(status.active).toBe('unavailable');
      expect(status.isRealProvider).toBe(false);
      expect(status.note).toMatch(/not set/i);
      expect(reg.getActiveProvider().kind).toBe('unavailable');
    } finally {
      restore();
    }
  });

  test('production + explicit mock/test selection is refused', () => {
    for (const selection of ['mock', 'test']) {
      const { reg, restore } = freshRegistry({ NODE_ENV: 'production', GAME_HOSTING_PROVIDER: selection });
      try {
        expect(reg.getStatus().configured).toBe('unavailable');
        expect(reg.getStatus().note).toMatch(/not permitted in production/i);
        expect(reg.getActiveProvider().kind).toBe('unavailable');
      } finally {
        restore();
      }
    }
  });

  test('production + unregistered real-looking name cannot fall through to mock', () => {
    const { reg, restore } = freshRegistry({ NODE_ENV: 'production', GAME_HOSTING_PROVIDER: 'somefuturecloud' });
    try {
      expect(reg.getActiveProvider().kind).toBe('unavailable');
      expect(reg.getStatus().isRealProvider).toBe(false);
      expect(reg.getStatus().note).toMatch(/not implemented/i);
    } finally {
      restore();
    }
  });

  test('production + registered real adapter still serves the adapter', () => {
    const { reg, restore } = freshRegistry({ NODE_ENV: 'production', GAME_HOSTING_PROVIDER: 'fakecloud' });
    try {
      const fake = {
        provisionServer: jest.fn(), suspendServer: jest.fn(), resumeServer: jest.fn(),
        terminateServer: jest.fn(), getServerStatus: jest.fn(), getUsage: jest.fn()
      };
      reg.registerProvider('fakecloud', fake);
      expect(reg.getActiveProvider()).toBe(fake);
      expect(reg.getStatus().isRealProvider).toBe(true);
      reg._resetForTests();
    } finally {
      restore();
    }
  });

  test('development + unset => mock (unchanged)', () => {
    const { reg, restore } = freshRegistry({ NODE_ENV: 'development' });
    try {
      expect(reg.getStatus().configured).toBe('mock');
      expect(reg.getActiveProvider().kind).toBe('mock');
    } finally {
      restore();
    }
  });

  test('test env + unset => mock (unchanged; jest default)', () => {
    const { reg, restore } = freshRegistry({ NODE_ENV: 'test' });
    try {
      expect(reg.getStatus().configured).toBe('mock');
      expect(reg.getActiveProvider().kind).toBe('mock');
    } finally {
      restore();
    }
  });

  test('status never claims a real provider unless one is registered', () => {
    const envs = [
      { NODE_ENV: 'production' },
      { NODE_ENV: 'production', GAME_HOSTING_PROVIDER: 'mock' },
      { NODE_ENV: 'production', GAME_HOSTING_PROVIDER: 'somefuturecloud' },
      { NODE_ENV: 'development' },
      { NODE_ENV: 'test' }
    ];
    for (const env of envs) {
      const { reg, restore } = freshRegistry(env);
      try {
        expect(reg.getStatus().isRealProvider).toBe(false);
      } finally {
        restore();
      }
    }
  });

  test('production pipeline: paid order cannot become ACTIVE on the mock', async () => {
    // Full-pipeline proof with the REAL orchestrator services: a paid order
    // in a production process must fail provisioning with NOT_CONFIGURED and
    // never create a server.
    jest.resetModules();
    const prevNodeEnv = process.env.NODE_ENV;
    const prevProv = process.env.GAME_HOSTING_PROVIDER;
    process.env.NODE_ENV = 'production';
    delete process.env.GAME_HOSTING_PROVIDER;
    try {
      const orderService = require('../services/gameHostingOrder.service');
      const provisioningService = require('../services/gameHostingProvisioning.service');
      const gh = require('../services/gameHosting.service');
      const tenant = { tenantId: 'tenantProd' };

      const planRes = await gh.createPlan({
        data: { name: 'prod-gate-plan', gameTitle: 'Minecraft', pricePerMonth: 20, status: 'active' },
        tenantContext: tenant
      });
      expect(planRes.error).toBeUndefined();

      const o = await orderService.createOrder({
        data: { planId: planRes.plan.id, billingPeriod: '1m', serverName: 'srv-prod-gate', customerId: 'cust-1', skipProvision: true },
        tenantContext: tenant
      });
      expect(o.error).toBeUndefined();

      const pay = await orderService.applyPaymentResult({
        orderId: o.order.id, tenantContext: tenant,
        paymentRef: 'PAY-PROD-GATE-1', amount: o.order.amount, status: 'paid'
      });
      expect(pay.error).toBeUndefined();
      expect(pay.order.paymentStatus).toBe('paid');

      const res = await provisioningService.provisionOrder({ orderId: o.order.id, tenantContext: tenant });
      expect(res.order.status).toBe('provisioning_failed');
      expect(res.providerFailure.code).toBe('NOT_CONFIGURED');
      expect(res.providerFailure.retryable).toBe(false);
      expect(res.providerFailure.message).toMatch(/GAME_HOSTING_PROVIDER is not set/i);

      const servers = await gh.listServers({ query: { orderId: o.order.id }, tenantContext: tenant });
      expect(servers).toHaveLength(0);
    } finally {
      if (prevNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = prevNodeEnv;
      if (prevProv === undefined) delete process.env.GAME_HOSTING_PROVIDER;
      else process.env.GAME_HOSTING_PROVIDER = prevProv;
    }
  });
});
