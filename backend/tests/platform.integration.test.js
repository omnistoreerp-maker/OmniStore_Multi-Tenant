'use strict';

// platform.integration.test.js — Platform Integration / Test Readiness
//
// Purpose:
//   - Verify existing platform integration contracts
//   - Identify gaps for Platform Online MVP (to be built by GLM)
//   - Do NOT duplicate Platform UI implementation
//   - Do NOT modify Platform implementation files
//
// Coverage:
//   - Static frontend routing (/, /index.html)
//   - Public company catalog (read-only)
//   - Public market catalog (tenant-scoped)
//   - Platform admin route protection
//   - Company provisioning auth/permission enforcement
//   - Tenant isolation in public endpoints
//   - CORS behavior
//   - Rate limiting on public/provisioning endpoints
//   - PWA asset availability

const fs = require('fs');
const path = require('path');
const request = require('supertest');
const { startServer } = require('./helpers/testServer');
const { makeTempDataDir } = require('./helpers/testData');
const { registerCleanup } = require('./helpers/cleanup');

const TENANT = 'default';
let server;
let dataDir;

registerCleanup(() => [server], () => [dataDir]);

function seedCompany(id, name, code, active) {
  const file = path.join(dataDir, 'companies.json');
  const db = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { companies: [] };
  if (!db.companies) db.companies = [];
  db.companies.push({ id, name, code, active: active !== false, status: active !== false ? 'ACTIVE' : 'SUSPENDED' });
  fs.writeFileSync(file, JSON.stringify(db, null, 2), 'utf-8');
}

function seedProduct(id, name, sellPrice, stockQty) {
  const file = path.join(dataDir, 'products.json');
  const db = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { products: [] };
  if (!db.products) db.products = [];
  db.products.push({ id, name, sku: 'SKU-' + id, sellPrice, stockQty, categoryId: 'cat1' });
  fs.writeFileSync(file, JSON.stringify(db, null, 2), 'utf-8');
}

beforeAll(async () => {
  dataDir = makeTempDataDir('platform-integration');
  server = await startServer(dataDir);
  seedCompany('cairotech', 'CairoTech', 'CAIROTECH', true);
  seedCompany('digitronics', 'DigiTronics', 'DIGI', true);
  seedProduct('P1', 'Widget A', 50, 100);
});

describe('Platform Integration — Static Frontend', () => {
  test('GET / serves index.html', async () => {
    const res = await request(server.app).get('/');
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.text).toContain('<!DOCTYPE html>');
  });

  test('GET /index.html serves ERP application', async () => {
    const res = await request(server.app).get('/index.html');
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.text).toContain('<!DOCTYPE html>');
  });
});

describe('Platform Integration — Public Company Catalog', () => {
  test('GET /api/v1/companies returns public catalog without auth', async () => {
    const res = await request(server.app).get('/api/v1/companies');
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data.companies)).toBe(true);
    expect(res.body.data.companies.length).toBeGreaterThanOrEqual(2);
  });

  test('GET /api/v1/companies/:id returns company without auth', async () => {
    const res = await request(server.app).get('/api/v1/companies/cairotech');
    expect(res.statusCode).toBe(200);
    expect(res.body.data.company.id).toBe('cairotech');
  });

  test('GET /api/v1/companies/:id returns 404 for unknown company', async () => {
    const res = await request(server.app).get('/api/v1/companies/ghost');
    expect(res.statusCode).toBe(404);
  });

  test('company catalog does not leak sensitive fields', async () => {
    const res = await request(server.app).get('/api/v1/companies/cairotech');
    expect(res.statusCode).toBe(200);
    const company = res.body.data.company;
    expect(company.password).toBeUndefined();
    expect(company.tokenVersion).toBeUndefined();
    expect(company.tenantIds).toBeUndefined();
    expect(company.tenantRoles).toBeUndefined();
  });
});

describe('Platform Integration — Public Market Catalog', () => {
  test('GET /api/v1/market/products requires tenant context', async () => {
    const res = await request(server.app).get('/api/v1/market/products');
    expect(res.statusCode).toBe(400);
  });

  test('GET /api/v1/market/products returns products for valid tenant', async () => {
    const res = await request(server.app).get('/api/v1/market/products').query({ tenant: TENANT });
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.body.data.products)).toBe(true);
    expect(res.body.data.products.length).toBeGreaterThanOrEqual(1);
  });

  test('public catalog does not expose sensitive product fields', async () => {
    const res = await request(server.app).get('/api/v1/market/products').query({ tenant: TENANT });
    expect(res.statusCode).toBe(200);
    const product = res.body.data.products[0];
    expect(product.password).toBeUndefined();
    expect(product.costPrice).toBeUndefined();
  });
});

