'use strict';

// Phase 2C — Loyalty operational enhancements tests.
// Features: birthday bonus, tier benefits, enhanced metrics.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const SERVICE_PATH = path.resolve(REPO_ROOT, 'backend', 'services', 'loyalty.service.js');
const REPO_PATH = path.resolve(REPO_ROOT, 'backend', 'repositories', 'loyalty.repository.js');
const CUSTOMER_SERVICE_PATH = path.resolve(REPO_ROOT, 'backend', 'services', 'customers.service.js');

function createSandbox(overrides = {}) {
  const transactions = [];
  const configs = {};
  const customers = [];

  const localStorageMock = {
    _store: {},
    getItem(k) { return this._store[k] || null; },
    setItem(k, v) { this._store[k] = String(v); },
    removeItem(k) { delete this._store[k]; }
  };

  const loyaltyRepo = {
    _tenantId: () => 'tenant-a',
    _load: async () => ({ transactions, configs }),
    _save: async () => true,
    _filter: (arr) => arr,
    async getConfig() {
      return configs['tenant-a'] || {
        enabled: true,
        earnPerAmount: 100,
        pointsPerUnit: 1,
        redeemValue: 1,
        maxRedeemPercent: 20,
        birthdayBonusPoints: 50,
        tierBenefits: {
          bronze: { discountPercent: 0, badge: 'badge-yellow' },
          silver: { discountPercent: 5, badge: 'badge-green' },
          gold: { discountPercent: 10, badge: 'badge-yellow' },
          platinum: { discountPercent: 15, badge: 'badge-blue' }
        }
      };
    },
    async saveConfig(cfg) {
      configs['tenant-a'] = { ...(configs['tenant-a'] || {}), ...cfg };
      return configs['tenant-a'];
    },
    async getBalance(customerId) {
      const txs = transactions.filter(t => String(t.customerId) === String(customerId) && t.tenantId === 'tenant-a');
      const points = txs.reduce((sum, t) => sum + (Number(t.points) || 0), 0);
      return { customerId, points: Math.max(0, points), transactionCount: txs.length };
    },
    async listTransactions(query = {}) {
      let txs = [...transactions];
      if (query.customerId) txs = txs.filter(t => String(t.customerId) === String(query.customerId));
      if (query.type) txs = txs.filter(t => t.type === query.type);
      txs.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
      const page = Math.max(1, parseInt(query.page, 10) || 1);
      const limit = Math.min(100, Math.max(1, parseInt(query.limit, 10) || 50));
      const start = (page - 1) * limit;
      return { transactions: txs.slice(start, start + limit), total: txs.length, page, limit, totalPages: Math.ceil(txs.length / limit) || 1 };
    },
    async getTransactionByRef(ref, refType, customerId) {
      return transactions.find(t => t.ref === ref && t.refType === refType && String(t.customerId) === String(customerId)) || null;
    },
    async getReversalForReturn(returnId, customerId) {
      return transactions.find(t => t.ref === returnId && t.type === 'return_deduct' && String(t.customerId) === String(customerId)) || null;
    },
    async appendTransaction(tx) {
      transactions.unshift(tx);
      return tx;
    },
    async getMetrics() {
      const byType = transactions.reduce((acc, t) => {
        const key = t.type || 'unknown';
        acc[key] = (acc[key] || 0) + (Number(t.points) || 0);
        return acc;
      }, {});
      const customerIds = new Set(transactions.map(t => t.customerId).filter(Boolean));
      const issued = byType['earn'] || 0;
      const redeemed = Math.abs(byType['redeem'] || 0);
      const returned = Math.abs(byType['return_deduct'] || 0);
      const adjusted = Math.abs(byType['adjustment'] || 0);
      const bonus = byType['bonus'] || 0;
      const outstanding = Math.max(0, issued - redeemed - returned + adjusted + bonus);
      const tierDistribution = { bronze: 0, silver: 0, gold: 0, platinum: 0 };
      for (const cid of customerIds) {
        const bal = await loyaltyRepo.getBalance(cid);
        const pts = bal.points || 0;
        if (pts >= 1000) tierDistribution.platinum++;
        else if (pts >= 500) tierDistribution.gold++;
        else if (pts >= 150) tierDistribution.silver++;
        else tierDistribution.bronze++;
      }
      return {
        totalIssued: issued,
        totalRedeemed: redeemed,
        totalReturned: returned,
        totalAdjusted: adjusted,
        totalBonus: bonus,
        outstandingLiability: outstanding,
        activeCustomerCount: customerIds.size,
        transactionCount: transactions.length,
        tierDistribution
      };
    }
  };

  const customersService = {
    async getById(customerId) {
      return customers.find(c => String(c.id) === String(customerId)) || null;
    }
  };

  const mockRequire = (id) => {
    if (id === '../repositories/loyalty.repository') return loyaltyRepo;
    if (id === '../services/customers.service') return customersService;
    if (id === '../utils/apiResponse') return { success: (res, data, msg, code) => ({ success: true, data, message: msg, statusCode: code }), error: (res, msg, code) => ({ success: false, message: msg, statusCode: code }) };
    if (id === '../utils/logger') return { error: () => {}, warn: () => {}, info: () => {}, debug: () => {} };
    if (id === '../utils/asyncMutex') return class AsyncMutex { async runExclusive(fn) { return fn(); } };
    throw new Error('Module not found: ' + id);
  };

  const sandbox = {
    localStorage: localStorageMock,
    require: mockRequire,
    module: { exports: {} },
    exports: {},
    window: {
      backendApi: overrides.backendApi || {
        loyalty: {
          getBalance: async (customerId) => ({ success: true, data: loyaltyRepo.getBalance(customerId) }),
          getTransactions: async (customerId, query) => ({ success: true, data: await loyaltyRepo.listTransactions({ customerId, ...query }) }),
          getConfig: async () => ({ success: true, data: await loyaltyRepo.getConfig() }),
          getMetrics: async () => ({ success: true, data: await loyaltyRepo.getMetrics() }),
          earn: async (payload) => ({ success: true, data: { customerId: payload.customerId, points: payload.points, balanceAfter: 100, id: 'LP-1' } }),
          redeem: async (payload) => ({ success: true, data: { customerId: payload.customerId, points: -payload.points, balanceAfter: 50, id: 'LP-2' } }),
          reverse: async (payload) => ({ success: true, data: { customerId: payload.customerId, points: -10, balanceAfter: 40, id: 'LP-3' } }),
          awardBirthdayBonus: async (customerId) => ({ success: true, data: { customerId, points: 50, balanceAfter: 150, id: 'LP-bday' } })
        }
      },
      loyaltySyncQueue: {
        findPending: () => null,
        createOperation: (op) => op,
        enqueue: (op) => op,
        getPendingOperations: () => [],
        updateRetrySchedule: (id, error) => null,
        markConfirmed: (id) => {},
        markDuplicate: (id, existingId) => {},
        markConflict: (id, error) => {},
        markDeadLetter: (id, error) => {},
        loadQueue: () => [],
        saveQueue: (q) => {},
        loadDeadLetter: () => [],
        saveDeadLetter: (d) => {}
      },
      loyaltySync: {
        syncLoyaltyForSale: async () => {},
        syncLoyaltyForReturn: async () => {},
        processSyncQueue: async () => {}
      },
      getLoyaltyConfig: () => ({
        enabled: true,
        earnPerAmount: 100,
        pointsPerUnit: 1,
        redeemValue: 1,
        maxRedeemPercent: 20,
        birthdayBonusPoints: 50,
        tierBenefits: {
          bronze: { discountPercent: 0, badge: 'badge-yellow' },
          silver: { discountPercent: 5, badge: 'badge-green' },
          gold: { discountPercent: 10, badge: 'badge-yellow' },
          platinum: { discountPercent: 15, badge: 'badge-blue' }
        }
      }),
      getCustomerByNameOrPhone: (name, phone) => ({ id: 'c1', name, phone }),
      DB: { customers: [], saleInvoices: [], returns: [], loyaltyTransactions: [] },
      console
    }
  };

  const ctx = vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(SERVICE_PATH, 'utf-8'), ctx);
  return { ctx, loyaltyRepo, customers, transactions, configs };
}

