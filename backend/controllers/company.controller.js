'use strict';

const CompanyService = require('../services/company.service');
const { success, error } = require('../utils/apiResponse');
const config = require('../config');

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

module.exports = { listCompanies, getActive, getById };