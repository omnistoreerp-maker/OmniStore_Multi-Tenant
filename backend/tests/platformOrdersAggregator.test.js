'use strict';

// platformOrdersAggregator.test.js — Platform-scoped Orders Today metric.
//
// Covers the ten required behaviors: counting, yesterday exclusion, TEST
// invoice exclusion, cancelled/invalid handling, safe multi-tenant
// aggregation, zero PII exposure, empty dataset, timezone/date boundary,
// malformed-record resilience, and basic performance sanity.

const fs = require('fs');
const path = require('path');
const { makeTempDataDir } = require('./helpers/testData');

const tempDirs = [];

function loadService(dataDir) {
  jest.resetModules();
  process.env.DIGITRONICS_DATA_DIR = dataDir;
  process.env.JWT_SECRET = 'test-jwt-secret-for-jest-suites';
  return require('../services/platformOrdersAggregator.service');
}

function writeSales(dataDir, invoices) {
  fs.writeFileSync(
    path.join(dataDir, 'sales.json'),
    JSON.stringify({ invoices }, null, 2),
    'utf-8'
  );
}

function todayIso() {
  // The service buckets by the UTC day of Date.now(); build a timestamp
  // guaranteed to be inside "today" regardless of when the suite runs.
  const now = new Date();
  return new Date(now.getTime() - 60 * 1000).toISOString(); // one minute ago
}

function yesterdayIso() {
  const now = new Date();
  return new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString(); // 24h ago
}

function invoice(id, createdAt, extra) {
  return Object.assign({
    id,
    invoiceNumber: id,
    customerName: 'Someone',
    total: 100,
    createdAt
  }, extra || {});
}

