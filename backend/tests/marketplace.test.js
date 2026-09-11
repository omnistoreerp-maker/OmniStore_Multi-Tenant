'use strict';

const request = require('supertest');
const fs = require('fs');
const path = require('path');
const { startServer } = require('./helpers/testServer');
const { makeTempDataDir, seed, readStore } = require('./helpers/testData');
const { login } = require('./helpers/authHelper');

const PASSWORD = 'Pass#123';
const tempDirs = [];

function seedMarketplace(dir) {
  seed(dir, 'companies', {
    companies: [
      { id: 'digi', code: 'DIGI', name: 'DigiTronics', active: true, status: 'ACTIVE', branches: [] },
      { id: 'acme', code: 'ACME', name: 'Acme Corp', active: true, status: 'ACTIVE', branches: [] }
    ]
  });
  seed(dir, 'users', {
    users: [
      { id: 'u-master', username: 'master', password: require('bcryptjs').hashSync(PASSWORD, 10), fullName: 'Master Admin', role: 'Viewer', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), tokenVersion: 0 }
    ]
  });
  seed(dir, 'platformAdmins', { admins: [{ username: 'master', platformRole: 'MASTER_OWNER', createdAt: new Date().toISOString() }] });
  seed(dir, 'products', {
    products: [
      { id: 'p1', companyId: 'digi', name: 'Public Widget', description: 'A public widget', category: 'Widgets', buyPrice: 10, sellPrice: 20, currency: 'USD', active: true, stockQty: 100, lowStockThreshold: 5, serialTracked: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      { id: 'p2', companyId: 'digi', name: 'Secret Widget', description: 'Internal only', category: 'Widgets', buyPrice: 10, sellPrice: 20, currency: 'USD', active: false, stockQty: 0, lowStockThreshold: 5, serialTracked: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      { id: 'p3', companyId: 'acme', name: 'Acme Gadget', description: 'A public gadget', category: 'Gadgets', buyPrice: 20, sellPrice: 40, currency: 'USD', active: true, stockQty: 50, lowStockThreshold: 5, serialTracked: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
    ]
  });
}

describe('GET /api/v1/platform-public/marketplace', () => {
  let server;
  let dir;

  beforeAll(async () => {
    jest.resetModules();
    dir = makeTempDataDir('marketplace');
    tempDirs.push(dir);
    seedMarketplace(dir);
    const s = await startServer(dir, { AUTH_REQUIRED: 'false' });
    server = s.app;
  });

  afterAll(() => {
    tempDirs.forEach(d => {
      try { fs.rmSync(d, { recursive: true, force: true }); } catch (_) {}
    });
  });

  test('anonymous can GET /marketplace/companies', async () => {
    const res = await request(server).get('/api/v1/platform-public/marketplace/companies');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data.companies)).toBe(true);
    expect(res.body.data.companies.length).toBeGreaterThanOrEqual(2);
  });

  test('GET /marketplace/company/:companyId/products returns products for active company', async () => {
    const res = await request(server).get('/api/v1/platform-public/marketplace/company/digi/products');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data.products)).toBe(true);
    const active = res.body.data.products.filter(p => p.active);
    expect(active.length).toBeGreaterThanOrEqual(1);
  });

  test('GET /marketplace/company/:companyId/products hides inactive products from default listing', async () => {
    const res = await request(server).get('/api/v1/platform-public/marketplace/company/digi/products');
    expect(res.status).toBe(200);
    const ids = res.body.data.products.map(p => p.id);
    expect(ids).not.toContain('p2');
  });

  test('GET /marketplace/company/:companyId/products supports search', async () => {
    const res = await request(server).get('/api/v1/platform-public/marketplace/company/digi/products?search=widget');
    expect(res.status).toBe(200);
    const names = res.body.data.products.map(p => p.name);
    expect(names.some(n => n.toLowerCase().includes('widget'))).toBe(true);
  });

  test('GET /marketplace/company/:companyId/products for unknown company returns 404', async () => {
    const res = await request(server).get('/api/v1/platform-public/marketplace/company/unknown/products');
    expect(res.status).toBe(404);
  });

  test('POST /marketplace/companies is rejected', async () => {
    const res = await request(server).post('/api/v1/platform-public/marketplace/companies');
    expect(res.status).toBe(404);
  });

  test('marketplace page includes a language switcher and translations', async () => {
    const html = await request(server).get('/marketplace.html');
    expect(html.status).toBe(200);
    expect(html.text).toContain('id="lang-switch"');
    expect(html.text).toContain('marketplace_title');
    expect(html.text).toContain('search_placeholder');
  });
});
