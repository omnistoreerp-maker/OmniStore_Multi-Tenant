'use strict';

// Phase 2D — Loyalty point expiry and tier-specific rules tests.
// Features: configurable point expiry, tier-specific earn multipliers,
// tier-specific expiry days, FEFO redemption, legacy compatibility.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const SERVICE_PATH = path.resolve(REPO_ROOT, 'backend', 'services', 'loyalty.service.js');

function createSandbox(overrides = {}) {
  const transactions = [];
  const configs = {};
  const customers = [];

  const loyaltyRepo = {
    _tenantId: () => 'tenant-a',
    _load: async () => ({ transactions, configs }),
    _save: async () => true,
    _filter: (arr) => {
      if (!Array.isArray(arr)) return [];
      const tenantId = loyaltyRepo._tenantId();
      if (tenantId == null) return arr;
      return arr.filter(r => {
        if (!r || typeof r !== 'object') return true;
        if (r.tenantId === undefined || r.tenantId === null || r.tenantId === '') return true;
        return String(r.tenantId) === String(tenantId);
      });
    },
    async getConfig() {
      return configs['tenant-a'] || {
        enabled: true,
        earnPerAmount: 100,
        pointsPerUnit: 1,
        redeemValue: 1,
        maxRedeemPercent: 20,
        birthdayBonusPoints: 50,
        expiryEnabled: false,
        defaultExpiryDays: 365,
        tierExpiryOverrides: {},
        tierBenefits: {
          bronze: { discountPercent: 0, badge: 'badge-yellow', earnMultiplier: 1, redeemLimitPercent: 100, expiryDays: 365 },
          silver: { discountPercent: 5, badge: 'badge-green', earnMultiplier: 1, redeemLimitPercent: 100, expiryDays: 365 },
          gold: { discountPercent: 10, badge: 'badge-yellow', earnMultiplier: 1.2, redeemLimitPercent: 100, expiryDays: 540 },
          platinum: { discountPercent: 15, badge: 'badge-blue', earnMultiplier: 1.5, redeemLimitPercent: 100, expiryDays: 730 }
        }
      };
    },
    async saveConfig(cfg) {
      configs['tenant-a'] = { ...(configs['tenant-a'] || {}), ...cfg };
      return configs['tenant-a'];
    },
    async getBalance(customerId) {
      const txs = loyaltyRepo._filter(transactions).filter(t => String(t.customerId) === String(customerId));
      const points = txs.reduce((sum, t) => sum + (Number(t.points) || 0), 0);
      return { customerId, points: Math.max(0, points), transactionCount: txs.length };
    },
    async listTransactions(query = {}) {
      let txs = loyaltyRepo._filter([...transactions]);
      if (query.customerId) txs = txs.filter(t => String(t.customerId) === String(query.customerId));
      if (query.type) txs = txs.filter(t => t.type === query.type);
      txs.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
      const total = txs.length;
      const pageNum = Math.max(1, parseInt(query.page, 10) || 1);
      const limitNum = Math.min(100, Math.max(1, parseInt(query.limit, 10) || 50));
      const startIndex = (pageNum - 1) * limitNum;
      const paginated = txs.slice(startIndex, startIndex + limitNum);
      return { transactions: paginated, total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) || 1 };
    },
    async getTransactionByRef(ref, refType, customerId) {
      return loyaltyRepo._filter(transactions).find(t => t.ref === ref && t.refType === refType && String(t.customerId) === String(customerId)) || null;
    },
    async getReversalForReturn(returnId, customerId) {
      return loyaltyRepo._filter(transactions).find(t => t.ref === returnId && t.type === 'return_deduct' && String(t.customerId) === String(customerId)) || null;
    },
    async appendTransaction(tx) {
      transactions.unshift(tx);
      return tx;
    },
    async getMetrics() {
      const allTx = loyaltyRepo._filter(transactions);
      const byType = allTx.reduce((acc, t) => {
        const key = t.type || 'unknown';
        acc[key] = (acc[key] || 0) + (Number(t.points) || 0);
        return acc;
      }, {});
      const customerIds = new Set(allTx.map(t => t.customerId).filter(Boolean));
      const issued = byType['earn'] || 0;
      const redeemed = Math.abs(byType['redeem'] || 0);
      const returned = Math.abs(byType['return_deduct'] || 0);
      const adjusted = Math.abs(byType['adjustment'] || 0);
      const bonus = byType['bonus'] || 0;
      const outstanding = Math.max(0, issued - redeemed - returned + adjusted + bonus);
      const now = new Date();
      const expired = allTx
        .filter(t => (t.type === 'earn' || t.type === 'bonus') && t.expiresAt && new Date(t.expiresAt) <= now)
        .reduce((sum, t) => sum + (Number(t.points) || 0), 0);
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
        expiredPoints: expired,
        outstandingLiability: outstanding,
        activeCustomerCount: customerIds.size,
        transactionCount: allTx.length,
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
    localStorage: { _store: {}, getItem(k) { return this._store[k] || null; }, setItem(k, v) { this._store[k] = String(v); }, removeItem(k) { delete this._store[k]; } },
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
        expiryEnabled: false,
        defaultExpiryDays: 365,
        tierExpiryOverrides: {},
        tierBenefits: {
          bronze: { discountPercent: 0, badge: 'badge-yellow', earnMultiplier: 1, redeemLimitPercent: 100, expiryDays: 365 },
          silver: { discountPercent: 5, badge: 'badge-green', earnMultiplier: 1, redeemLimitPercent: 100, expiryDays: 365 },
          gold: { discountPercent: 10, badge: 'badge-yellow', earnMultiplier: 1.2, redeemLimitPercent: 100, expiryDays: 540 },
          platinum: { discountPercent: 15, badge: 'badge-blue', earnMultiplier: 1.5, redeemLimitPercent: 100, expiryDays: 730 }
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

describe('Phase 2D — Loyalty point expiry and tier-specific rules', () => {
  describe('Point Expiry', () => {
    test('earned points receive expiresAt when expiry is enabled', async () => {
      const { ctx, customers, configs } = createSandbox();
      customers.push({ id: 'c1', name: 'Alice', points: 0 });
      configs['tenant-a'] = {
        ...configs['tenant-a'],
        expiryEnabled: true,
        defaultExpiryDays: 30,
        tierExpiryOverrides: { bronze: 30, silver: 30, gold: 30, platinum: 30 }
      };
      const result = await ctx.module.exports.earn({ customerId: 'c1', points: 100, amount: 10000, ref: 'INV-1', refType: 'sale' });
      expect(result.error).toBeUndefined();
      expect(result.transaction.expiresAt).toBeDefined();
      const expiryDate = new Date(result.transaction.expiresAt);
      const earnedDate = new Date(result.transaction.createdAt);
      const diffDays = (expiryDate - earnedDate) / (1000 * 60 * 60 * 24);
      expect(diffDays).toBeGreaterThanOrEqual(29);
      expect(diffDays).toBeLessThanOrEqual(31);
    });

    test('legacy points without expiresAt are treated as non-expiring', async () => {
      const { ctx, loyaltyRepo, customers, transactions } = createSandbox();
      customers.push({ id: 'c1', name: 'Alice', points: 0 });
      transactions.push({
        id: 'LP-legacy',
        customerId: 'c1',
        tenantId: 'tenant-a',
        type: 'earn',
        points: 100,
        balanceAfter: 100,
        ref: 'INV-LEGACY',
        refType: 'sale',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
      const result = await ctx.module.exports.getBalance('c1');
      expect(result.points).toBe(100);
      expect(result.expiredPoints).toBe(0);
    });

    test('expired points are excluded from available balance', async () => {
      const { ctx, customers, configs } = createSandbox();
      customers.push({ id: 'c1', name: 'Alice', points: 0 });
      configs['tenant-a'] = {
        ...configs['tenant-a'],
        expiryEnabled: true,
        defaultExpiryDays: 0,
        tierExpiryOverrides: { bronze: 0, silver: 0, gold: 0, platinum: 0 }
      };
      await ctx.module.exports.earn({ customerId: 'c1', points: 100, amount: 10000, ref: 'INV-1', refType: 'sale' });
      const result = await ctx.module.exports.getBalance('c1');
      expect(result.points).toBe(0);
      expect(result.expiredPoints).toBe(100);
    });

    test('non-expired points remain redeemable', async () => {
      const { ctx, customers, configs } = createSandbox();
      customers.push({ id: 'c1', name: 'Alice', points: 0 });
      configs['tenant-a'] = { ...configs['tenant-a'], expiryEnabled: true, defaultExpiryDays: 365 };
      await ctx.module.exports.earn({ customerId: 'c1', points: 100, amount: 10000, ref: 'INV-1', refType: 'sale' });
      const result = await ctx.module.exports.redeem({ customerId: 'c1', points: 50, amount: 1000, ref: 'REDEEM-1', refType: 'manual' });
      expect(result.error).toBeUndefined();
      expect(result.balance).toBe(50);
    });

    test('redemption cannot consume expired points', async () => {
      const { ctx, customers, transactions } = createSandbox();
      customers.push({ id: 'c1', name: 'Alice', points: 0 });
      transactions.push(
        {
          id: 'LP-expired',
          customerId: 'c1',
          tenantId: 'tenant-a',
          type: 'earn',
          points: 50,
          balanceAfter: 50,
          ref: 'INV-EXPIRED',
          refType: 'sale',
          expiresAt: new Date(Date.now() - 86400000).toISOString(),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        },
        {
          id: 'LP-valid',
          customerId: 'c1',
          tenantId: 'tenant-a',
          type: 'earn',
          points: 100,
          balanceAfter: 100,
          ref: 'INV-VALID',
          refType: 'sale',
          expiresAt: new Date(Date.now() + 86400000).toISOString(),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }
      );
      const result = await ctx.module.exports.redeem({ customerId: 'c1', points: 60, amount: 1000, ref: 'REDEEM-1', refType: 'manual' });
      expect(result.error).toBeUndefined();
      expect(result.balance).toBe(40);
    });

    test('redemption cannot exceed available non-expired balance', async () => {
      const { ctx, customers, transactions } = createSandbox();
      customers.push({ id: 'c1', name: 'Alice', points: 0 });
      transactions.push(
        {
          id: 'LP-expired',
          customerId: 'c1',
          tenantId: 'tenant-a',
          type: 'earn',
          points: 100,
          balanceAfter: 100,
          ref: 'INV-EXPIRED',
          refType: 'sale',
          expiresAt: new Date(Date.now() - 86400000).toISOString(),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }
      );
      const result = await ctx.module.exports.redeem({ customerId: 'c1', points: 50, amount: 1000, ref: 'REDEEM-1', refType: 'manual' });
      expect(result.error).toBe('Insufficient points');
    });
  });

  describe('Tier-Specific Rules', () => {
    test('earn multiplier is applied based on customer tier', async () => {
      const { ctx, customers } = createSandbox();
      customers.push({ id: 'c1', name: 'Alice', points: 600 });
      const result = await ctx.module.exports.earn({ customerId: 'c1', points: 100, amount: 10000, ref: 'INV-1', refType: 'sale' });
      expect(result.error).toBeUndefined();
      expect(result.appliedMultiplier).toBe(1.2);
      expect(result.earnedPoints).toBe(120);
    });

    test('default tier gets multiplier 1', async () => {
      const { ctx, customers } = createSandbox();
      customers.push({ id: 'c1', name: 'Alice', points: 0 });
      const result = await ctx.module.exports.earn({ customerId: 'c1', points: 100, amount: 10000, ref: 'INV-1', refType: 'sale' });
      expect(result.error).toBeUndefined();
      expect(result.appliedMultiplier).toBe(1);
      expect(result.earnedPoints).toBe(100);
    });

    test('tier-specific expiry days are applied', async () => {
      const { ctx } = createSandbox();
      const bronzeDays = ctx.module.exports._expiryDaysForTier('bronze');
      const goldDays = ctx.module.exports._expiryDaysForTier('gold');
      const platinumDays = ctx.module.exports._expiryDaysForTier('platinum');
      expect(bronzeDays).toBe(365);
      expect(goldDays).toBe(540);
      expect(platinumDays).toBe(730);
    });
  });

  describe('Configuration Validation', () => {
    test('accepts expiryEnabled in config', async () => {
      const { ctx, configs } = createSandbox();
      const result = await ctx.module.exports.updateConfig({ expiryEnabled: true, defaultExpiryDays: 180 });
      expect(result.error).toBeUndefined();
      expect(result.config.expiryEnabled).toBe(true);
      expect(result.config.defaultExpiryDays).toBe(180);
    });

    test('rejects negative defaultExpiryDays', async () => {
      const { ctx } = createSandbox();
      const result = await ctx.module.exports.updateConfig({ defaultExpiryDays: -10 });
      expect(result.error).toContain('defaultExpiryDays must be a number >= 1');
    });

    test('accepts tierExpiryOverrides in config', async () => {
      const { ctx, configs } = createSandbox();
      const result = await ctx.module.exports.updateConfig({
        tierExpiryOverrides: { gold: 365, platinum: 365 }
      });
      expect(result.error).toBeUndefined();
      expect(result.config.tierExpiryOverrides.gold).toBe(365);
    });
  });

  describe('Tenant Isolation', () => {
    test('tenant A cannot see tenant B expiry data', async () => {
      const { ctx, customers, transactions } = createSandbox();
      customers.push({ id: 'c1', name: 'Alice', points: 0 });
      transactions.push(
        {
          id: 'LP-tenant-b',
          customerId: 'c1',
          tenantId: 'tenant-b',
          type: 'earn',
          points: 100,
          balanceAfter: 100,
          ref: 'INV-1',
          refType: 'sale',
          expiresAt: new Date(Date.now() - 86400000).toISOString(),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }
      );
      const result = await ctx.module.exports.getBalance('c1');
      expect(result.points).toBe(0);
      expect(result.expiredPoints).toBe(0);
    });
  });

  describe('Backward Compatibility', () => {
    test('existing transactions without expiresAt remain valid', async () => {
      const { ctx, customers, transactions } = createSandbox();
      customers.push({ id: 'c1', name: 'Alice', points: 0 });
      transactions.push(
        {
          id: 'LP-legacy',
          customerId: 'c1',
          tenantId: 'tenant-a',
          type: 'earn',
          points: 100,
          balanceAfter: 100,
          ref: 'INV-LEGACY',
          refType: 'sale',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }
      );
      const result = await ctx.module.exports.redeem({ customerId: 'c1', points: 50, amount: 1000, ref: 'REDEEM-1', refType: 'manual' });
      expect(result.error).toBeUndefined();
      expect(result.balance).toBe(50);
    });

    test('existing balance is not mutated when expiry is enabled', async () => {
      const { ctx, customers, transactions } = createSandbox();
      customers.push({ id: 'c1', name: 'Alice', points: 0 });
      transactions.push(
        {
          id: 'LP-legacy',
          customerId: 'c1',
          tenantId: 'tenant-a',
          type: 'earn',
          points: 100,
          balanceAfter: 100,
          ref: 'INV-LEGACY',
          refType: 'sale',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }
      );
      const result = await ctx.module.exports.getBalance('c1');
      expect(result.points).toBe(100);
      expect(result.totalEarned).toBe(100);
    });
  });
});