describe('platformOrdersAggregator — unit (fixtures only, never production data)', () => {
  let dataDir;
  let service;

  beforeEach(() => {
    dataDir = makeTempDataDir('orders-agg');
    tempDirs.push(dataDir);
    service = loadService(dataDir);
  });

  // 1. orders today count
  test('counts real invoices created today', () => {
    writeSales(dataDir, [
      invoice('INV-000001', todayIso()),
      invoice('INV-000002', todayIso()),
      invoice('INV-000003', todayIso())
    ]);
    expect(service.getOrdersToday()).toBe(3);
  });

  // 2. yesterday not counted
  test('excludes invoices from yesterday', () => {
    writeSales(dataDir, [
      invoice('INV-000001', todayIso()),
      invoice('INV-000002', yesterdayIso()),
      invoice('INV-000003', yesterdayIso())
    ]);
    expect(service.getOrdersToday()).toBe(1);
  });

  // 3. TEST invoice excluded
  test('excludes TEST invoices (baseline "TEST-001" shape and any TEST marker)', () => {
    writeSales(dataDir, [
      invoice('INV-000001', todayIso()),
      invoice('TEST-001', todayIso()),
      invoice('INV-TEST-42', todayIso()),
      invoice('INV-000009', todayIso(), { invoiceNumber: 'test_0042' }),
      invoice('ORDER-77', todayIso(), { invoiceNumber: 'TEST 77' })
    ]);
    // Only INV-000001 counts: the id-as-number fallback in `invoice()` makes
    // ORDER-77's invoiceNumber 'TEST 77' (excluded), and every other record
    // carries a TEST marker in id or invoiceNumber.
    expect(service.getOrdersToday()).toBe(1);
  });

  // 4. cancelled/invalid records handled correctly
  test('excludes cancelled/void/refunded/draft status records', () => {
    writeSales(dataDir, [
      invoice('INV-000001', todayIso()),
      invoice('INV-000002', todayIso(), { status: 'cancelled' }),
      invoice('INV-000003', todayIso(), { status: 'Void' }),
      invoice('INV-000004', todayIso(), { status: 'REFUNDED' }),
      invoice('INV-000005', todayIso(), { status: 'draft' }),
      invoice('INV-000006', todayIso(), { status: 'pending' }) // non-excluded status counts
    ]);
    expect(service.getOrdersToday()).toBe(2); // INV-000001 + pending INV-000006
  });

  // 4b. invalid records
  test('skips structurally invalid records (no id, no timestamp, negative total, non-object)', () => {
    writeSales(dataDir, [
      invoice('INV-000001', todayIso()),
      null,
      { total: 50, createdAt: todayIso() },                    // no id / number
      { id: 'INV-000002' },                                     // no timestamp
      invoice('INV-000003', 'not-a-date'),                      // unparseable timestamp
      invoice('INV-000004', todayIso(), { total: -5 }),         // negative total
      { id: 'INV-000005', date: 'bogus', createdAt: '' }        // unparseable both fields
    ]);
    expect(service.getOrdersToday()).toBe(1);
    const detail = service.getOrdersTodayDetail();
    expect(detail.meta.invalid).toBe(6);
  });

  // 5. multiple tenants aggregated safely
  test('aggregates across multiple tenants without exposing tenant data', () => {
    writeSales(dataDir, [
      invoice('INV-000001', todayIso(), { tenantId: 'tenant-a' }),
      invoice('INV-000002', todayIso(), { tenantId: 'tenant-b' }),
      invoice('INV-000003', todayIso(), { tenantId: 'tenant-c' }),
      invoice('INV-000004', todayIso(), { tenantId: 'tenant-a', status: 'cancelled' })
    ]);
    // No tenant context is passed anywhere — the service is platform-scoped
    // by construction and must see ALL tenants' records.
    expect(service.getOrdersToday()).toBe(3);
    const detail = service.getOrdersTodayDetail();
    expect(JSON.stringify(detail)).not.toContain('tenant-a');
    expect(JSON.stringify(detail)).not.toContain('tenant-b');
    expect(JSON.stringify(detail)).not.toContain('tenant-c');
  });

  // 6. no tenant PII returned
  test('returns a number only; no PII, ids, amounts, or record content', () => {
    writeSales(dataDir, [
      invoice('INV-000001', todayIso(), { customerName: 'John Doe', customerPhone: '01012345678', total: 99999 })
    ]);
    const result = service.getOrdersToday();
    expect(typeof result).toBe('number');
    expect(result).toBe(1);

    // Even the "detail" form must carry zero record content.
    const raw = JSON.stringify(service.getOrdersTodayDetail());
    expect(raw).not.toContain('John Doe');
    expect(raw).not.toContain('01012345678');
    expect(raw).not.toContain('99999');
    expect(raw).not.toContain('INV-000001');
    expect(raw).not.toContain('customerName');
    expect(raw).not.toContain('tenantId');
  });

  // 7. empty dataset = 0
  test('returns 0 for an empty dataset', () => {
    writeSales(dataDir, []);
    expect(service.getOrdersToday()).toBe(0);
  });

  test('returns 0 when the sales store does not exist at all', () => {
    // No sales.json written in this temp dir at all.
    expect(service.getOrdersToday()).toBe(0);
  });

  // 8. timezone/date boundary
  test('UTC day boundary: 23:59:59.999Z counts, 00:00:00Z starts a new day', () => {
    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);
    const justBefore = new Date(todayStart.getTime() - 1).toISOString(); // yesterday 23:59:59.999Z
    const exactStart = todayStart.toISOString();                          // today 00:00:00.000Z
    const endOfDay = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000 - 1).toISOString();

    writeSales(dataDir, [
      invoice('INV-000001', justBefore),
      invoice('INV-000002', exactStart),
      invoice('INV-000003', endOfDay)
    ]);
    expect(service.getOrdersToday()).toBe(2); // exactStart + endOfDay; justBefore is yesterday

    // Deterministic re-check with a fixed reference "now" inside the same day.
    const refNow = new Date(todayStart.getTime() + 12 * 60 * 60 * 1000).toISOString(); // noon UTC
    expect(service.getOrdersToday({ referenceNow: refNow })).toBe(2);
  });

  test('honours the referenceNow option for deterministic day windows', () => {
    const day = '2026-09-20';
    writeSales(dataDir, [
      invoice('INV-000001', '2026-09-20T21:30:00.000Z'),
      invoice('INV-000002', '2026-09-19T21:30:00.000Z'),
      invoice('INV-000003', '2026-09-20T22:30:00.000Z')
    ]);
    // Reference now = 2026-09-20 (UTC midnight of that day + 1h).
    expect(service.getOrdersToday({ referenceNow: day + 'T01:00:00.000Z' })).toBe(2);
    // Reference now = previous day → those two records belong to "tomorrow".
    expect(service.getOrdersToday({ referenceNow: '2026-09-19T23:00:00.000Z' })).toBe(1);
  });

  // 9. malformed record does not crash aggregation
  test('never throws on hostile/garbage store content', () => {
    writeSales(dataDir, [
      undefined,
      42,
      'string-record',
      [],
      {},
      { id: '', createdAt: null },
      { id: 'INV-X', createdAt: { fake: 'object' } },
      invoice('INV-000001', todayIso())
    ]);
    expect(() => service.getOrdersToday()).not.toThrow();
    expect(service.getOrdersToday()).toBe(1);
  });

  // 10. large dataset / basic performance sanity
  test('aggregates a large store (50k invoices) well under a second', () => {
    const invoices = [];
    for (let i = 0; i < 50000; i++) {
      if (i % 5 === 0) invoices.push(invoice('TEST-' + i, todayIso()));
      else if (i % 7 === 0) invoices.push(invoice('INV-' + i, yesterdayIso()));
      else invoices.push(invoice('INV-' + i, todayIso()));
    }
    writeSales(dataDir, invoices);
    const t0 = Date.now();
    const result = service.getOrdersToday();
    const elapsed = Date.now() - t0;
    expect(result).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(1000);
    const detail = service.getOrdersTodayDetail();
    expect(detail.meta.examined).toBe(50000);
    expect(detail.meta.testInvoices).toBe(10000);
  });
});

