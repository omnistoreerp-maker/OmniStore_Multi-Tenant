'use strict';

// notificationEngine.bootstrap.test.js — wiring regression gate.
//
// The verified RC build called notificationEngine.bootstrapEventListeners()
// from server.js and carried 'subscription.expiring' in the canonical event
// registry. The main reconstruction dropped both: sale/low-stock/subscription
// notifications became silently dead even with tenant settings configured.
// These tests pin the restored wiring end-to-end:
//   - booting server.js subscribes the engine to the bus;
//   - a sale.created event reaches the Telegram client when the tenant has
//     alerts enabled, and stays quiet when disabled;
//   - subscription.expiring is a valid, publishable event type again.

const request = require('supertest');
const { startServer } = require('./helpers/testServer');
const { makeTempDataDir, seed, readStore } = require('./helpers/testData');
const { registerCleanup } = require('./helpers/cleanup');

let server;
let dataDir;

registerCleanup(() => [server], () => [dataDir]);

function seedSettings(dir, overrides) {
  seed(dir, 'tenantNotifications', {
    settings: [Object.assign({
      tenantId: 'digi',
      telegramAlertsEnabled: true,
      telegramBotToken: '123456:TEST-TOKEN',
      telegramChatId: '555000111',
      lowStockAlertsEnabled: true,
      subscriptionAlertsEnabled: true
    }, overrides || {})],
    lastUpdated: new Date().toISOString()
  });
}

beforeAll(async () => {
  process.env.AUTH_REQUIRED = 'true';
  dataDir = makeTempDataDir('notification-bootstrap');
  seed(dataDir, 'companies', { companies: [{ id: 'digi', code: 'DIGI', name: 'DigiTronics', active: true }] });
  seedSettings(dataDir);
  server = await startServer(dataDir, { AUTH_REQUIRED: 'true' });
});

describe('notification engine event wiring (restored RC behavior)', () => {
  test('booting the server subscribes the engine to the event bus', () => {
    const { eventBus } = require('../services/eventBus');
    expect(eventBus.listenerCount('sale.created')).toBeGreaterThanOrEqual(2); // webhook + engine
    expect(eventBus.listenerCount('inventory.low')).toBeGreaterThanOrEqual(2); // webhook + engine
    expect(eventBus.listenerCount('subscription.expiring')).toBeGreaterThanOrEqual(1); // engine
  });

  test('sale.created reaches the Telegram client for an opted-in tenant', async () => {
    const calls = [];
    const telegramClient = require('../services/telegramClient.service');
    const original = telegramClient.sendTelegramAlert;
    telegramClient.sendTelegramAlert = async (args) => { calls.push(args); return { ok: true }; };
    try {
      const { eventBus } = require('../services/eventBus');
      eventBus.publish('sale.created', {
        tenantId: 'digi',
        invoiceNumber: 'INV-WIRE-1',
        total: 250,
        currency: 'EGP',
        paymentType: 'cash'
      });
      await new Promise((resolve) => setImmediate(resolve));
      await new Promise((resolve) => setImmediate(resolve));
      expect(calls.length).toBe(1);
      expect(calls[0].chatId).toBe('555000111');
      // Message is MarkdownV2-escaped by the client (hyphens become \-).
      expect(calls[0].message).toContain('Invoice:');
      expect(calls[0].message).toContain('EGP 250');
      expect(calls[0].message).toContain('Payment: cash');
    } finally {
      telegramClient.sendTelegramAlert = original;
    }
  });

  test('no outbound Telegram call for a tenant without alerts enabled', async () => {
    const calls = [];
    const telegramClient = require('../services/telegramClient.service');
    const original = telegramClient.sendTelegramAlert;
    telegramClient.sendTelegramAlert = async (args) => { calls.push(args); return { ok: true }; };
    try {
      const { eventBus } = require('../services/eventBus');
      eventBus.publish('sale.created', {
        tenantId: 'other-tenant',
        invoiceNumber: 'INV-WIRE-2',
        total: 10
      });
      await new Promise((resolve) => setImmediate(resolve));
      await new Promise((resolve) => setImmediate(resolve));
      expect(calls.length).toBe(0);
    } finally {
      telegramClient.sendTelegramAlert = original;
    }
  });

  test('subscription.expiring is a valid publishable event again', () => {
    const { eventBus, EVENT_TYPES } = require('../services/eventBus');
    expect(EVENT_TYPES).toContain('subscription.expiring');
    const ev = eventBus.publish('subscription.expiring', {
      tenantId: 'digi', daysRemaining: 3, renewalUrl: 'https://example.test/renew'
    });
    expect(ev.type).toBe('subscription.expiring');
  });

  test('tenant notification settings stay tenant-scoped on disk', () => {
    const store = readStore(dataDir, 'tenantNotifications');
    expect(Array.isArray(store.settings)).toBe(true);
    expect(store.settings.every(s => s.tenantId)).toBe(true);
  });
});
