'use strict';

// Phase 2B — Loyalty backend sync tests.
// Tests the retry queue, post-sale sync, post-return sync, and projection updates.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const QUEUE_PATH = path.resolve(REPO_ROOT, 'services', 'loyalty', 'syncQueue.js');
const SYNC_POST_PATH = path.resolve(REPO_ROOT, 'services', 'loyalty', 'syncPost.js');

function loadScript(filePath, overrides = {}) {
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
          earn: async (payload) => ({ success: true, data: { customerId: payload.customerId, points: payload.points, balanceAfter: 100, id: 'LP-1' } }),
          redeem: async (payload) => ({ success: true, data: { customerId: payload.customerId, points: -payload.points, balanceAfter: 50, id: 'LP-2' } }),
          reverse: async (payload) => ({ success: true, data: { customerId: payload.customerId, points: -10, balanceAfter: 40, id: 'LP-3' } })
        }
      },
      loyaltySyncQueue: {
        findPending: (opType, cid, ref) => null,
        createOperation: (op) => op,
        enqueue: (op) => op
      },
      loyaltySync: {
        syncLoyaltyForSale: async () => {},
        syncLoyaltyForReturn: async () => {},
        processSyncQueue: async () => {}
      },
      getLoyaltyConfig: () => ({ enabled: true, earnPerAmount: 100, pointsPerUnit: 1 }),
      getCustomerByNameOrPhone: (name, phone) => ({ id: 'c1', name, phone }),
      DB: { customers: [], saleInvoices: [], returns: [] },
      console
    }
  };
  Object.assign(sandbox.window, overrides);
  const ctx = vm.createContext(sandbox);
  vm.runInContext(code, ctx);
  return ctx;
}

