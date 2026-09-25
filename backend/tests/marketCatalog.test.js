'use strict';

// Market catalog — Digitronics product catalog suite.
//
// Coverage:
//   - the 21-product Digitronics catalog (List fail.pdf) is served
//   - spec passthrough (cpu / ramRom / gpu) in list projection
//   - brand, category, search (incl. spec fields), price sort
//   - price comes from sellPrice via marketConfig.priceFor (EGP)
//   - fail-closed visibility: tenant without productVisibility sees nothing
//   - ensureSeeded backfills productVisibility for the default tenant

const fs = require('fs');
const path = require('path');
const { makeTempDataDir, seed, readStore } = require('./helpers/testData');

const SOURCE_PRODUCTS = path.join(__dirname, '..', 'data', 'products.json');
const SOURCE_CONFIG = path.join(__dirname, '..', 'data', 'marketConfig.json');

let dataDir;
let catalog;
let marketConfig;

beforeAll(() => {
  dataDir = makeTempDataDir('market-catalog');
  fs.copyFileSync(SOURCE_PRODUCTS, path.join(dataDir, 'products.json'));
  fs.copyFileSync(SOURCE_CONFIG, path.join(dataDir, 'marketConfig.json'));
  process.env.DIGITRONICS_DATA_DIR = dataDir;
  jest.resetModules();
  catalog = require('../services/marketCatalog.service');
  marketConfig = require('../services/marketConfig.service');
  marketConfig.ensureSeeded();
});

afterAll(() => {
  delete process.env.DIGITRONICS_DATA_DIR;
  if (dataDir && fs.existsSync(dataDir)) fs.rmSync(dataDir, { recursive: true, force: true });
});

const TENANT = 'default';

describe('Digitronics catalog — data integrity', () => {
  test('products.json contains exactly 21 unique products', () => {
    const raw = JSON.parse(fs.readFileSync(SOURCE_PRODUCTS, 'utf-8'));
    const arr = Array.isArray(raw) ? raw : raw.products;
    expect(arr).toHaveLength(21);
    const ids = new Set(arr.map((p) => p.id));
    expect(ids.size).toBe(21);
  });

  test('every product has the required catalog fields and a positive sellPrice', () => {
    const raw = JSON.parse(fs.readFileSync(SOURCE_PRODUCTS, 'utf-8'));
    const arr = Array.isArray(raw) ? raw : raw.products;
    arr.forEach((p) => {
      expect(typeof p.name).toBe('string');
      expect(p.name.length).toBeGreaterThan(0);
      expect(['hp', 'lenovo', 'dell', 'sony']).toContain(p.brandId);
      expect(['laptops', 'gaming']).toContain(p.categoryId);
      expect(Number(p.sellPrice)).toBeGreaterThan(0);
      expect(Number(p.stockQty)).toBe(1);
      expect(typeof p.cpu).toBe('string');
      expect(typeof p.ramRom).toBe('string');
      expect(typeof p.gpu).toBe('string');
    });
  });

  test('brands and categories are balanced (18 laptops / 3 gaming)', () => {
    const raw = JSON.parse(fs.readFileSync(SOURCE_PRODUCTS, 'utf-8'));
    const arr = Array.isArray(raw) ? raw : raw.products;
    expect(arr.filter((p) => p.categoryId === 'laptops')).toHaveLength(18);
    expect(arr.filter((p) => p.categoryId === 'gaming')).toHaveLength(3);
    expect(arr.filter((p) => p.brandId === 'dell')).toHaveLength(7);
    expect(arr.filter((p) => p.brandId === 'hp')).toHaveLength(9);
  });
});