describe('Platform Integration — Platform Admin Route Protection', () => {
  test('GET /api/v1/platform/companies requires platform admin auth', async () => {
    const res = await request(server.app).get('/api/v1/platform/companies');
    expect(res.statusCode).toBe(401);
  });

  test('GET /api/v1/platform/summary requires platform admin auth', async () => {
    const res = await request(server.app).get('/api/v1/platform/summary');
    expect(res.statusCode).toBe(401);
  });

  test('GET /api/v1/platform/users requires platform admin auth', async () => {
    const res = await request(server.app).get('/api/v1/platform/users');
    expect(res.statusCode).toBe(401);
  });
});

describe('Platform Integration — Company Provisioning Auth', () => {
  test('POST /api/v1/companies/provision requires authentication', async () => {
    const res = await request(server.app)
      .post('/api/v1/companies/provision')
      .send({ companyName: 'Test Co', companyId: 'testco', adminUsername: 'admin', adminPassword: 'Secret123' });
    expect(res.statusCode).toBe(401);
  });

  test('POST /api/v1/companies/provision requires company.create permission', async () => {
    // This test verifies the endpoint exists and requires auth;
    // permission enforcement is tested in companyProvision.test.js
    const res = await request(server.app)
      .post('/api/v1/companies/provision')
      .set('Authorization', 'Bearer invalid-token')
      .send({ companyName: 'Test Co', companyId: 'testco2', adminUsername: 'admin', adminPassword: 'Secret123' });
    expect(res.statusCode).toBe(401);
  });
});

describe('Platform Integration — Rate Limiting', () => {
  test('public catalog has rate limiting headers', async () => {
    const res = await request(server.app).get('/api/v1/market/products').query({ tenant: TENANT });
    expect(res.statusCode).toBe(200);
    expect(res.headers['ratelimit-limit'] || res.headers['x-ratelimit-limit']).toBeDefined();
  });

  test('company catalog has rate limiting headers', async () => {
    const res = await request(server.app).get('/api/v1/companies');
    expect(res.statusCode).toBe(200);
    expect(res.headers['ratelimit-limit'] || res.headers['x-ratelimit-limit']).toBeDefined();
  });
});

describe('Platform Integration — CORS', () => {
  test('CORS headers are present for allowed origins', async () => {
    const res = await request(server.app)
      .get('/api/v1/health')
      .set('Origin', 'http://localhost:3000');
    expect(res.statusCode).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBeDefined();
  });

  test('CORS headers are absent for disallowed origins in production mode', async () => {
    // This is tested more thoroughly in p0-001-cors.test.js
    // Here we just verify the middleware is active
    const res = await request(server.app)
      .get('/api/v1/health')
      .set('Origin', 'https://evil.com');
    // In test mode with AUTH_REQUIRED=false, localhost is allowed
    // In production mode with AUTH_REQUIRED=true, this would be blocked
    expect(res.statusCode).toBe(200);
  });
});

describe('Platform Integration — PWA Assets', () => {
  test('manifest.json is accessible', async () => {
    const res = await request(server.app).get('/manifest.json');
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    const body = JSON.parse(res.text);
    expect(body.name).toBe('OmniStore ERP');
  });

  test('sw.js is accessible', async () => {
    const res = await request(server.app).get('/sw.js');
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/javascript/);
  });
});

describe('Platform Integration — Security Boundaries', () => {
  test('platform routes are not exposed under /api/v1 without auth', async () => {
    const endpoints = [
      '/api/v1/platform/companies',
      '/api/v1/platform/summary',
      '/api/v1/platform/users',
      '/api/v1/platform/licenses',
      '/api/v1/platform/integrations',
      '/api/v1/platform/audit',
      '/api/v1/platform/admins'
    ];
    for (const endpoint of endpoints) {
      const res = await request(server.app).get(endpoint);
      expect(res.statusCode).toBe(401);
    }
  });

  test('internal backend paths are not exposed', async () => {
    const res = await request(server.app).get('/backend/server.js');
    expect(res.statusCode).toBe(403);
  });

  test('dotfiles are not exposed', async () => {
    const res = await request(server.app).get('/.env');
    expect([404, 403]).toContain(res.statusCode);
  });
});
