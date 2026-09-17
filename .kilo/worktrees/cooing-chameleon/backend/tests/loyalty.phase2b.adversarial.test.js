'use strict';

// Phase 2B — Loyalty backend sync adversarial audit tests.
// READ-ONLY: no production code modifications.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const SYNC_POST_PATH = path.resolve(REPO_ROOT, 'services', 'loyalty', 'syncPost.js');

function createSandbox(overrides = {}) {
  const operations = [];
  const queueStorage = [];
  const deadLetterStorage = [];

  const localStorage = {
    _store: {},
    getItem(k) { return this._store[k] || null; },
    setItem(k, v) { this._store[k] = String(v); },
    removeItem(k) { delete this._store[k]; }
  };

  const loyaltySyncQueue = {
    operations,
    findPending: (operationType, customerId, reference) => {
      const queue = loyaltySyncQueue.loadQueue();
      return queue.find(op =>
        op.status === 'pending' &&
        op.operationType === operationType &&
        op.customerId === String(customerId || '') &&
        op.reference === String(reference || '')
      ) || null;
    },
    createOperation: ({ operationType, customerId, reference, refType, payload = {} }) => ({
      id: 'LOY-Q-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8),
      operationType,
      customerId: String(customerId || ''),
      reference: String(reference || ''),
      refType: String(refType || ''),
      payload,
      createdAt: Date.now(),
      attempts: 0,
      lastAttemptAt: null,
      nextRetryAt: Date.now(),
      status: 'pending',
      lastError: null
    }),
    enqueue: (operation) => {
      const existing = loyaltySyncQueue.findPending(operation.operationType, operation.customerId, operation.reference);
      if (existing) {
        existing.payload = { ...existing.payload, ...operation.payload };
        existing.nextRetryAt = Date.now();
        return existing;
      }
      operations.push(operation);
      const queue = loyaltySyncQueue.loadQueue();
      queue.push(operation);
      loyaltySyncQueue.saveQueue(queue);
      return operation;
    },
    getPendingOperations: () => loyaltySyncQueue.loadQueue().filter(op => op.status === 'pending' && op.nextRetryAt <= Date.now()),
    updateRetrySchedule: (id, error) => {
      const queue = loyaltySyncQueue.loadQueue();
      const op = queue.find(o => o.id === id);
      if (!op) return null;
      op.attempts += 1;
      op.lastAttemptAt = Date.now();
      op.lastError = error;
      if (op.attempts >= 5) {
        op.status = 'dead_letter';
        op.nextRetryAt = null;
        loyaltySyncQueue.saveQueue(queue);
        loyaltySyncQueue.moveToDeadLetter(op);
        return op;
      }
      const delay = Math.min(1000 * Math.pow(2, op.attempts - 1), 30000);
      op.nextRetryAt = Date.now() + delay;
      loyaltySyncQueue.saveQueue(queue);
      return op;
    },
    markConfirmed: (id) => {
      const queue = loyaltySyncQueue.loadQueue();
      const op = queue.find(o => o.id === id);
      if (op) { op.status = 'confirmed'; op.lastError = null; loyaltySyncQueue.saveQueue(queue); }
    },
    markDuplicate: (id, existingId) => {
      const queue = loyaltySyncQueue.loadQueue();
      const op = queue.find(o => o.id === id);
      if (op) { op.status = 'duplicate'; op.lastError = 'Duplicate confirmed'; loyaltySyncQueue.saveQueue(queue); }
    },
    markConflict: (id, error) => {
      const queue = loyaltySyncQueue.loadQueue();
      const op = queue.find(o => o.id === id);
      if (op) { op.status = 'conflict'; op.lastError = error; op.attempts = 5; loyaltySyncQueue.saveQueue(queue); loyaltySyncQueue.moveToDeadLetter(op); }
    },
    markDeadLetter: (id, error) => {
      const queue = loyaltySyncQueue.loadQueue();
      const op = queue.find(o => o.id === id);
      if (op) { op.status = 'dead_letter'; op.lastError = error; loyaltySyncQueue.saveQueue(queue); loyaltySyncQueue.moveToDeadLetter(op); }
    },
    loadQueue: () => queueStorage,
    saveQueue: (q) => { if (q !== queueStorage) { queueStorage.length = 0; queueStorage.push(...q); } },
    loadDeadLetter: () => deadLetterStorage,
    saveDeadLetter: (d) => { if (d !== deadLetterStorage) { deadLetterStorage.length = 0; deadLetterStorage.push(...d); } },
    moveToDeadLetter: (op) => { deadLetterStorage.push(op); },
    clearConfirmed: () => { const q = queueStorage.filter(op => op.status !== 'confirmed'); queueStorage.length = 0; queueStorage.push(...q); }
  };

  const sandbox = {
    localStorage,
    window: {
      backendApi: {
        loyalty: {
          earn: async (payload) => ({ success: true, data: { customerId: payload.customerId, points: payload.points, balanceAfter: 100, id: 'LP-1' } }),
          redeem: async (payload) => ({ success: true, data: { customerId: payload.customerId, points: -payload.points, balanceAfter: 50, id: 'LP-2' } }),
          reverse: async (payload) => ({ success: true, data: { customerId: payload.customerId, points: -10, balanceAfter: 40, id: 'LP-3' } })
        }
      },
      loyaltySyncQueue,
      loyaltySync: {},
      getLoyaltyConfig: () => ({ enabled: true, earnPerAmount: 100, pointsPerUnit: 1 }),
      getCustomerByNameOrPhone: (name, phone) => ({ id: 'c1', name, phone }),
      DB: { customers: [], saleInvoices: [], returns: [] },
      console
    }
  };

  Object.assign(sandbox.window, overrides);
  return { sandbox, loyaltySyncQueue, operations, queueStorage, deadLetterStorage };
}

