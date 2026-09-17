'use strict';

// Phase 1 (Go-Live) Multi-Company Login tests.
// Verifies the read-only company catalog service and the gated company-context
// middleware. The middleware is asserted directly with a stub req/res so the
// test does not depend on re-reading config at runtime.

const CompanyService = require('../services/company.service');
const companyContext = require('../middleware/companyContext');
const config = require('../config');

describe('company.service (read-only catalog)', () => {
  it('lists companies (arbitrary count supported)', () => {
    const c = CompanyService.listCompanies();
    expect(Array.isArray(c)).toBe(true);
    expect(c.length).toBeGreaterThan(0);
    expect(c.some(x => x.id === 'digitronics')).toBe(true);
  });

  it('getCompany returns by id and null when absent', () => {
    expect(CompanyService.getCompany('digitronics').id).toBe('digitronics');
    expect(CompanyService.getCompany('ghost')).toBeNull();
  });

  it('getActiveCompanies excludes inactive and sorts alphabetically', () => {
    const active = CompanyService.getActiveCompanies();
    expect(active.every(x => x.active !== false)).toBe(true);
    const names = active.map(x => x.name);
    expect(names).toEqual(names.slice().sort((a, b) => a.localeCompare(b)));
  });
});

describe('companyContext middleware (ENABLE_MULTI_COMPANY_LOGIN)', () => {
  function nextSpy() { const s = { called: false }; const f = () => { s.called = true; }; return [s, f]; }

  it('is a no-op when the flag is disabled (default)', () => {
    // config.multiCompanyLoginEnabled is false by default (no env in CI).
    const [s, next] = nextSpy();
    const req = { method: 'POST', path: '/login', body: { password: 'x' } };
    let sent = null;
    const res = { status(c) { sent = c; return res; }, json(o) { sent = o; return res; } };
    companyContext(req, res, next);
    expect(s.called).toBe(true);
    expect(req.tenantContext).toBeUndefined();
  });

  it('only intercepts the login POST path', () => {
    const before = config.multiCompanyLoginEnabled;
    Object.defineProperty(config, 'multiCompanyLoginEnabled', { get: () => true });
    const [st, next] = nextSpy();
    const req = { method: 'GET', path: '/me', body: {} };
    companyContext(req, {}, next);
    expect(st.called).toBe(true);
    // restore
    Object.defineProperty(config, 'multiCompanyLoginEnabled', { value: before, writable: true });
  });

  it('is backward compatible when enabled: no company still allows login (legacy default)', () => {
    const before = config.multiCompanyLoginEnabled;
    Object.defineProperty(config, 'multiCompanyLoginEnabled', { value: true, writable: true });
    const [st, next] = nextSpy();
    const req = { method: 'POST', path: '/login', body: { password: 'x' } };
    companyContext(req, {}, next);
    expect(st.called).toBe(true);
    expect(req.tenantContext).toBeUndefined();
    Object.defineProperty(config, 'multiCompanyLoginEnabled', { value: before, writable: true });
  });

  it('is backward compatible for unknown/inactive companies (no rejection, no tenant)', () => {
    const before = config.multiCompanyLoginEnabled;
    Object.defineProperty(config, 'multiCompanyLoginEnabled', { value: true, writable: true });
    const [st, next] = nextSpy();
    const req = { method: 'POST', path: '/login', body: { company: 'astra' } };
    const res = { status() { return res; }, json() { return res; } };
    companyContext(req, res, next);
    expect(st.called).toBe(true);
    expect(req.tenantContext).toBeUndefined();
    Object.defineProperty(config, 'multiCompanyLoginEnabled', { value: before, writable: true });
  });

  it('builds TenantContext.tenantId === selected company.id for a valid active company', () => {
    const before = config.multiCompanyLoginEnabled;
    Object.defineProperty(config, 'multiCompanyLoginEnabled', { get: () => true });
    let nextCalled = false;
    const req = { method: 'POST', path: '/login', body: { company: 'nile' } };
    const res = { status() { return res; }, json() { return res; } };
    companyContext(req, res, () => { nextCalled = true; });
    expect(nextCalled).toBe(true);
    expect(req.tenantContext).toBeTruthy();
    expect(req.tenantContext.tenantId).toBe('nile');
    expect(req.company.name).toBe('Nile Electronics');
    expect(req.requestContext).toBeTruthy();
    expect(req.requestContext.tenant.tenantId).toBe('nile');
    Object.defineProperty(config, 'multiCompanyLoginEnabled', { value: before, writable: true });
  });

  });