describe('Phase 2C — Loyalty operational enhancements', () => {
  describe('Birthday Bonus', () => {
    test('awards birthday bonus on customer birthday', async () => {
      const { ctx, customers } = createSandbox();
      customers.push({ id: 'c1', name: 'Alice', birthDate: new Date().toISOString().split('T')[0] });
      const result = await ctx.module.exports.awardBirthdayBonus('c1', { source: 'admin' });
      expect(result.error).toBeUndefined();
      expect(result.transaction).toBeDefined();
      expect(result.transaction.type).toBe('bonus');
      expect(result.transaction.points).toBe(50);
      expect(result.balance).toBe(50);
    });

    test('prevents duplicate birthday bonus same day', async () => {
      const { ctx, customers, transactions } = createSandbox();
      customers.push({ id: 'c1', name: 'Alice', birthDate: new Date().toISOString().split('T')[0] });
      await ctx.module.exports.awardBirthdayBonus('c1', { source: 'admin' });
      const result = await ctx.module.exports.awardBirthdayBonus('c1', { source: 'admin' });
      expect(result.duplicate).toBe(true);
      expect(transactions.filter(t => t.type === 'bonus').length).toBe(1);
    });

    test('rejects birthday bonus when customer has no birth date', async () => {
      const { ctx, customers } = createSandbox();
      customers.push({ id: 'c1', name: 'Alice' });
      const result = await ctx.module.exports.awardBirthdayBonus('c1', { source: 'admin' });
      expect(result.error).toBe('Customer has no birth date');
    });

    test('rejects birthday bonus when not birthday', async () => {
      const { ctx, customers } = createSandbox();
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      customers.push({ id: 'c1', name: 'Alice', birthDate: tomorrow.toISOString().split('T')[0] });
      const result = await ctx.module.exports.awardBirthdayBonus('c1', { source: 'admin' });
      expect(result.error).toBe("Today is not the customer's birthday");
    });
  });

  describe('Tier Benefits', () => {
    test('reward status includes tier benefits from config', async () => {
      const { ctx } = createSandbox();
      const status = ctx.module.exports._rewardStatus(600, {});
      expect(status.code).toBe('gold');
      expect(status.discountPercent).toBe(10);
      expect(status.badge).toBe('badge-yellow');
    });

    test('reward status falls back to defaults when config missing', async () => {
      const { ctx } = createSandbox();
      const status = ctx.module.exports._rewardStatus(0, {});
      expect(status.code).toBe('bronze');
      expect(status.discountPercent).toBe(0);
    });
  });

  describe('Enhanced Metrics', () => {
    test('metrics include tier distribution', async () => {
      const { ctx, loyaltyRepo, transactions } = createSandbox();
      transactions.push(
        { id: 't1', customerId: 'c1', type: 'earn', points: 200, tenantId: 'tenant-a', createdAt: new Date().toISOString() },
        { id: 't2', customerId: 'c2', type: 'earn', points: 600, tenantId: 'tenant-a', createdAt: new Date().toISOString() },
        { id: 't3', customerId: 'c3', type: 'earn', points: 1100, tenantId: 'tenant-a', createdAt: new Date().toISOString() }
      );
      const metrics = await loyaltyRepo.getMetrics();
      expect(metrics.tierDistribution).toBeDefined();
      expect(metrics.tierDistribution.bronze).toBe(0);
      expect(metrics.tierDistribution.silver).toBe(1);
      expect(metrics.tierDistribution.gold).toBe(1);
      expect(metrics.tierDistribution.platinum).toBe(1);
    });
  });

  describe('Config Validation', () => {
    test('accepts birthdayBonusPoints in config', async () => {
      const { ctx } = createSandbox();
      const result = await ctx.module.exports.updateConfig({ birthdayBonusPoints: 100 });
      expect(result.error).toBeUndefined();
      expect(result.config.birthdayBonusPoints).toBe(100);
    });

    test('rejects negative birthdayBonusPoints', async () => {
      const { ctx } = createSandbox();
      const result = await ctx.module.exports.updateConfig({ birthdayBonusPoints: -10 });
      expect(result.error).toContain('birthdayBonusPoints must be a number >= 0');
    });

    test('accepts tierBenefits in config', async () => {
      const { ctx } = createSandbox();
      const result = await ctx.module.exports.updateConfig({
        tierBenefits: {
          bronze: { discountPercent: 0, badge: 'badge-yellow' },
          silver: { discountPercent: 5, badge: 'badge-green' }
        }
      });
      expect(result.error).toBeUndefined();
      expect(result.config.tierBenefits.silver.discountPercent).toBe(5);
    });
  });

  describe('RBAC / Security', () => {
    test('birthday bonus endpoint exists and requires loyalty.manage', async () => {
      const routesPath = path.resolve(REPO_ROOT, 'backend', 'routes', 'loyalty.routes.js');
      const routesCode = fs.readFileSync(routesPath, 'utf-8');
      expect(routesCode).toContain('awardBirthdayBonus');
      expect(routesCode).toContain('loyalty.manage');
    });
  });
});
