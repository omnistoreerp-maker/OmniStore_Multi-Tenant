'use strict';

const { success, error } = require('../utils/apiResponse');
const platformCatalog = require('../services/platformCatalog.service');
const platformActivity = require('../services/platformActivity.service');
const CompanyProvisionService = require('../services/companyProvision.service');
const pricingPlans = require('../config/pricingPlans');
const paymentService = require('../services/tenantPayments.service');
const logger = require('../utils/logger');

function notFound(req, res) {
  return error(res, 'Not found', 404);
}

function getCatalog(req, res) {
  try {
    const data = platformCatalog.getCatalog();
    success(res, data, 'Platform catalog retrieved');
  } catch (err) {
    error(res, 'Failed to retrieve platform catalog', 500);
  }
}

function getFeatures(req, res) {
  try {
    const data = platformCatalog.getCatalog();
    success(res, { features: data.features || [] }, 'Features retrieved');
  } catch (err) {
    error(res, 'Failed to retrieve features', 500);
  }
}

function getStats(req, res) {
  try {
    const stats = platformActivity.getStats();
    success(res, stats, 'Stats retrieved');
  } catch (err) {
    error(res, 'Failed to retrieve stats', 500);
  }
}

function getHighlights(req, res) {
  try {
    const data = platformCatalog.getCatalog();
    success(res, { highlights: data.highlights || [] }, 'Highlights retrieved');
  } catch (err) {
    error(res, 'Failed to retrieve highlights', 500);
  }
}

function getSections(req, res) {
  try {
    const data = platformCatalog.getCatalog();
    success(res, { sections: data.sections || [] }, 'Sections retrieved');
  } catch (err) {
    error(res, 'Failed to retrieve sections', 500);
  }
}

function getPricing(req, res) {
  try {
    const planKey = req.query && req.query.planKey;
    const popular = req.query && req.query.popular === 'true';
    if (popular) {
      const plan = pricingPlans.getPopular();
      if (!plan) return success(res, { plan: null }, 'No popular plan found');
      return success(res, { plan }, 'Popular plan retrieved');
    }
    if (planKey) {
      const plan = pricingPlans.getByKey(planKey);
      if (!plan) return error(res, 'Plan not found', 404);
      return success(res, { plan }, 'Plan retrieved');
    }
    const plans = pricingPlans.getAll();
    success(res, { plans }, 'Pricing plans retrieved');
  } catch (err) {
    error(res, 'Failed to retrieve pricing plans', 500);
  }
}

function activityHeartbeat(req, res) {
  try {
    const visitorId = req.body && req.body.visitorId;
    if (!visitorId) return error(res, 'visitorId is required', 400);
    const result = platformActivity.heartbeat(String(visitorId).trim());
    if (result.error) return error(res, result.error, 400);
    return success(res, { ok: true }, 'Heartbeat received');
  } catch (err) {
    logger.error('platformPublic.activityHeartbeat error:', err.message);
    return error(res, 'Failed to record heartbeat', 500);
  }
}

const provisionCompany = async function (req, res) {
  try {
    const input = req.body || {};
    const result = await CompanyProvisionService.provision(input, null);
    if (result.error) return error(res, result.error, 400);
    return success(res, {
      company: result.company,
      admin: result.admin,
      branch: result.branch,
      openingBalance: result.openingBalance
    }, 'Company created successfully', 201);
  } catch (err) {
    logger.error('platformPublic.provisionCompany error:', err.message);
    return error(res, 'Failed to create company', 500);
  }
};

async function createPublicPaymentIntent(req, res) {
  try {
    const { addonKey, amount, currency, gateway, metadata } = req.body || {};
    const record = await paymentService.createPaymentIntent({
      tenantId: null,
      addonKey,
      amount,
      currency,
      gateway,
      metadata
    });
    success(res, record, 'Public payment intent created');
  } catch (err) {
    logger.error('platformPublic.createPublicPaymentIntent error:', err.message);
    error(res, err.message || 'Failed to create payment intent', 400);
  }
}

module.exports = {
  getCatalog,
  getFeatures,
  getStats,
  getHighlights,
  getSections,
  getPricing,
  activityHeartbeat,
  provisionCompany,
  createPublicPaymentIntent,
  notFound
};
