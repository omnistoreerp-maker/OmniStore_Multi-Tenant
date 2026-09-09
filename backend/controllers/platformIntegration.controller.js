'use strict';

const { success, error } = require('../utils/apiResponse');
const integration = require('../services/platformIntegration');
const logger = require('../utils/logger');

function getCompany(req, res) {
  try {
    const companyId = String(req.params.companyId || '').trim();
    if (!companyId) return error(res, 'Company ID is required', 400, { code: 'COMPANY_NOT_FOUND' });
    const company = integration.company.getCompanyIdentity(companyId);
    if (!company) return error(res, 'Company not found', 404, { code: 'COMPANY_NOT_FOUND' });
    success(res, { company: company }, 'Company identity retrieved');
  } catch (err) {
    logger.error('platformIntegration.getCompany error:', err.message);
    error(res, 'Failed to retrieve company identity', 500, { code: 'INTEGRATION_UNAVAILABLE' });
  }
}

function listActiveCompanies(req, res) {
  try {
    const companies = integration.company.listActiveCompanies();
    success(res, { companies: companies }, 'Active companies retrieved');
  } catch (err) {
    logger.error('platformIntegration.listCompanies error:', err.message);
    error(res, 'Failed to retrieve companies', 500, { code: 'INTEGRATION_UNAVAILABLE' });
  }
}

async function listProducts(req, res) {
  try {
    const companyId = String(req.params.companyId || '').trim();
    if (!companyId) return error(res, 'Company ID is required', 400, { code: 'COMPANY_NOT_FOUND' });
    const company = integration.company.getCompanyIdentity(companyId);
    if (!company) return error(res, 'Company not found', 404, { code: 'COMPANY_NOT_FOUND' });
    if (!company.active) return error(res, 'Company is not active', 404, { code: 'COMPANY_NOT_FOUND' });
    const products = await integration.product.listProducts(req.query || {});
    success(res, {
      companyId: companyId,
      products: products
    }, 'Products retrieved');
  } catch (err) {
    logger.error('platformIntegration.listProducts error:', err.message);
    error(res, 'Failed to retrieve products', 500, { code: 'INTEGRATION_UNAVAILABLE' });
  }
}

async function getProduct(req, res) {
  try {
    const companyId = String(req.params.companyId || '').trim();
    if (!companyId) return error(res, 'Company ID is required', 400, { code: 'COMPANY_NOT_FOUND' });
    const productId = String(req.params.productId || '').trim();
    if (!productId) return error(res, 'Product ID is required', 400, { code: 'PRODUCT_NOT_FOUND' });
    const product = await integration.product.getProductById(productId);
    if (!product) return error(res, 'Product not found', 404, { code: 'PRODUCT_NOT_FOUND' });
    const availability = await integration.availability.getAvailability(productId);
    success(res, {
      companyId: companyId,
      product: product,
      availability: availability
    }, 'Product retrieved');
  } catch (err) {
    logger.error('platformIntegration.getProduct error:', err.message);
    error(res, 'Failed to retrieve product', 500, { code: 'INTEGRATION_UNAVAILABLE' });
  }
}

function listServices(req, res) {
  try {
    const companyId = String(req.params.companyId || '').trim();
    if (!companyId) return error(res, 'Company ID is required', 400, { code: 'COMPANY_NOT_FOUND' });
    const company = integration.company.getCompanyIdentity(companyId);
    if (!company) return error(res, 'Company not found', 404, { code: 'COMPANY_NOT_FOUND' });
    const catalog = integration.service.getServiceCatalog(companyId);
    success(res, {
      companyId: companyId,
      services: catalog.services,
      available: catalog.available,
      reason: catalog.reason,
      message: catalog.message
    }, 'Service catalog retrieved');
  } catch (err) {
    logger.error('platformIntegration.listServices error:', err.message);
    error(res, 'Failed to retrieve service catalog', 500, { code: 'INTEGRATION_UNAVAILABLE' });
  }
}

function listOffers(req, res) {
  try {
    const companyId = String(req.params.companyId || '').trim();
    if (!companyId) return error(res, 'Company ID is required', 400, { code: 'COMPANY_NOT_FOUND' });
    const company = integration.company.getCompanyIdentity(companyId);
    if (!company) return error(res, 'Company not found', 404, { code: 'COMPANY_NOT_FOUND' });
    const offers = integration.offer.getOffers(companyId);
    success(res, {
      companyId: companyId,
      offers: offers.offers,
      available: offers.available,
      reason: offers.reason,
      message: offers.message
    }, 'Offers retrieved');
  } catch (err) {
    logger.error('platformIntegration.listOffers error:', err.message);
    error(res, 'Failed to retrieve offers', 500, { code: 'INTEGRATION_UNAVAILABLE' });
  }
}

async function getAvailability(req, res) {
  try {
    const companyId = String(req.params.companyId || '').trim();
    if (!companyId) return error(res, 'Company ID is required', 400, { code: 'COMPANY_NOT_FOUND' });
    const productId = String(req.params.productId || '').trim();
    if (!productId) return error(res, 'Product ID is required', 400, { code: 'PRODUCT_NOT_FOUND' });
    const company = integration.company.getCompanyIdentity(companyId);
    if (!company) return error(res, 'Company not found', 404, { code: 'COMPANY_NOT_FOUND' });
    const availability = await integration.availability.getAvailabilityForCompany(companyId, productId);
    success(res, {
      companyId: companyId,
      productId: productId,
      availability: availability
    }, 'Availability retrieved');
  } catch (err) {
    logger.error('platformIntegration.getAvailability error:', err.message);
    error(res, 'Failed to retrieve availability', 500, { code: 'INTEGRATION_UNAVAILABLE' });
  }
}

module.exports = {
  getCompany,
  listActiveCompanies,
  listProducts,
  getProduct,
  listServices,
  listOffers,
  getAvailability
};
