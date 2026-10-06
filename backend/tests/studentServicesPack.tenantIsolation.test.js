'use strict';

const fs = require('fs');
const { makeTempDataDir } = require('./helpers/testData');

function loadService(dataDir) {
  jest.resetModules();
  process.env.DIGITRONICS_DATA_DIR = dataDir;
  return require('../services/studentServicesPack.service');
}

describe('studentServicesPack tenant isolation', () => {
  let dataDir;
  let service;

  beforeEach(() => {
    dataDir = makeTempDataDir('student-pack');
    service = loadService(dataDir);
  });

  afterEach(() => {
    try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch (_) {}
  });

  test('missing tenant context is rejected on reads and writes', () => {
    expect(() => service.listRates(null)).toThrow(/Tenant context is required/);
    expect(() => service.listOrders({})).toThrow(/Tenant context is required/);
    expect(() => service.listPasses({})).toThrow(/Tenant context is required/);
    expect(() => service.getSettings({})).toThrow(/Tenant context is required/);
    expect(() => service.calculateCost(null, 10, 1, 'A4', 'bw', 'single', false)).toThrow(/Tenant context is required/);
  });

  test('rates, orders, passes, and settings never leak across tenants', () => {
    const tenantA = { tenantId: 'tenant-a' };
    const tenantB = { tenantId: 'tenant-b' };

    service.upsertRate(tenantA, { paperSize: 'A4', printType: 'bw', duplexType: 'single', pricePerPage: 1.5, bindingPrice: 5 });
    service.upsertRate(tenantB, { paperSize: 'A4', printType: 'bw', duplexType: 'single', pricePerPage: 9.9, bindingPrice: 20 });

    const ratesA = service.listRates(tenantA);
    const ratesB = service.listRates(tenantB);
    expect(ratesA).toHaveLength(1);
    expect(ratesB).toHaveLength(1);
    expect(ratesA[0].pricePerPage).toBe(1.5);
    expect(ratesB[0].pricePerPage).toBe(9.9);

    const orderA = service.createOrder(tenantA, { studentPhone: '01000000001', totalPages: 2, copies: 1, paperSize: 'A4', printType: 'bw', duplexType: 'single' });
    const orderB = service.createOrder(tenantB, { studentPhone: '01000000002', totalPages: 2, copies: 1, paperSize: 'A4', printType: 'bw', duplexType: 'single' });
    expect(orderA.order.totalAmount).toBe(3);
    expect(orderB.order.totalAmount).toBe(19.8);
    expect(orderA.order.tenantId).toBe('tenant-a');
    expect(orderB.order.tenantId).toBe('tenant-b');

    expect(service.listOrders(tenantA).orders.map((o) => o.id)).toEqual([orderA.order.id]);
    expect(service.listOrders(tenantB).orders.map((o) => o.id)).toEqual([orderB.order.id]);

    service.createPass(tenantA, { studentPhone: '01000000001', month: '2026-09', year: 2026, amount: 100 });
    service.createPass(tenantB, { studentPhone: '01000000002', month: '2026-09', year: 2026, amount: 250 });
    expect(service.listPasses(tenantA).passes).toHaveLength(1);
    expect(service.listPasses(tenantB).passes).toHaveLength(1);
    expect(service.listPasses(tenantA).passes[0].amount).toBe(100);
    expect(service.listPasses(tenantB).passes[0].amount).toBe(250);

    service.updateSettings(tenantA, { whatsappNumber: '01111111111', currency: 'EGP' });
    service.updateSettings(tenantB, { whatsappNumber: '02222222222', currency: 'USD' });
    expect(service.getSettings(tenantA)).toEqual({ whatsappNumber: '01111111111', currency: 'EGP' });
    expect(service.getSettings(tenantB)).toEqual({ whatsappNumber: '02222222222', currency: 'USD' });
  });

  test('createOrder prices from the caller tenant only, even if another tenant has a cheaper rate', () => {
    const tenantA = { tenantId: 'shop-a' };
    const tenantB = { tenantId: 'shop-b' };
    service.upsertRate(tenantA, { paperSize: 'A4', printType: 'bw', duplexType: 'single', pricePerPage: 4 });
    service.upsertRate(tenantB, { paperSize: 'A4', printType: 'bw', duplexType: 'single', pricePerPage: 1 });
    const order = service.createOrder(tenantA, { studentPhone: '01555555555', totalPages: 10, copies: 1, paperSize: 'A4', printType: 'bw', duplexType: 'single' });
    expect(order.order.totalAmount).toBe(40);
  });

  test('client-supplied tenantId on payload cannot hijack another tenant rate or order', () => {
    const tenantA = { tenantId: 'alpha' };
    const tenantB = { tenantId: 'beta' };
    service.upsertRate(tenantA, { paperSize: 'A4', printType: 'bw', duplexType: 'single', pricePerPage: 2 });
    // beta has no matching rate of its own: with a hijacked tenantId an
    // attacker would be priced from alpha's rate. The server must use the
    // caller's OWN tenant — beta — so the order is stamped beta and priced
    // from beta's rates only (no rate → error, never alpha's pricing).
    expect(() => service.createOrder(tenantB, {
      studentPhone: '01012345678',
      tenantId: 'alpha',
      paperSize: 'A4',
      printType: 'bw',
      duplexType: 'single'
    })).toThrow(/No print rate configured/);

    // And an order created for beta is stamped with beta even when the
    // payload claims alpha.
    service.upsertRate(tenantB, { paperSize: 'A4', printType: 'bw', duplexType: 'single', pricePerPage: 7 });
    const order = service.createOrder(tenantB, {
      studentPhone: '01012345678',
      tenantId: 'alpha',
      paperSize: 'A4',
      printType: 'bw',
      duplexType: 'single'
    });
    expect(order.order.tenantId).toBe('beta');
    expect(order.order.totalAmount).toBe(7); // 10 pages × beta's 7, NOT alpha's 2
  });
});
