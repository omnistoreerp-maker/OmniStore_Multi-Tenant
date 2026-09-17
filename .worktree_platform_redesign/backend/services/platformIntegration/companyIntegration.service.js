'use strict';

// Platform Integration — Company Contract
//
// ERP is the source of truth for company identity.
// Platform consumes via this contract.
// Platform never writes to the ERP company store.
//
// Authoritative source: backend/services/company.service.js
// Storage: backend/data/companies.json
// Public read API: GET /api/v1/companies (existing, public)

const companyService = require('../company.service');

function _sanitizeCompany(c) {
  if (!c) return null;
  return {
    id: String(c.id || ''),
    code: String(c.code || ''),
    name: String(c.name || ''),
    active: c.active !== false,
    status: c.status || (c.active !== false ? 'ACTIVE' : 'INACTIVE'),
    branches: Array.isArray(c.branches) ? c.branches.map(b => ({
      id: String(b.id || ''),
      name: String(b.name || ''),
      code: String(b.code || ''),
      isDefault: !!b.isDefault,
      active: b.active !== false
    })) : []
  };
}

function getCompanyIdentity(companyId) {
  if (!companyId) return null;
  const raw = companyService.getCompany(companyId);
  return _sanitizeCompany(raw);
}

function listActiveCompanies() {
  const list = companyService.getActiveCompanies();
  return list.map(_sanitizeCompany);
}

function getCompanyBranches(companyId) {
  const company = getCompanyIdentity(companyId);
  if (!company) return [];
  return company.branches;
}

module.exports = {
  getCompanyIdentity,
  listActiveCompanies,
  getCompanyBranches
};
