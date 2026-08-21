// P0-3 Inventory Transactions tenant write guard regression tests.
// Verifies: matching tenant accepted, omitted tenant auto-stamped,
// foreign tenant rejected, no cross-tenant mutation.
const { makeTempDataDir } = require('./helpers/testData');

let dataDir;
let service;
let mockTenantCtx;

function freshService() {
  jest.resetModules();
  process.env.DIGITRONICS_DATA_DIR = dataDir;
  jest.mock('../repositories', () => {
    const store = { transactions: [] };
    const repo = {
      readAsync: jest.fn(() => Promise.resolve(JSON.parse(JSON.stringify(store)))),
      writeAsync: jest.fn(() => Promise.resolve(true)),
      _rawStoreAsync: jest.fn(() => Promise.resolve(store)),
      hasTenant: () => mockTenantCtx !== null,
      getCurrentTenant: () => mockTenantCtx,
    };
    return { inventoryTransactions: repo };
  });
  return require('../services/inventoryTransactions.service');
}

beforeEach(() => {
  dataDir = makeTempDataDir('inv-txn-tenant');
  mockTenantCtx = null;
});

afterEach(() => {
  const fs = require('fs');
  if (dataDir && fs.existsSync(dataDir)) fs.rmSync(dataDir, { recursive: true, force: true });
  jest.restoreAllMocks();
});

describe('P0-3 Inventory Transactions Tenant Write Guard', () => {
  describe('matching tenant → accepted', () => {
    test('create with matching tenantId succeeds', async () => {
      mockTenantCtx = { tenantId: 'T-A' };
      service = freshService();
      const result = await service.create({
        productId: 'p1', type: 'in', qty: 10, tenantId: 'T-A'
      });
      expect(result.transaction).toBeTruthy();
      expect(result.transaction.tenantId).toBe('T-A');
    });
  });

  describe('omitted tenant → server stamped', () => {
    test('create without tenantId when context active auto-stamps', async () => {
      mockTenantCtx = { tenantId: 'T-A' };
      service = freshService();
      const result = await service.create({
        productId: 'p1', type: 'in', qty: 5
      });
      expect(result.transaction).toBeTruthy();
      expect(result.transaction.tenantId).toBe('T-A');
    });

    test('create with empty string tenantId auto-stamps', async () => {
      mockTenantCtx = { tenantId: 'T-A' };
      service = freshService();
      const result = await service.create({
        productId: 'p1', type: 'in', qty: 5, tenantId: ''
      });
      expect(result.transaction).toBeTruthy();
      expect(result.transaction.tenantId).toBe('T-A');
    });

    test('create with null tenantId auto-stamps', async () => {
      mockTenantCtx = { tenantId: 'T-A' };
      service = freshService();
      const result = await service.create({
        productId: 'p1', type: 'in', qty: 5, tenantId: null
      });
      expect(result.transaction).toBeTruthy();
      expect(result.transaction.tenantId).toBe('T-A');
    });
  });

  describe('foreign tenant → rejected', () => {
    test('create with different tenantId returns error', async () => {
      mockTenantCtx = { tenantId: 'T-A' };
      service = freshService();
      const result = await service.create({
        productId: 'p1', type: 'in', qty: 10, tenantId: 'T-B'
      });
      expect(result.error).toBeTruthy();
      expect(result.error).toContain('Invalid tenant claim');
      expect(result.transaction).toBeUndefined();
    });
  });

  describe('no tenant context → no auto-stamp', () => {
    test('create without tenantId when no context leaves it undefined', async () => {
      mockTenantCtx = null;
      service = freshService();
      const result = await service.create({
        productId: 'p1', type: 'in', qty: 5
      });
      expect(result.transaction).toBeTruthy();
      expect(result.transaction.tenantId).toBeUndefined();
    });
  });

  describe('no cross-tenant mutation', () => {
    test('update of foreign-tenant record returns not found', async () => {
      mockTenantCtx = { tenantId: 'T-A' };
      service = freshService();
      // Seed a T-B owned transaction directly via _rawStoreAsync
      const repo = require('../repositories').inventoryTransactions;
      const store = { transactions: [
        { id: 'txn-b1', productId: 'p1', type: 'in', qty: 10, tenantId: 'T-B', createdAt: new Date().toISOString() }
      ]};
      repo._rawStoreAsync.mockResolvedValue(store);
      repo.readAsync.mockResolvedValue(store);

      const result = await service.update('txn-b1', { qty: 20 });
      expect(result.error).toBeTruthy();
      expect(result.error).toContain('not found');
    });

    test('delete of foreign-tenant record returns not found', async () => {
      mockTenantCtx = { tenantId: 'T-A' };
      service = freshService();
      const repo = require('../repositories').inventoryTransactions;
      const store = { transactions: [
        { id: 'txn-b2', productId: 'p1', type: 'out', qty: 5, tenantId: 'T-B', createdAt: new Date().toISOString() }
      ]};
      repo._rawStoreAsync.mockResolvedValue(store);
      repo.readAsync.mockResolvedValue(store);

      const result = await service.delete('txn-b2');
      expect(result.error).toBeTruthy();
      expect(result.error).toContain('not found');
    });

    test('update of same-tenant record succeeds', async () => {
      mockTenantCtx = { tenantId: 'T-A' };
      service = freshService();
      const repo = require('../repositories').inventoryTransactions;
      const store = { transactions: [
        { id: 'txn-a1', productId: 'p1', type: 'in', qty: 10, tenantId: 'T-A', createdAt: new Date().toISOString() }
      ]};
      repo._rawStoreAsync.mockResolvedValue(store);
      repo.readAsync.mockResolvedValue(store);

      const result = await service.update('txn-a1', { qty: 20 });
      expect(result.transaction).toBeTruthy();
      expect(result.transaction.qty).toBe(20);
    });
  });

  describe('create validation still works', () => {
    test('missing productId returns error', async () => {
      mockTenantCtx = { tenantId: 'T-A' };
      service = freshService();
      const result = await service.create({ type: 'in', qty: 10 });
      expect(result.error).toContain('productId');
    });

    test('missing type returns error', async () => {
      mockTenantCtx = { tenantId: 'T-A' };
      service = freshService();
      const result = await service.create({ productId: 'p1', qty: 10 });
      expect(result.error).toContain('type');
    });

    test('duplicate ID returns error', async () => {
      mockTenantCtx = { tenantId: 'T-A' };
      service = freshService();
      await service.create({ id: 'dup-1', productId: 'p1', type: 'in', qty: 10 });
      const result = await service.create({ id: 'dup-1', productId: 'p1', type: 'in', qty: 5 });
      expect(result.error).toContain('Duplicate');
    });
  });
});
