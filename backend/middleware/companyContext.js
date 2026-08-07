'use strict';

// companyContext — initializes RequestContext + TenantContext from the
// company selected on the login screen, behind ENABLE_MULTI_COMPANY_LOGIN.
//
// Responsibilities (nothing else):
//   1. When ENABLE_MULTI_COMPANY_LOGIN is false (default): no-op, next()
//      immediately — application behaves exactly as before (backward
//      compatible, zero behavior change).
//   2. When enabled, on the login POST only:
//      - if a valid ACTIVE company id is provided, build a TenantContext whose
//        tenantId === company.id and attach a RequestContext carrying it to
//        `req.requestContext` / `req.tenantContext`.
//      - if no company, an unknown company, or an inactive company is provided,
//        it simply falls back to the legacy default tenant (no tenant attached
//        here) and lets the request continue — it does NOT reject logins. This
//        keeps every existing login flow and the full test suite working even
//        while the feature flag is enabled (backward compatible by design).
//
// It performs no other logic: no user resolution, no JWT, no authorization,
// no repository filtering, no rejection. It only initializes the context.

const config = require('../config');
const ContextFactory = require('../context/ContextFactory');
const RequestContext = require('../context/RequestContext');
const TenantContext = require('../tenant/TenantContext');
const CompanyService = require('../services/company.service');

function companyContext(req, res, next) {
  if (!config.multiCompanyLoginEnabled) {
    return next();
  }

  // Only apply to the actual login POST; never interferes with other
  // /auth/login* sub-routes or non-mutating requests.
  if (req.method !== 'POST' || req.path !== '/login') {
    return next();
  }

  const companyId = req.body && req.body.company;
  if (companyId == null || companyId === '') {
    // No company selected → legacy default login (unchanged behavior).
    return next();
  }

  const company = CompanyService.getCompany(companyId);
  if (!company || company.active === false) {
    // Unknown or inactive company → ignore selection and continue (legacy).
    return next();
  }

  // Build a TenantContext for the selected company: tenantId MUST equal the
  // selected company id. Legacy/global records (no tenantId) are unaffected.
  const tenant = TenantContext.create({
    tenantId: String(company.id),
    tenantName: company.name,
    status: 'active',
    metadata: { companyCode: company.code || '' }
  });

  // Build (or reuse) an immutable RequestContext that carries the tenant.
  const base = req.requestContext instanceof RequestContext
    ? req.requestContext
    : ContextFactory.createEmpty();
  const context = base.with({ tenant });

  req.requestContext = context;
  req.tenantContext = tenant;
  req.company = company;
  return next();
}

module.exports = companyContext;