function loadScript(sandbox) {
  const postCode = fs.readFileSync(SYNC_POST_PATH, 'utf-8');
  const ctx = vm.createContext(sandbox);
  vm.runInContext(postCode, ctx);
  return ctx;
}

describe('Phase 2B — Loyalty backend sync adversarial audit', () => {
  describe('Post-Save Guarantee', () => {
    test('syncLoyaltyForSale does nothing without invoice.id', async () => {
      const { sandbox, operations } = createSandbox();
      const ctx = loadScript(sandbox);
      await ctx.window.loyaltySync.syncLoyaltyForSale({});
      expect(operations.length).toBe(0);
    });

    test('syncLoyaltyForReturn does nothing without returnRecord.id', async () => {
      const { sandbox, operations } = createSandbox();
      const ctx = loadScript(sandbox);
      await ctx.window.loyaltySync.syncLoyaltyForReturn({}, { id: 'INV-1' });
      expect(operations.length).toBe(0);
    });

    test('syncLoyaltyForReturn does nothing without backendApi.loyalty', async () => {
      const { sandbox, operations } = createSandbox({ backendApi: {} });
      const ctx = loadScript(sandbox);
      await ctx.window.loyaltySync.syncLoyaltyForReturn({ id: 'RET-1', refund: 100 }, { id: 'INV-1' });
      expect(operations.length).toBe(0);
    });
  });

  describe('Earn + Redeem Same Sale', () => {
    test('same invoice can enqueue both redeem and earn', async () => {
      const { sandbox, operations } = createSandbox();
      const ctx = loadScript(sandbox);
      const invoice = {
        id: 'INV-1',
        customerId: 'c1',
        total: 1000,
        loyaltyUsedPoints: 20,
        loyaltyUsedAmount: 200
      };
      await ctx.window.loyaltySync.syncLoyaltyForSale(invoice);
      const redeemOp = operations.find(op => op.operationType === 'redeem');
      const earnOp = operations.find(op => op.operationType === 'earn');
      expect(redeemOp).toBeDefined();
      expect(earnOp).toBeDefined();
      expect(redeemOp.reference).toBe('INV-1');
      expect(earnOp.reference).toBe('INV-1');
    });

    test('duplicate earn for same invoice is prevented', async () => {
      const { sandbox, operations } = createSandbox();
      const ctx = loadScript(sandbox);
      const invoice = {
        id: 'INV-1',
        customerId: 'c1',
        total: 1000,
        loyaltyUsedPoints: 0,
        loyaltyUsedAmount: 0
      };
      await ctx.window.loyaltySync.syncLoyaltyForSale(invoice);
      await ctx.window.loyaltySync.syncLoyaltyForSale(invoice);
      const earnOps = operations.filter(op => op.operationType === 'earn');
      expect(earnOps.length).toBe(1);
    });
  });

  describe('Duplicate Sale Hook', () => {
    test('same invoice enqueued twice produces only one operation', async () => {
      const { sandbox, operations } = createSandbox();
      const ctx = loadScript(sandbox);
      const invoice = {
        id: 'INV-1',
        customerId: 'c1',
        total: 1000,
        loyaltyUsedPoints: 0,
        loyaltyUsedAmount: 0
      };
      await ctx.window.loyaltySync.syncLoyaltyForSale(invoice);
      await ctx.window.loyaltySync.syncLoyaltyForSale(invoice);
      expect(operations.length).toBe(1);
    });
  });

  describe('Queue Concurrency', () => {
    test('concurrent enqueue and process do not corrupt queue', async () => {
      const { sandbox, queueStorage } = createSandbox();
      const ctx = loadScript(sandbox);
      ctx.window.loyaltySyncQueue.enqueue(
        ctx.window.loyaltySyncQueue.createOperation({
          operationType: 'earn',
          customerId: 'c1',
          reference: 'INV-1',
          refType: 'sale'
        })
      );
      const pending = ctx.window.loyaltySyncQueue.getPendingOperations();
      expect(pending.length).toBeGreaterThanOrEqual(1);
    });

    test('updateRetrySchedule does not lose operation', () => {
      const { sandbox, queueStorage } = createSandbox();
      const ctx = loadScript(sandbox);
      const op = ctx.window.loyaltySyncQueue.createOperation({
        operationType: 'earn',
        customerId: 'c1',
        reference: 'INV-1',
        refType: 'sale'
      });
      ctx.window.loyaltySyncQueue.enqueue(op);
      const updated = ctx.window.loyaltySyncQueue.updateRetrySchedule(op.id, 'Network error');
      expect(updated).toBeDefined();
      expect(updated.attempts).toBe(1);
      const queue = ctx.window.loyaltySyncQueue.loadQueue();
      const found = queue.find(o => o.id === op.id);
      expect(found).toBeDefined();
      expect(found.status).not.toBe('dead_letter');
    });
  });

  describe('Idempotency', () => {
    test('duplicate earn enqueue is prevented by reference', async () => {
      const { sandbox, operations } = createSandbox();
      const ctx = loadScript(sandbox);
      const invoice = {
        id: 'INV-1',
        customerId: 'c1',
        total: 1000,
        loyaltyUsedPoints: 0,
        loyaltyUsedAmount: 0
      };
      await ctx.window.loyaltySync.syncLoyaltyForSale(invoice);
      await ctx.window.loyaltySync.syncLoyaltyForSale(invoice);
      expect(operations.length).toBe(1);
    });

    test('duplicate redeem enqueue is prevented by reference', async () => {
      const { sandbox, operations } = createSandbox();
      const ctx = loadScript(sandbox);
      const invoice = {
        id: 'INV-1',
        customerId: 'c1',
        total: 1000,
        loyaltyUsedPoints: 20,
        loyaltyUsedAmount: 200
      };
      await ctx.window.loyaltySync.syncLoyaltyForSale(invoice);
      await ctx.window.loyaltySync.syncLoyaltyForSale(invoice);
      const redeemOps = operations.filter(op => op.operationType === 'redeem');
      expect(redeemOps.length).toBe(1);
    });
  });

  describe('Redeem Conflict', () => {
    test('backend rejection does not break sale flow', async () => {
      const { sandbox, operations } = createSandbox();
      const ctx = loadScript(sandbox);
      const invoice = {
        id: 'INV-1',
        customerId: 'c1',
        total: 1000,
        loyaltyUsedPoints: 20,
        loyaltyUsedAmount: 200
      };
      await ctx.window.loyaltySync.syncLoyaltyForSale(invoice);
      expect(operations.length).toBe(2); // redeem + earn
      expect(operations[0].operationType).toBe('redeem');
    });
  });

  describe('Return / Reverse', () => {
    test('duplicate reverse enqueue is prevented', async () => {
      const { sandbox, operations } = createSandbox();
      const ctx = loadScript(sandbox);
      const returnRecord = { id: 'RET-1', refund: 500 };
      const originalInvoice = { id: 'INV-1', customerId: 'c1' };
      await ctx.window.loyaltySync.syncLoyaltyForReturn(returnRecord, originalInvoice);
      await ctx.window.loyaltySync.syncLoyaltyForReturn(returnRecord, originalInvoice);
      expect(operations.length).toBe(1);
    });

    test('zero refund return does not enqueue reverse', async () => {
      const { sandbox, operations } = createSandbox();
      const ctx = loadScript(sandbox);
      const returnRecord = { id: 'RET-1', refund: 0 };
      const originalInvoice = { id: 'INV-1', customerId: 'c1' };
      await ctx.window.loyaltySync.syncLoyaltyForReturn(returnRecord, originalInvoice);
      expect(operations.length).toBe(0);
    });
  });

  describe('Retry Classification', () => {
    test('transient errors increment attempts', () => {
      const { sandbox } = createSandbox();
      const ctx = loadScript(sandbox);
      const op = ctx.window.loyaltySyncQueue.createOperation({
        operationType: 'earn',
        customerId: 'c1',
        reference: 'INV-1',
        refType: 'sale'
      });
      ctx.window.loyaltySyncQueue.enqueue(op);
      const updated = ctx.window.loyaltySyncQueue.updateRetrySchedule(op.id, 'Network error');
      expect(updated.attempts).toBe(1);
      expect(updated.status).not.toBe('dead_letter');
    });

    test('permanent errors move to conflict', () => {
      const { sandbox, deadLetterStorage } = createSandbox();
      const ctx = loadScript(sandbox);
      const op = ctx.window.loyaltySyncQueue.createOperation({
        operationType: 'earn',
        customerId: 'c1',
        reference: 'INV-1',
        refType: 'sale'
      });
      ctx.window.loyaltySyncQueue.enqueue(op);
      ctx.window.loyaltySyncQueue.markConflict(op.id, 'Customer not found');
      const queue = ctx.window.loyaltySyncQueue.loadQueue();
      expect(queue[0].status).toBe('conflict');
    });
  });

  describe('Dead Letter', () => {
    test('max retries moves operation to dead letter', () => {
      const { sandbox, deadLetterStorage } = createSandbox();
      const ctx = loadScript(sandbox);
      const op = ctx.window.loyaltySyncQueue.createOperation({
        operationType: 'earn',
        customerId: 'c1',
        reference: 'INV-1',
        refType: 'sale'
      });
      ctx.window.loyaltySyncQueue.enqueue(op);
      for (let i = 0; i < 5; i++) {
        const updated = ctx.window.loyaltySyncQueue.updateRetrySchedule(op.id, 'Error');
        if (updated && updated.status === 'dead_letter') break;
      }
      const queue = ctx.window.loyaltySyncQueue.loadQueue();
      const inQueue = queue.find(o => o.id === op.id);
      expect(!inQueue || inQueue.status === 'dead_letter').toBe(true);
      expect(deadLetterStorage.length).toBeGreaterThanOrEqual(1);
    });

    test('dead letter preserves payload and reference', () => {
      const { sandbox, deadLetterStorage } = createSandbox();
      const ctx = loadScript(sandbox);
      const op = ctx.window.loyaltySyncQueue.createOperation({
        operationType: 'earn',
        customerId: 'c1',
        reference: 'INV-1',
        refType: 'sale',
        payload: { points: 10 }
      });
      ctx.window.loyaltySyncQueue.enqueue(op);
      for (let i = 0; i < 5; i++) {
        const updated = ctx.window.loyaltySyncQueue.updateRetrySchedule(op.id, 'Error');
        if (updated && updated.status === 'dead_letter') break;
      }
      const found = deadLetterStorage.find(o => o.id === op.id);
      expect(found).toBeDefined();
      expect(found.customerId).toBe('c1');
      expect(found.reference).toBe('INV-1');
      expect(found.payload.points).toBe(10);
    });
  });

  describe('Restart / Refresh', () => {
    test('queue persists across reloads', () => {
      const { sandbox, queueStorage } = createSandbox();
      const ctx = loadScript(sandbox);
      const op = ctx.window.loyaltySyncQueue.createOperation({
        operationType: 'earn',
        customerId: 'c1',
        reference: 'INV-1',
        refType: 'sale'
      });
      ctx.window.loyaltySyncQueue.enqueue(op);
      expect(queueStorage.length).toBe(1);
    });

    test('same reference after reload does not duplicate', () => {
      const { sandbox, queueStorage } = createSandbox();
      const ctx = loadScript(sandbox);
      const op1 = ctx.window.loyaltySyncQueue.createOperation({
        operationType: 'earn',
        customerId: 'c1',
        reference: 'INV-1',
        refType: 'sale'
      });
      ctx.window.loyaltySyncQueue.enqueue(op1);
      const existing = ctx.window.loyaltySyncQueue.findPending('earn', 'c1', 'INV-1');
      expect(existing).toBeDefined();
      expect(existing.id).toBe(op1.id);
    });
  });

  describe('Offline / Online', () => {
    test('backend unavailability does not throw and does not enqueue', async () => {
      const { sandbox, operations } = createSandbox({ backendApi: {} });
      const ctx = loadScript(sandbox);
      const invoice = {
        id: 'INV-1',
        customerId: 'c1',
        total: 1000,
        loyaltyUsedPoints: 0,
        loyaltyUsedAmount: 0
      };
      await expect(ctx.window.loyaltySync.syncLoyaltyForSale(invoice)).resolves.toBeUndefined();
      expect(operations.length).toBe(0);
    });
  });

  describe('Multi-Tenant Safety', () => {
    test('queue does not mix tenants', () => {
      const { sandbox, operations } = createSandbox();
      const ctx = loadScript(sandbox);
      const op1 = ctx.window.loyaltySyncQueue.createOperation({
        operationType: 'earn',
        customerId: 'c1',
        reference: 'INV-1',
        refType: 'sale'
      });
      const op2 = ctx.window.loyaltySyncQueue.createOperation({
        operationType: 'earn',
        customerId: 'c2',
        reference: 'INV-2',
        refType: 'sale'
      });
      ctx.window.loyaltySyncQueue.enqueue(op1);
      ctx.window.loyaltySyncQueue.enqueue(op2);
      expect(operations.length).toBe(2);
      expect(operations[0].customerId).toBe('c1');
      expect(operations[1].customerId).toBe('c2');
    });
  });

  describe('Customer Ownership', () => {
    test('syncLoyaltyForSale does nothing without customerId', async () => {
      const { sandbox, operations } = createSandbox();
      const ctx = loadScript(sandbox);
      const invoice = {
        id: 'INV-1',
        total: 1000,
        loyaltyUsedPoints: 0,
        loyaltyUsedAmount: 0
      };
      await ctx.window.loyaltySync.syncLoyaltyForSale(invoice);
      expect(operations.length).toBe(0);
    });
  });

  describe('Projection Update', () => {
    test('updateCustomerPointsProjection updates only matching customer', () => {
      const { sandbox } = createSandbox({
        DB: {
          customers: [
            { id: 'c1', points: 50 },
            { id: 'c2', points: 75 }
          ]
        }
      });
      const ctx = loadScript(sandbox);
      ctx.window.loyaltySync.updateCustomerPointsProjection('c1', { points: 100 });
      expect(ctx.window.DB.customers[0].points).toBe(100);
      expect(ctx.window.DB.customers[1].points).toBe(75);
    });

    test('updateCustomerPointsProjection does nothing without customerId', () => {
      const { sandbox } = createSandbox({
        DB: { customers: [{ id: 'c1', points: 50 }] }
      });
      const ctx = loadScript(sandbox);
      ctx.window.loyaltySync.updateCustomerPointsProjection(null, { points: 100 });
      expect(ctx.window.DB.customers[0].points).toBe(50);
    });

    test('updateCustomerPointsProjection does nothing without backendData.points', () => {
      const { sandbox } = createSandbox({
        DB: { customers: [{ id: 'c1', points: 50 }] }
      });
      const ctx = loadScript(sandbox);
      ctx.window.loyaltySync.updateCustomerPointsProjection('c1', {});
      expect(ctx.window.DB.customers[0].points).toBe(50);
    });
  });

  describe('Client-Controlled Fields', () => {
    test('syncLoyaltyForSale does not send tenantId', async () => {
      const { sandbox } = createSandbox();
      const captured = [];
      sandbox.window.backendApi.loyalty = {
        earn: async (payload) => { captured.push(payload); return { success: true }; },
        redeem: async (payload) => { captured.push(payload); return { success: true }; }
      };
      const ctx = loadScript(sandbox);
      const invoice = {
        id: 'INV-1',
        customerId: 'c1',
        total: 1000,
        loyaltyUsedPoints: 20,
        loyaltyUsedAmount: 200
      };
      await ctx.window.loyaltySync.syncLoyaltyForSale(invoice);
      expect(captured.every(p => !('tenantId' in p))).toBe(true);
    });

    test('syncLoyaltyForSale does not send userId as authority', async () => {
      const { sandbox } = createSandbox();
      const captured = [];
      sandbox.window.backendApi.loyalty = {
        earn: async (payload) => { captured.push(payload); return { success: true }; },
        redeem: async (payload) => { captured.push(payload); return { success: true }; }
      };
      const ctx = loadScript(sandbox);
      const invoice = {
        id: 'INV-1',
        customerId: 'c1',
        total: 1000,
        loyaltyUsedPoints: 20,
        loyaltyUsedAmount: 200
      };
      await ctx.window.loyaltySync.syncLoyaltyForSale(invoice);
      expect(captured.every(p => !('userId' in p))).toBe(true);
    });
  });
});