describe('marketCatalog.listProducts — Digitronics catalog', () => {
  test('default tenant with includeAll visibility sees all 21 products', async () => {
    const res = await catalog.listProducts(TENANT, { includeOutOfStock: 'true', limit: 100 });
    expect(res.total).toBe(21);
    expect(res.products).toHaveLength(21);
  });

  test('projection exposes price (from sellPrice) and spec fields', async () => {
    const res = await catalog.listProducts(TENANT, { includeOutOfStock: 'true', limit: 100 });
    const p = res.products.find((x) => x.id === 'hp-zbook-15-g5');
    expect(p).toBeDefined();
    expect(p.price).toBe(21000);
    expect(p.cpu).toBe('i7 8TH H');
    expect(p.ramRom).toBe('16/512');
    expect(p.gpu).toBe('P1000 4G');
    expect(p.brandId).toBe('hp');
    expect(p.categoryId).toBe('laptops');
  });

  test('brandId filter works (dell => 7)', async () => {
    const res = await catalog.listProducts(TENANT, { brandId: 'dell', includeOutOfStock: 'true', limit: 100 });
    expect(res.total).toBe(7);
    expect(res.products.every((p) => p.brandId === 'dell')).toBe(true);
  });

  test('categoryId filter works (gaming => 3 PS4)', async () => {
    const res = await catalog.listProducts(TENANT, { categoryId: 'gaming', includeOutOfStock: 'true', limit: 100 });
    expect(res.total).toBe(3);
    expect(res.products.every((p) => p.categoryId === 'gaming')).toBe(true);
  });

  test('search matches name and spec fields (i7 => 7)', async () => {
    const res = await catalog.listProducts(TENANT, { search: 'i7', includeOutOfStock: 'true', limit: 100 });
    expect(res.total).toBe(7);
    expect(res.products.every((p) =>
      (p.name + ' ' + (p.cpu || '') + ' ' + (p.sku || '')).toLowerCase().includes('i7')
    )).toBe(true);
  });

  test('search matches GPU spec (P1000 => ZBOOK)', async () => {
    const res = await catalog.listProducts(TENANT, { search: 'P1000', includeOutOfStock: 'true', limit: 100 });
    expect(res.total).toBe(2);
    expect(res.products.every((p) => String(p.gpu).includes('P1000'))).toBe(true);
  });

  test('sortBy=price desc => HP ZBOOK 15 G5 first (21000)', async () => {
    const res = await catalog.listProducts(TENANT, { sortBy: 'price', sortOrder: 'desc', includeOutOfStock: 'true', limit: 100 });
    expect(res.products[0].id).toBe('hp-zbook-15-g5');
    expect(res.products[0].price).toBe(21000);
  });

  test('sortBy=price asc => HP PROBOOK 455 G5 first (7500)', async () => {
    const res = await catalog.listProducts(TENANT, { sortBy: 'price', sortOrder: 'asc', includeOutOfStock: 'true', limit: 100 });
    expect(res.products[0].id).toBe('hp-probook-455-g5');
    expect(res.products[0].price).toBe(7500);
  });

  test('default stock filter still hides out-of-stock items', async () => {
    const raw = JSON.parse(fs.readFileSync(path.join(dataDir, 'products.json'), 'utf-8'));
    const arr = Array.isArray(raw) ? raw : raw.products;
    arr[0].stockQty = 0;
    fs.writeFileSync(path.join(dataDir, 'products.json'), JSON.stringify(raw, null, 2), 'utf-8');
    try {
      const res = await catalog.listProducts(TENANT, { limit: 100 });
      expect(res.total).toBe(20);
      const all = await catalog.listProducts(TENANT, { includeOutOfStock: 'true', limit: 100 });
      expect(all.total).toBe(21);
    } finally {
      arr[0].stockQty = 1;
      fs.writeFileSync(path.join(dataDir, 'products.json'), JSON.stringify(raw, null, 2), 'utf-8');
    }
  });

  test('categories() reports counts from the catalog', async () => {
    const cats = await catalog.categories(TENANT);
    const ids = cats.map((c) => c.id).sort();
    expect(ids).toEqual(['gaming', 'laptops']);
    const laptops = cats.find((c) => c.id === 'laptops');
    expect(laptops.count).toBe(18);
  });
});

describe('marketConfig — visibility and currency', () => {
  test('default tenant is seeded with productVisibility.includeAll', () => {
    const cfg = marketConfig.get(TENANT);
    expect(cfg).toBeTruthy();
    expect(cfg.productVisibility).toEqual({ includeAll: true });
  });

  test('default tenant currency is EGP', () => {
    const cfg = marketConfig.get(TENANT);
    expect(cfg.currency).toBe('EGP');
  });

  test('ensureSeeded backfills productVisibility on an existing config', () => {
    const db = readStore(dataDir, 'marketConfig');
    const def = db.configs.find((c) => c.tenantId === TENANT);
    delete def.productVisibility;
    fs.writeFileSync(path.join(dataDir, 'marketConfig.json'), JSON.stringify(db, null, 2), 'utf-8');
    try {
      marketConfig.ensureSeeded();
      const cfg = marketConfig.get(TENANT);
      expect(cfg.productVisibility).toEqual({ includeAll: true });
    } finally {
      const restored = readStore(dataDir, 'marketConfig');
      const rdef = restored.configs.find((c) => c.tenantId === TENANT);
      rdef.productVisibility = { includeAll: true };
      fs.writeFileSync(path.join(dataDir, 'marketConfig.json'), JSON.stringify(restored, null, 2), 'utf-8');
    }
  });

  test('tenant without productVisibility sees zero products (fail-closed)', async () => {
    const res = await catalog.listProducts('tenant-no-vis', { includeOutOfStock: 'true', limit: 100 });
    expect(res.total).toBe(0);
  });

  test('explicit included list restricts visibility', async () => {
    const db = readStore(dataDir, 'marketConfig');
    db.configs.push({
      tenantId: 'tenant-allow-2',
      enabled: true,
      productVisibility: { includeAll: false, included: ['hp-zbook-15-g5', 'dell-latitude-5570-i7'] }
    });
    fs.writeFileSync(path.join(dataDir, 'marketConfig.json'), JSON.stringify(db, null, 2), 'utf-8');
    try {
      const res = await catalog.listProducts('tenant-allow-2', { includeOutOfStock: 'true', limit: 100 });
      expect(res.total).toBe(2);
      expect(res.products.map((p) => p.id).sort()).toEqual(['dell-latitude-5570-i7', 'hp-zbook-15-g5']);
    } finally {
      const restored = readStore(dataDir, 'marketConfig');
      restored.configs = restored.configs.filter((c) => c.tenantId !== 'tenant-allow-2');
      fs.writeFileSync(path.join(dataDir, 'marketConfig.json'), JSON.stringify(restored, null, 2), 'utf-8');
    }
  });

  test('priceFor falls back to sellPrice and honours overrides', () => {
    const cfg = marketConfig.get(TENANT);
    expect(marketConfig.priceFor({ id: 'x', sellPrice: 500 }, cfg)).toBe(500);
    const withOverride = Object.assign({}, cfg, { priceOverrides: { x: 750 } });
    expect(marketConfig.priceFor({ id: 'x', sellPrice: 500 }, withOverride)).toBe(750);
  });
});
