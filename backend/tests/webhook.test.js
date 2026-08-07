// Webhook service unit tests: registration, signature, verification.
const { makeTempDataDir, readStore } = require('./helpers/testData');

let dataDir;
let service;

beforeAll(() => {
  dataDir = makeTempDataDir('webhook-unit');
  process.env.DIGITRONICS_DATA_DIR = dataDir;
  jest.resetModules();
  service = require('../services/webhook.service');
});

beforeEach(() => {
  jest.resetModules();
  service = require('../services/webhook.service');
  const fileStore = require('../utils/fileStore');
  fileStore.write('webhooks', { entries: [] });
});

afterAll(() => {
  const fs = require('fs');
  if (dataDir && fs.existsSync(dataDir)) fs.rmSync(dataDir, { recursive: true, force: true });
});

describe('webhook.service', () => {
  test('register creates a webhook with defaults', () => {
    const hook = service.register({ url: 'https://example.com/hook', events: ['sale.created'] });
    expect(hook.id).toBeTruthy();
    expect(hook.url).toBe('https://example.com/hook');
    expect(hook.events).toEqual(['sale.created']);
    expect(hook.active).toBe(true);
    expect(hook.secret).toBeUndefined();
  });

  test('register rejects invalid URL', () => {
    expect(() => service.register({ url: 'ftp://bad', events: ['sale.created'] })).toThrow(/Invalid webhook URL/);
    expect(() => service.register({ url: 'not-a-url', events: ['sale.created'] })).toThrow(/Invalid webhook URL/);
  });

  test('register generates a random secret and persists it', () => {
    const hook = service.register({ url: 'https://example.com/h2', events: ['inventory.low'] });
    const store = readStore(dataDir, 'webhooks');
    const stored = store.entries.find(h => h.id === hook.id);
    expect(stored.secret).toBeTruthy();
    expect(stored.secret).toMatch(/^[0-9a-f]{64}$/);
  });

  test('list never exposes secrets', () => {
    service.register({ url: 'https://example.com/h3', events: ['sale.created'] });
    const hooks = service.list();
    hooks.forEach(h => expect(h.secret).toBeUndefined());
  });

  test('getById returns null for missing', () => {
    expect(service.getById('missing')).toBeNull();
  });

  test('remove returns false for missing', () => {
    expect(service.remove('missing')).toBe(false);
  });

  test('signPayload is deterministic HMAC-SHA256', () => {
    const payload = { event: 'sale.created', data: {} };
    const s1 = service.signPayload(payload, 'secret');
    const s2 = service.signPayload(payload, 'secret');
    const s3 = service.signPayload(payload, 'other');
    expect(s1).toBe(s2);
    expect(s1).not.toBe(s3);
    expect(s1).toMatch(/^[0-9a-f]{64}$/);
  });

  test('verifySignature accepts valid signatures', () => {
    const payload = { event: 'sale.created', data: { id: 1 } };
    const sig = service.signPayload(payload, 'my-secret');
    expect(service.verifySignature(payload, 'my-secret', `sha256=${sig}`)).toBe(true);
  });

  test('verifySignature rejects tampered payloads', () => {
    const payload = { event: 'sale.created', data: { id: 1 } };
    const sig = service.signPayload(payload, 'my-secret');
    const tampered = { event: 'sale.created', data: { id: 2 } };
    expect(service.verifySignature(tampered, 'my-secret', `sha256=${sig}`)).toBe(false);
  });

  test('verifySignature rejects wrong secret', () => {
    const payload = { event: 'sale.created', data: { id: 1 } };
    const sig = service.signPayload(payload, 'secret-a');
    expect(service.verifySignature(payload, 'secret-b', `sha256=${sig}`)).toBe(false);
  });

  test('verifySignature rejects malformed headers', () => {
    const payload = { event: 'sale.created', data: { id: 1 } };
    expect(service.verifySignature(payload, 's', undefined)).toBe(false);
    expect(service.verifySignature(payload, 's', 'garbage')).toBe(false);
    expect(service.verifySignature(payload, 's', 'md5=abc')).toBe(false);
  });

  test('dispatch is non-blocking and does not throw synchronously', () => {
    service.register({
      url: 'http://127.0.0.1:1/unreachable',
      events: ['sale.created'],
      secret: 'x'
    });
    expect(() => service.dispatch('sale.created', { id: 123 })).not.toThrow();
    expect(service.dispatch('sale.created', { id: 124 })).toBeUndefined();
  });

  test('dispatch ignores webhooks not subscribed to the event', async () => {
    const attempts = [];
    const origFetch = global.fetch;
    global.fetch = () => {
      attempts.push(1);
      return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve('ok') });
    };
    service.register({ url: 'https://example.com/other', events: ['inventory.updated'] });
    service.dispatch('sale.created', { id: 1 });
    await new Promise(r => setTimeout(r, 20));
    global.fetch = origFetch;
    expect(attempts).toHaveLength(0);
  });

  test('sendTest returns failure for unreachable endpoint', async () => {
    const hook = service.register({ url: 'http://127.0.0.1:1/unreachable', events: ['sale.created'] });
    const result = await service.sendTest(hook);
    expect(result.ok).toBe(false);
    expect(result.response).toBeTruthy();
  });
});