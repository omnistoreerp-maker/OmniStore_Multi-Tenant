'use strict';

// loginTenant — SERVER-AUTHORITATIVE tenant resolution for the login flow.
//
// Why this exists: every tenant-scoped API (Education above all) answers
// `400 Tenant context required` unless the signed token carries a trusted
// tenantId, yet a normal login on shipped settings produced a tenant-less
// token — the ONLY path to a claim used to be the optional company selector
// (ENABLE_MULTI_COMPANY_LOGIN + a typed company id). This service decides,
// once, at login, which tenant — if any — the issued token may bind.
//
// Resolution order (fail closed at every step; a tenant is NEVER invented):
//
//   1. SELECTION  — a valid, ACTIVE company already resolved into
//      `req.tenantContext` by companyContext (and membership-checked by the
//      controller when ENABLE_TENANT_USER_MEMBERSHIP is on). Bind exactly
//      that company.
//   2. UNHONORED SELECTION — the client asked for a company that did not
//      resolve (unknown / inactive / selector disabled). We do NOT fall back
//      to anything: a request we refused is never quietly replaced by some
//      other tenant, so a crafted `company` field cannot widen access.
//   3. PLATFORM IDENTITY — platform/Master admins are never auto-bound to a
//      tenant: platform scope and tenant scope stay separate identities.
//      They still select a company explicitly like anyone else.
//   4. DERIVED — the user's server-stored membership (`tenantIds`, the same
//      field tenantMembership.isTenantDenied reads) intersected with ACTIVE
//      companies; for accounts with no membership record, every ACTIVE
//      company. Bind only when exactly ONE candidate exists — that is
//      Solution A: a single-tenant user just logs in and works.
//   5. 0 or >1 candidates → no claim (Solution B: multi-company users must
//      choose explicitly through the selector). Nothing is defaulted to
//      DEFAULT_TENANT_ID and no random tenant is ever assigned.
//
// The value comes exclusively from the company catalog and the stored user
// record — never from query, body, header, or anything else the client can
// write. It is then signed into the JWT by the server, so downstream
// `trustedTenantId(req)` (which reads only the reconstructed server-side
// TenantContext or that signed claim) stays the single source of truth.

const CompanyService = require('./company.service');
const tenantMembership = require('./tenantMembership.service');
const platformAdmin = require('./platformAdmin.service');

const SOURCE = Object.freeze({
  SELECTION: 'selection',
  UNHONORED_SELECTION: 'unhonored-selection',
  PLATFORM_IDENTITY: 'platform-identity',
  DERIVED: 'derived',
  AMBIGUOUS: 'ambiguous',
  NO_CANDIDATE: 'no-candidate'
});

// Returns { tenantId, source }. `tenantId` is a non-empty string only when
// the resolution is unambiguous and honorable; otherwise undefined.
function resolveLoginTenantId(args) {
  const input = args || {};
  const user = input.user;
  const requestedCompany = input.requestedCompany;
  const selectedTenantId = input.selectedTenantId;

  // 1 — explicit, already validated ACTIVE selection.
  if (selectedTenantId !== undefined && selectedTenantId !== null && String(selectedTenantId) !== '') {
    return { tenantId: String(selectedTenantId), source: SOURCE.SELECTION };
  }

  // 2 — an explicit request we refused is never substituted.
  if (requestedCompany !== undefined && requestedCompany !== null && String(requestedCompany) !== '') {
    return { tenantId: undefined, source: SOURCE.UNHONORED_SELECTION };
  }

  // 3 — platform/Master identity is not a tenant identity.
  if (user && user.username && platformAdmin.platformRoleFor(String(user.username))) {
    return { tenantId: undefined, source: SOURCE.PLATFORM_IDENTITY };
  }

  // 4 — derive from server-owned state only, bind when unambiguous.
  const active = CompanyService.getActiveCompanies().map(c => String(c.id));
  const membership = tenantMembership.idsFor(user);
  const candidates = membership.length > 0
    ? membership.filter(id => active.indexOf(id) !== -1)
    : active;

  if (candidates.length === 1) {
    return { tenantId: candidates[0], source: SOURCE.DERIVED };
  }
  return { tenantId: undefined, source: candidates.length === 0 ? SOURCE.NO_CANDIDATE : SOURCE.AMBIGUOUS };
}

module.exports = { SOURCE, resolveLoginTenantId };