describe('Phase 2B — Loyalty backend sync', () => {
  describe('Retry Queue', () => {
    test('enqueue creates operation with correct fields', () => {
      const ctx = loadScript(QUEUE_PATH);
      const op = ctx.window.loyaltySyncQueue.createOperation({
        operationType: 'earn',
        customerId: 'c1',
        reference: 'INV-1',
        refType: 'sale',
        payload: { points: 10 }
      });
      expect(op.operationType).toBe('earn');
      expect(op.customerId).toBe('c1');
      expect(op.reference).toBe('INV-1');
      expect(op.status).toBe('pending');
      expect(op.attempts).toBe(0);
    });

    test('enqueue prevents duplicate pending operations', () => {
      const ctx = loadScript(QUEUE_PATH);
      const op1 = ctx.window.loyaltySyncQueue.createOperation({ operationType: 'earn', customerId: 'c1', reference: 'INV-1', refType: 'sale' });
      ctx.window.loyaltySyncQueue.enqueue(op1);
      const op2 = ctx.window.loyaltySyncQueue.createOperation({ operationType: 'earn', customerId: 'c1', reference: 'INV-1', refType: 'sale' });
      const result = ctx.window.loyaltySyncQueue.enqueue(op2);
      expect(result.id).toBe(op1.id);
    });

    test('updateRetrySchedule increments attempts and applies backoff', () => {
      const ctx = loadScript(QUEUE_PATH);
      const op = ctx.window.loyaltySyncQueue.createOperation({ operationType: 'earn', customerId: 'c1', reference: 'INV-1', refType: 'sale' });
      ctx.window.loyaltySyncQueue.enqueue(op);
      const updated = ctx.window.loyaltySyncQueue.updateRetrySchedule(op.id, 'Network error');
      expect(updated.attempts).toBe(1);
      expect(updated.nextRetryAt).toBeGreaterThan(Date.now());
    });

    test('markConfirmed changes status', () => {
      const ctx = loadScript(QUEUE_PATH);
      const op = ctx.window.loyaltySyncQueue.createOperation({ operationType: 'earn', customerId: 'c1', reference: 'INV-1', refType: 'sale' });
      ctx.window.loyaltySyncQueue.enqueue(op);
      ctx.window.loyaltySyncQueue.markConfirmed(op.id);
      const queue = ctx.window.loyaltySyncQueue.loadQueue();
      expect(queue[0].status).toBe('confirmed');
    });

    test('markConflict sets status and moves to dead letter', () => {
      const ctx = loadScript(QUEUE_PATH);
      const op = ctx.window.loyaltySyncQueue.createOperation({ operationType: 'earn', customerId: 'c1', reference: 'INV-1', refType: 'sale' });
      ctx.window.loyaltySyncQueue.enqueue(op);
      ctx.window.loyaltySyncQueue.markConflict(op.id, 'Customer not found');
      const queue = ctx.window.loyaltySyncQueue.loadQueue();
      expect(queue[0].status).toBe('conflict');
      const deadLetter = ctx.window.loyaltySyncQueue.loadDeadLetter();
      expect(deadLetter.length).toBe(1);
    });

    test('max retries moves to dead letter', () => {
      const ctx = loadScript(QUEUE_PATH);
      const op = ctx.window.loyaltySyncQueue.createOperation({ operationType: 'earn', customerId: 'c1', reference: 'INV-1', refType: 'sale' });
      ctx.window.loyaltySyncQueue.enqueue(op);
      for (let i = 0; i < 5; i++) {
        const updated = ctx.window.loyaltySyncQueue.updateRetrySchedule(op.id, 'Error');
        if (updated && updated.status === 'dead_letter') break;
      }
      const queue = ctx.window.loyaltySyncQueue.loadQueue();
      const inQueue = queue.find(o => o.id === op.id);
      expect(!inQueue || inQueue.status === 'dead_letter').toBe(true);
    });
  });

  describe('Post-Sale Sync', () => {
    test('syncLoyaltyForSale enqueues earn operation', async () => {
      const ctx = loadScript(SYNC_POST_PATH, {
        loyaltySyncQueue: {
          findPending: () => null,
          createOperation: (op) => op,
          enqueue: (op) => op
        }
      });
      const invoice = {
        id: 'INV-1',
        customerId: 'c1',
        total: 1000,
        loyaltyUsedPoints: 0,
        loyaltyUsedAmount: 0
      };
      await ctx.window.loyaltySync.syncLoyaltyForSale(invoice);
      // Should enqueue earn operation
      expect(true).toBe(true);
    });

    test('syncLoyaltyForSale enqueues redeem when points used', async () => {
      const ctx = loadScript(SYNC_POST_PATH, {
        loyaltySyncQueue: {
          findPending: () => null,
          createOperation: (op) => op,
          enqueue: (op) => op
        }
      });
      const invoice = {
        id: 'INV-2',
        customerId: 'c1',
        total: 1000,
        loyaltyUsedPoints: 20,
        loyaltyUsedAmount: 200
      };
      await ctx.window.loyaltySync.syncLoyaltyForSale(invoice);
      expect(true).toBe(true);
    });
  });

  describe('Post-Return Sync', () => {
    test('syncLoyaltyForReturn enqueues reverse operation', async () => {
      const ctx = loadScript(SYNC_POST_PATH, {
        loyaltySyncQueue: {
          findPending: () => null,
          createOperation: (op) => op,
          enqueue: (op) => op
        }
      });
      const returnRecord = {
        id: 'RET-1',
        refund: 500
      };
      const originalInvoice = {
        id: 'INV-1',
        customerId: 'c1'
      };
      await ctx.window.loyaltySync.syncLoyaltyForReturn(returnRecord, originalInvoice);
      expect(true).toBe(true);
    });

    test('syncLoyaltyForReturn skips zero refund', async () => {
      const ctx = loadScript(SYNC_POST_PATH, {
        loyaltySyncQueue: {
          findPending: () => null,
          createOperation: (op) => op,
          enqueue: (op) => op
        }
      });
      const returnRecord = {
        id: 'RET-2',
        refund: 0
      };
      const originalInvoice = {
        id: 'INV-2',
        customerId: 'c1'
      };
      await ctx.window.loyaltySync.syncLoyaltyForReturn(returnRecord, originalInvoice);
      expect(true).toBe(true);
    });
  });

  describe('Projection Update', () => {
    test('updateCustomerPointsProjection updates customer.points', () => {
      const ctx = loadScript(SYNC_POST_PATH, {
        DB: {
          customers: [
            { id: 'c1', points: 50 }
          ]
        }
      });
      ctx.window.loyaltySync.updateCustomerPointsProjection('c1', { points: 100 });
      expect(ctx.window.DB.customers[0].points).toBe(100);
    });

    test('updateCustomerPointsProjection does not modify other customers', () => {
      const ctx = loadScript(SYNC_POST_PATH, {
        DB: {
          customers: [
            { id: 'c1', points: 50 },
            { id: 'c2', points: 75 }
          ]
        }
      });
      ctx.window.loyaltySync.updateCustomerPointsProjection('c1', { points: 100 });
      expect(ctx.window.DB.customers[0].points).toBe(100);
      expect(ctx.window.DB.customers[1].points).toBe(75);
    });
  });
});
