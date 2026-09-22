'use strict';

// Provider contract tests — every registered adapter MUST satisfy the
// same behavioral contract. Runs the full scenario suite against the
// MockProvider (and the registry default), which is what real adapters
// will be validated against before they may be registered.

const fs = require('fs');
const { makeTempDataDir } = require('./helpers/testData');

let dataDir;
let providerRegistry;
let MockProvider;
let UnavailableProvider;
let providerContract;

beforeAll(() => {
  dataDir = makeTempDataDir('gh-provider');
  process.env.DIGITRONICS_DATA_DIR = dataDir;
  jest.resetModules();
  providerRegistry = require('../services/gameHosting/providerRegistry');
  MockProvider = require('../services/gameHosting/mockProvider').MockProvider;
  UnavailableProvider = require('../services/gameHosting/unavailableProvider').UnavailableProvider;
  providerContract = require('../services/gameHosting/providerContract');
});

afterAll(() => {
  delete process.env.DIGITRONICS_DATA_DIR;
  if (dataDir && fs.existsSync(dataDir)) fs.rmSync(dataDir, { recursive: true, force: true });
});

const INPUT = {
  orderRef: 'order-1',
  orderKey: 'ghorder-test-key-1',
  planId: 'plan-1',
  planName: 'MC 10p',
  serverName: 'srv-1',
  region: 'eu',
  customerId: 'cust-1',
  tenantId: 'tenantA'
};

function contractSuite(buildProvider) {
  let provider;

  beforeEach(() => {
    provider = buildProvider();
  });

  test('implements all required operations', () => {
    expect(() => providerContract.validateProvider('suite', provider)).not.toThrow();
  });

  test('provisionServer returns ok envelope with externalId', async () => {
    const r = await provider.provisionServer(INPUT);
    expect(r.ok).toBe(true);
    expect(r.status).toBe('active');
    expect(r.server.externalId).toBeTruthy();
    expect(r.provider).toBeTruthy();
  });

  test('provisionServer is idempotent on orderKey — no duplicate instance', async () => {
    const r1 = await provider.provisionServer(INPUT);
    const r2 = await provider.provisionServer(INPUT);
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    expect(r2.server.externalId).toBe(r1.server.externalId);
  });

  test('provisionServer rejects missing orderKey with an error envelope', async () => {
    const r = await provider.provisionServer({});
    expect(r.ok).toBe(false);
    expect(r.code).toBeTruthy();
  });

  test('suspend → status suspended → resume → status active', async () => {
    await provider.provisionServer(INPUT);
    const s = await provider.suspendServer(INPUT);
    expect(s.ok).toBe(true);
    expect(s.status).toBe('suspended');
    const st = await provider.getServerStatus(INPUT);
    expect(st.ok).toBe(true);
    expect(st.status).toBe('suspended');
    const r = await provider.resumeServer(INPUT);
    expect(r.ok).toBe(true);
    expect(r.status).toBe('active');
  });

  test('terminate is terminal and status reflects it', async () => {
    await provider.provisionServer(INPUT);
    const t = await provider.terminateServer(INPUT);
    expect(t.ok).toBe(true);
    expect(t.status).toBe('terminated');
    const st = await provider.getServerStatus(INPUT);
    expect(st.status).toBe('terminated');
  });

  test('getUsage returns a usage payload', async () => {
    await provider.provisionServer(INPUT);
    const u = await provider.getUsage(INPUT);
    expect(u.ok).toBe(true);
    expect(u.raw && u.raw.usage).toBeTruthy();
  });

  test('operations on unknown orderKey fail with NOT_FOUND-style envelope', async () => {
    const r = await provider.getServerStatus({ orderKey: 'ghorder-unknown' });
    expect(r.ok).toBe(false);
    expect(r.code).toBeTruthy();
  });
}

describe('provider contract — MockProvider', () => {
  contractSuite(() => new MockProvider({ kind: 'mock' }));
});

describe('provider contract — registry default (mock)', () => {
  contractSuite(() => providerRegistry.getActiveProvider());
});

describe('mock provider failure injection', () => {
  test('failNext makes the next call fail once with retryable flag', async () => {
    const p = new MockProvider({
      failNext: { provisionServer: { retryable: true, code: 'CAPACITY', message: 'no capacity' } }
    });
    const r1 = await p.provisionServer(INPUT);
    expect(r1.ok).toBe(false);
    expect(r1.retryable).toBe(true);
    expect(r1.code).toBe('CAPACITY');
    // next call succeeds and creates the instance exactly once
    const r2 = await p.provisionServer(INPUT);
    expect(r2.ok).toBe(true);
    expect(r2.server.externalId).toBeTruthy();
  });

  test('failAlways keeps failing until a call succeeds after clearing', async () => {
    const p = new MockProvider({ failAlways: { suspendServer: { retryable: false, code: 'DOWN', message: 'down' } } });
    await p.provisionServer(INPUT);
    expect((await p.suspendServer(INPUT)).ok).toBe(false);
    expect((await p.suspendServer(INPUT)).ok).toBe(false);
    delete p.failAlways.suspendServer;
    expect((await p.suspendServer(INPUT)).ok).toBe(true);
  });
});

describe('unavailable provider', () => {
  test('every operation returns NOT_CONFIGURED non-retryable envelope', async () => {
    const p = new UnavailableProvider('test reason');
    const ops = ['provisionServer', 'suspendServer', 'resumeServer', 'terminateServer', 'getServerStatus', 'getUsage'];
    for (const op of ops) {
      const r = await p[op]({});
      expect(r.ok).toBe(false);
      expect(r.code).toBe('NOT_CONFIGURED');
      expect(r.retryable).toBe(false);
      expect(r.message).toContain('test reason');
    }
  });
});

describe('provider registry', () => {
  test('default resolves to mock with isRealProvider=false', () => {
    delete process.env.GAME_HOSTING_PROVIDER;
    jest.resetModules();
    const reg = require('../services/gameHosting/providerRegistry');
    const status = reg.getStatus();
    expect(status.configured).toBe('mock');
    expect(status.isRealProvider).toBe(false);
  });

  test('unknown provider name falls back to mock with an integration note', () => {
    process.env.GAME_HOSTING_PROVIDER = 'somefuturecloud';
    jest.resetModules();
    const reg = require('../services/gameHosting/providerRegistry');
    const status = reg.getStatus();
    expect(status.isRealProvider).toBe(false);
    expect(status.note).toMatch(/not implemented/i);
    delete process.env.GAME_HOSTING_PROVIDER;
  });

  test('registerProvider validates the contract and serves the adapter', () => {
    jest.resetModules();
    process.env.GAME_HOSTING_PROVIDER = 'fakecloud';
    const reg = require('../services/gameHosting/providerRegistry');
    const fake = { provisionServer: jest.fn(), suspendServer: jest.fn(), resumeServer: jest.fn(), terminateServer: jest.fn(), getServerStatus: jest.fn(), getUsage: jest.fn() };
    reg.registerProvider('fakecloud', fake);
    expect(reg.getActiveProvider('fakecloud')).toBe(fake);
    expect(reg.getStatus().isRealProvider).toBe(true);
    reg._resetForTests();
    delete process.env.GAME_HOSTING_PROVIDER;
  });

  test('registerProvider rejects adapters missing operations', () => {
    const reg = require('../services/gameHosting/providerRegistry');
    expect(() => reg.registerProvider('broken', { provisionServer: jest.fn() })).toThrow(/missing required operations/i);
  });
});
