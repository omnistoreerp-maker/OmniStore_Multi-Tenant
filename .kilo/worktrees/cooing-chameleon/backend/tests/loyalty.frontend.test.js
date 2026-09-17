'use strict';

// Phase 2A — Loyalty frontend sync foundation tests.
// Validates the new frontend loyalty utilities without touching POS or backend.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const SYNC_PATH = path.resolve(REPO_ROOT, 'services', 'loyalty', 'sync.js');
const RECONCILER_PATH = path.resolve(REPO_ROOT, 'services', 'loyalty', 'reconciler.js');
const MIGRATION_PATH = path.resolve(REPO_ROOT, 'services', 'loyalty', 'migration.js');

function loadScript(filePath) {
  const code = fs.readFileSync(filePath, 'utf-8');
  const sandbox = {
    localStorage: {
      _store: {},
      getItem(k) { return this._store[k] || null; },
      setItem(k, v) { this._store[k] = String(v); },
      removeItem(k) { delete this._store[k]; }
    },
    window: {
      backendApi: {
        loyalty: {
          getBalance: async (cid) => ({ success: true, data: { customerId: cid, points: 100, transactionCount: 2 } }),
          getTransactions: async (cid, q) => ({ success: true, data: { transactions: [{ id: 't1', points: 100, type: 'earn' }], total: 1, page: 1, limit: 50, totalPages: 1 } }),
          getConfig: async () => ({ success: true, data: { enabled: true, earnPerAmount: 100, pointsPerUnit: 1, redeemValue: 1, maxRedeemPercent: 20 } })
        }
      }
    },
    DB: { customers: [], loyaltyTransactions: [] },
    console
  };
  const ctx = vm.createContext(sandbox);
  vm.runInContext(code, ctx);
  return ctx;
}

describe('Phase 2A — Loyalty frontend sync foundation', () => {
  test('sync.js loads without error', () => {
    const ctx = loadScript(SYNC_PATH);
    expect(ctx.window.loyaltySync).toBeDefined();
    expect(typeof ctx.window.loyaltySync.syncCustomer).toBe('function');
  });

  test('reconciler.js loads without error', () => {
    const ctx = loadScript(RECONCILER_PATH);
    expect(ctx.window.loyaltyReconciler).toBeDefined();
    expect(typeof ctx.window.loyaltyReconciler.reconcile).toBe('function');
  });

  test('migration.js loads without error', () => {
    const ctx = loadScript(MIGRATION_PATH);
    expect(ctx.window.loyaltyMigration).toBeDefined();
    expect(typeof ctx.window.loyaltyMigration.buildMigrationReport).toBe('function');
  });

  test('reconciler reports MATCH when local and remote agree', () => {
    const ctx = loadScript(RECONCILER_PATH);
    ctx.DB.customers = [{ id: 'c1', points: 100 }];
    ctx.DB.loyaltyTransactions = [{ customerId: 'c1', points: 100, type: 'earn', ref: 'INV-1', refType: 'sale' }];
    const remoteState = { remotePoints: 100, remoteTransactions: [{ points: 100, type: 'earn', customerId: 'c1', ref: 'INV-1', refType: 'sale' }] };
    const report = ctx.window.loyaltyReconciler.reconcile('c1', remoteState);
    expect(report.balanceMatch).toBe('match');
    expect(report.txMatch).toBe('match');
    expect(report.summary.MATCH).toBe(true);
  });

  test('reconciler reports BALANCE_MISMATCH when points differ', () => {
    const ctx = loadScript(RECONCILER_PATH);
    ctx.DB.customers = [{ id: 'c1', points: 50 }];
    ctx.DB.loyaltyTransactions = [{ customerId: 'c1', points: 50, type: 'earn', ref: 'INV-1', refType: 'sale' }];
    const remoteState = { remotePoints: 100, remoteTransactions: [{ points: 100, type: 'earn', customerId: 'c1', ref: 'INV-1', refType: 'sale' }] };
    const report = ctx.window.loyaltyReconciler.reconcile('c1', remoteState);
    expect(report.balanceMatch).toBe('mismatch');
    expect(report.summary.BALANCE_MISMATCH).toBe(true);
  });

  test('migration report identifies valid and invalid transactions', () => {
    const ctx = loadScript(MIGRATION_PATH);
    ctx.DB.loyaltyTransactions = [
      { customerId: 'c1', points: 100, type: 'earn', ref: 'INV-1', refType: 'sale' },
      { customerId: 'c2', points: 50, type: 'redeem', ref: 'REDEEM-1', refType: 'manual' },
      { points: 25, type: 'unknown' }
    ];
    const report = ctx.window.loyaltyMigration.buildMigrationReport();
    expect(report.totalTransactions).toBe(3);
    expect(report.validTransactions).toBe(2);
    expect(report.invalidTransactions).toBe(1);
  });

  test('migration report detects balance mismatches', () => {
    const ctx = loadScript(MIGRATION_PATH);
    ctx.DB.customers = [{ id: 'c1', points: 50 }];
    ctx.DB.loyaltyTransactions = [{ customerId: 'c1', points: 100, type: 'earn', ref: 'INV-1', refType: 'sale' }];
    const report = ctx.window.loyaltyMigration.buildMigrationReport();
    expect(report.customersWithBalanceMismatch).toBe(1);
    expect(report.mismatches[0].customerId).toBe('c1');
  });

  test('sync returns unavailable on backend failure', async () => {
    const ctx = loadScript(SYNC_PATH);
    ctx.window.backendApi.loyalty.getBalance = async () => ({ success: false, message: 'Network error' });
    const result = await ctx.window.loyaltySync.syncCustomer('c1');
    expect(result.status).toBe('unavailable');
    expect(result.error).toMatch(/network error/i);
  });
});
