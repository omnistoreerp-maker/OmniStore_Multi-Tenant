'use strict';

const { success, error } = require('../utils/apiResponse');
const integration = require('../services/platformIntegration');
const logger = require('../utils/logger');

function listCompanies(req, res) {
  try {
    const companies = integration.company.listActiveCompanies();
    success(res, { companies: companies }, 'Active companies retrieved');
  } catch (err) {
    logger.error('marketplace.listCompanies error:', err.message);
    error(res, 'Failed to retrieve companies', 500, { code: 'MARKETPLACE_UNAVAILABLE' });
  }
}

async function listCompanyProducts(req, res) {
  try {
    const companyId = String(req.params.companyId || '').trim();
    if (!companyId) {
      return error(res, 'Company ID is required', 400, { code: 'COMPANY_NOT_FOUND' });
    }
    const company = integration.company.getCompanyIdentity(companyId);
    if (!company) {
      return error(res, 'Company not found', 404, { code: 'COMPANY_NOT_FOUND' });
    }
    if (!company.active) {
      return error(res, 'Company is not active', 404, { code: 'COMPANY_NOT_FOUND' });
    }
    const products = await integration.product.listProducts(req.query || {});
    const activeProducts = products.filter(function (p) { return p.active !== false; });
    success(res, {
      companyId: companyId,
      products: activeProducts
    }, 'Products retrieved');
  } catch (err) {
    logger.error('marketplace.listCompanyProducts error:', err.message);
    error(res, 'Failed to retrieve products', 500, { code: 'MARKETPLACE_UNAVAILABLE' });
  }
}

module.exports = {
  listCompanies,
  listCompanyProducts
};