describe('platformOrdersAggregator — contract with Platform Activity (integration shape)', () => {
  let dataDir;
  let service;

  beforeEach(() => {
    dataDir = makeTempDataDir('orders-agg-contract');
    tempDirs.push(dataDir);
    service = loadService(dataDir);
  });

  test('contract: getOrdersToday() is the drop-in value for ordersToday in getStats()', () => {
    // This pins HOW platformActivity.service will consume the aggregator when
    // the master wires it in: ordersToday = aggregator.getOrdersToday() — a
    // plain number, ready for `formatNumber()` in platform.js, replacing the
    // current `ordersToday: null` placeholder without any UI change.
    writeSales(dataDir, [
      invoice('INV-000001', todayIso()),
      invoice('TEST-001', todayIso()),
      invoice('INV-000002', todayIso(), { status: 'cancelled' })
    ]);
    const stats = { visitorsNow: 0, registeredUsers: 0, activeBusinesses: 0, ordersToday: service.getOrdersToday() };
    expect(stats.ordersToday).toBe(1);
    expect(Number.isInteger(stats.ordersToday)).toBe(true);
    expect(stats.ordersToday).toBeGreaterThanOrEqual(0);
  });

  test('contract: aggregation never writes to the sales store', () => {
    writeSales(dataDir, [invoice('INV-000001', todayIso())]);
    const before = fs.readFileSync(path.join(dataDir, 'sales.json'), 'utf-8');
    service.getOrdersToday();
    service.getOrdersTodayDetail();
    const after = fs.readFileSync(path.join(dataDir, 'sales.json'), 'utf-8');
    expect(after).toBe(before);
  });

  test('contract: result is identical across repeated calls (pure read, no state)', () => {
    writeSales(dataDir, [invoice('INV-000001', todayIso())]);
    const a = service.getOrdersToday();
    const b = service.getOrdersToday();
    expect(a).toBe(b);
  });
});
