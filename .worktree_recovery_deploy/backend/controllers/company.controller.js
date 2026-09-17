'use strict';

const CompanyService = require('../services/company.service');
const CompanyProvisionService = require('../services/companyProvision.service');
const { success, error } = require('../utils/apiResponse');
const config = require('../config');
const logger = require('../utils/logger');

// Read-only company catalog endpoints (public — no authentication required).
// Used by the login UI to populate the company selection dropdown. No mutate
// operations are exposed.
//
// `enabled` reflects ENABLE_MULTI_COMPANY_LOGIN so the login UI knows whether
// to render the company selector; when it is false no selector is shown and the
// login screen behaves exactly as before (backward compatible).

function listCompanies(_req, res) {
  try {
    const companies = CompanyService.listCompanies();
    return success(res, { companies, enabled: config.multiCompanyLoginEnabled }, 'Companies retrieved');
  } catch (err) {
    return error(res, 'Failed to retrieve companies', 500);
  }
}

function getActive(_req, res) {
  try {
    const active = CompanyService.getActiveCompanies();
    return success(res, { companies: active, enabled: config.multiCompanyLoginEnabled }, 'Active companies retrieved');
  } catch (err) {
    return error(res, 'Failed to retrieve active companies', 500);
  }
}

function getById(req, res) {
  try {
    const company = CompanyService.getCompany(req.params.id);
    if (!company) return error(res, 'Company not found', 404);
    return success(res, { company, enabled: config.multiCompanyLoginEnabled }, 'Company retrieved');
  } catch (err) {
    return error(res, 'Failed to retrieve company', 500);
  }
}

// Provision a brand-new, fully independent company/tenant from inside the
// application (Settings → Company Management → تهيئة شركة جديدة). Requires
// authentication + the `company.create` permission (Owner/Admin bypass). The
// new tenant gets its own company record, branch, Owner user with company-
// scoped membership, optional opening treasury balance, and an audit record.
// No data from the caller's tenant is copied; the password is never returned.
async function provision(req, res) {
  try {
    const result = await CompanyProvisionService.provision(req.body || {}, req.user || null);
    if (result.error) return error(res, result.error, 400);
    return success(res, {
      company: result.company,
      admin: result.admin,
      branch: result.branch,
      openingBalance: result.openingBalance
    }, 'Company created successfully', 201);
  } catch (err) {
    logger.error('company.provision error:', err.message);
    return error(res, 'Failed to provision company', 500);
  }
}

module.exports = { listCompanies, getActive, getById, provision };