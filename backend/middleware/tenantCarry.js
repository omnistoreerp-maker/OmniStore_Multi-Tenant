'use strict';

// tenantCarry — Phase 19: recover the securely-bound tenant on authenticated
// requests.
//
// The selected company is bound into the signed access/refresh JWT at login
// (as an optional `tenantId` claim) ONLY when ENABLE_TENANT_CARRY is on and a
// valid, ACTIVE company was resolved into a TenantContext during login. This
// middleware reconstructs `req.tenantContext` on every subsequent authenticated
// request that carries such a bound tenant.
//
// In this phase this ONLY makes the tenant identity available to a future
// authorization layer. It does NOT enforce roles, does NOT filter repositories,
// does NOT deny any request, and does NOT substitute DEFAULT_TENANT_ID.
//
// Rules:
//   - Feature OFF: total no-op; next() immediately (zero behavior change).
//   - No authenticated user: no-op (nothing to carry).
//   - Authenticated user WITHOUT a bound tenantId (legacy token / legacy login):
//     no-op -> legacy request keeps the exact pre-Phase-19 behavior.
//   - Authenticated user WITH a `tenantId` that is missing or inactive in the
//     company catalog: do NOT fix it, do NOT fall back to DEFAULT_TENANT_ID, do
//     NOT silently assign another tenant. Leave req.tenantContext absent; the
//     request remains authenticated under the existing identity (narrowly
//     scoped to tenant carry, no invented API contract).
//   - Authenticated user WITH a valid, ACTIVE bound tenant: rebuild a
//     TenantContext (tenantId), i.e. the exact company id, and attach it to
//     `req.tenantContext` / `req.requestContext`.
//
// The tenant id is taken exclusively from the token that was signed server-side
// with the JWT secret at login (`req.user.tenantId`, which is
// cryptographically verified). It is never trusted from query/body/header.

const config = require('../config');
const CompanyService = require('../services/company.service');
const ContextFactory = require('../context/ContextFactory');
const requestContextLike = require('../context/RequestContext');
const TenantContext = require('../tenant/TenantContext');

function tenantCarry(req, res, next) {
  if (!config.tenantCarryEnabled) return next();

  const user = req.user;
  if (!user) return next();

  const tenantId = user.tenantId;
  if (tenantId === undefined || tenantId === null || String(tenantId) === '') {
    // Legacy token or legacy login -> carry nothing (unchanged behavior).
    return next();
  }

  const company = CompanyService.getCompany(tenantId);
  if (!company || company.active === false) {
    // Bound tenant no longer valid / active. Do NOT substitute another tenant
    // and do NOT fall back to DEFAULT_TENANT_ID. Keep the request authenticated
    // with no tenant context (scoped narrowly to tenant carry).
    return next();
  }

  const tenant = TenantContext.create({
    tenantId: String(company.id),
    tenantName: company.name,
    status: 'active',
    metadata: { companyCode: company.code || '' }
  });

  const base = req.requestContext instanceof requestContextLike
    ? req.requestContext
    : ContextFactory.createEmpty();
  const context = base.with({ tenant });

  req.requestContext = context;
  req.tenantContext = tenant;
  req.company = company;
  return next();
}

module.exports = tenantCarry;