// P0-4 Webhook Tenant Scoping regression tests.
// Verifies: tenant-scoped registration, cross-tenant dispatch rejection,
// tenant-matching dispatch, legacy webhook behavior, fail-closed semantics.
const { makeTempDataDir } = require('./helpers/testData');

let dataDir;
let service;

function freshService() {
  jest.resetModules();
  process.env.DIGITRONICS_DATA_DIR = dataDir;
  jest.mock('../repositories', () => {
    const store = { entries: [] };
    return {
      webhooks: {
        read: jest.fn(() => JSON.parse(JSON.stringify(store))),
        write: jest.fn((data) => { Object.assign(store, data); }),
        _store: store,
      }
    };
  });
  return require('../services/webhook.service');
}

beforeEach(() => {
  dataDir = makeTempDataDir('webhook-tenant');
  jest.spyOn(global, 'fetch').mockResolvedValue({ ok: true, text: () => Promise.resolve('') });
});

afterEach(() => {
  const fs = require('fs');
  if (dataDir && fs.existsSync(dataDir)) fs.rmSync(dataDir, { recursive: true, force: true });
  jest.restoreAllMocks();
});

describe('P0-4 Webhook Tenant Scoping', () => {
  describe('tenant-scoped registration', () => {
    test('register with tenantId stores it on the webhook', () => {
      service = freshService();
      const hook = service.register({
        url: 'https://example.com/hook-a',
        events: ['sale.created'],
        tenantId: 'T-A'
      });
      expect(hook.tenantId).toBe('T-A');
    });

    test('register without tenantId stores null (legacy)', () => {
      service = freshService();
      const hook = service.register({
        url: 'https://example.com/legacy',
        events: ['sale.created']
      });
      expect(hook.tenantId).toBeNull();
    });

    test('register with empty string tenantId stores null', () => {
      service = freshService();
      const hook = service.register({
        url: 'https://example.com/hook',
        events: ['sale.created'],
        tenantId: ''
      });
      expect(hook.tenantId).toBeNull();
    });
  });

  describe('tenant-scoped list', () => {
    test('list with tenantId returns only matching + legacy webhooks', () => {
      service = freshService();
      service.register({ url: 'https://a.com', events: ['sale.created'], tenantId: 'T-A' });
      service.register({ url: 'https://b.com', events: ['sale.created'], tenantId: 'T-B' });
      service.register({ url: 'https://legacy.com', events: ['sale.created'] });

      const listA = service.list({ tenantId: 'T-A' });
      expect(listA.length).toBe(2); // T-A + legacy
      expect(listA.map(h => h.url)).toContain('https://a.com');
      expect(listA.map(h => h.url)).toContain('https://legacy.com');
      expect(listA.map(h => h.url)).not.toContain('https://b.com');
    });

    test('list without tenantId returns all webhooks', () => {
      service = freshService();
      service.register({ url: 'https://a.com', events: ['sale.created'], tenantId: 'T-A' });
      service.register({ url: 'https://b.com', events: ['sale.created'], tenantId: 'T-B' });

      const all = service.list();
      expect(all.length).toBe(2);
    });
  });

  describe('cross-tenant dispatch rejection', () => {
    test('Tenant A event does NOT reach Tenant B webhook', async () => {
      service = freshService();
      service.register({ url: 'https://b.com/hook', events: ['sale.created'], tenantId: 'T-B' });

      await service.dispatch('sale.created', { id: 'sale-1' }, 'T-A');
      // Wait for async delivery
      await new Promise(r => setTimeout(r, 50));

      expect(fetch).not.toHaveBeenCalledWith(
        'https://b.com/hook',
        expect.anything()
      );
    });

    test('Tenant A event reaches Tenant A webhook', async () => {
      service = freshService();
      service.register({ url: 'https://a.com/hook', events: ['sale.created'], tenantId: 'T-A' });

      await service.dispatch('sale.created', { id: 'sale-1' }, 'T-A');
      await new Promise(r => setTimeout(r, 50));

      expect(fetch).toHaveBeenCalledWith(
        'https://a.com/hook',
        expect.objectContaining({ method: 'POST' })
      );
    });

    test('Tenant B event reaches Tenant B webhook but not Tenant A', async () => {
      service = freshService();
      service.register({ url: 'https://a.com/hook', events: ['sale.created'], tenantId: 'T-A' });
      service.register({ url: 'https://b.com/hook', events: ['sale.created'], tenantId: 'T-B' });

      await service.dispatch('sale.created', { id: 'sale-2' }, 'T-B');
      await new Promise(r => setTimeout(r, 50));

      expect(fetch).toHaveBeenCalledWith(
        'https://b.com/hook',
        expect.objectContaining({ method: 'POST' })
      );
      expect(fetch).not.toHaveBeenCalledWith(
        'https://a.com/hook',
        expect.anything()
      );
    });
  });

  describe('legacy webhook behavior (fail-closed)', () => {
    test('legacy webhook fires when dispatch has NO tenant context', async () => {
      service = freshService();
      service.register({ url: 'https://legacy.com/hook', events: ['sale.created'] });

      await service.dispatch('sale.created', { id: 'sale-3' });
      await new Promise(r => setTimeout(r, 50));

      expect(fetch).toHaveBeenCalledWith(
        'https://legacy.com/hook',
        expect.objectContaining({ method: 'POST' })
      );
    });

    test('legacy webhook does NOT fire when dispatch HAS tenant context', async () => {
      service = freshService();
      service.register({ url: 'https://legacy.com/hook', events: ['sale.created'] });

      await service.dispatch('sale.created', { id: 'sale-4' }, 'T-A');
      await new Promise(r => setTimeout(r, 50));

      expect(fetch).not.toHaveBeenCalledWith(
        'https://legacy.com/hook',
        expect.anything()
      );
    });
  });

  describe('no tenant context dispatch', () => {
    test('only legacy webhooks fire when tenantId is undefined', async () => {
      service = freshService();
      service.register({ url: 'https://legacy.com', events: ['sale.created'] });
      service.register({ url: 'https://tenant.com', events: ['sale.created'], tenantId: 'T-A' });

      await service.dispatch('sale.created', { id: 'sale-5' }, undefined);
      await new Promise(r => setTimeout(r, 50));

      expect(fetch).toHaveBeenCalledWith(
        'https://legacy.com',
        expect.objectContaining({ method: 'POST' })
      );
      expect(fetch).not.toHaveBeenCalledWith(
        'https://tenant.com',
        expect.anything()
      );
    });
  });

  describe('inactive webhooks are never fired', () => {
    test('inactive webhook is skipped even with matching tenant', async () => {
      service = freshService();
      const hook = service.register({ url: 'https://a.com/hook', events: ['sale.created'], tenantId: 'T-A' });
      service.update(hook.id, { active: false });

      await service.dispatch('sale.created', { id: 'sale-6' }, 'T-A');
      await new Promise(r => setTimeout(r, 50));

      expect(fetch).not.toHaveBeenCalled();
    });
  });

  describe('event filtering', () => {
    test('webhook only receives subscribed events', async () => {
      service = freshService();
      service.register({ url: 'https://a.com/hook', events: ['sale.created'], tenantId: 'T-A' });

      await service.dispatch('inventory.updated', { id: 'inv-1' }, 'T-A');
      await new Promise(r => setTimeout(r, 50));
      expect(fetch).not.toHaveBeenCalled();

      jest.mocked(fetch).mockClear();
      await service.dispatch('sale.created', { id: 'sale-7' }, 'T-A');
      await new Promise(r => setTimeout(r, 50));
      expect(fetch).toHaveBeenCalled();
    });
  });
});
