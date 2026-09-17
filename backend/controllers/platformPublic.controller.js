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

// ---------------------------------------------------------------------------
// Public self-service company onboarding hardening:
//   - The caller is ALWAYS unauthenticated here, so a synthetic, non-privileged
//     actor object is passed to the service instead of null. The service uses
//     it ONLY for audit metadata (provisionedBy: 'platform-public-onboarding')
//     — it can never grant roles or permissions: the provisioned admin is
//     hard-coded to the NEW company's Owner with company-scoped membership
//     (tenantIds/tenantRoles of the new tenant), never any existing tenant.
//   - Client-supplied tenantId/role/permission/ownership fields are stripped
//     before the service runs; tenant identity is SERVER-OWNED (companyId is
//     the new tenant's id, validated + deduplicated by the service).
//   - Payload size and field shape are validated BEFORE touching the service
//     (rejects non-objects, oversized bodies, unknown top-level fields).
//   - Enumeration resistance: duplicate company id/code and duplicate username
//     both surface as one generic conflict with no hint which one collided.
//   - Rate limiting (10/h/IP) is applied at the router (provisionLimiter).
// ---------------------------------------------------------------------------
const ALLOWED_PROVISION_FIELDS = [
  'companyName', 'companyId', 'branchName', 'branchCode',
  'adminUsername', 'adminFullName', 'adminPassword',
  'phone', 'email', 'address', 'currency', 'language', 'openingBalance'
];

function _sanitizeProvisionInput(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: 'Request body must be a JSON object' };
  const keys = Object.keys(body);
  if (keys.length > ALLOWED_PROVISION_FIELDS.length + 4) return { error: 'Invalid request payload' };
  const unknown = keys.filter(k => !ALLOWED_PROVISION_FIELDS.includes(k));
  if (unknown.length) return { error: 'Invalid request payload' };
  const input = {};
  for (const key of ALLOWED_PROVISION_FIELDS) {
    if (body[key] !== undefined) input[key] = body[key];
  }
  return { input };
}

const provisionCompany = async function (req, res) {
  try {
    const sanitized = _sanitizeProvisionInput(req.body);
    if (sanitized.error) return error(res, sanitized.error, 400, { code: 'ONBOARDING_INVALID' });

    // Synthetic non-privileged actor for audit metadata ONLY (never null):
    // carries no id/tenantId/role, so it cannot grant anything anywhere.
    const publicActor = { username: 'platform-public-onboarding' };

    const result = await CompanyProvisionService.provision(sanitized.input, publicActor);
    if (result.error) {
      // Duplicate company id/code and duplicate username both surface as one
      // generic conflict — no tenant/username enumeration through onboarding.
      const isConflict = /already exists/i.test(result.error);
      if (isConflict) {
        return error(res, 'Onboarding request could not be completed: the requested identity is unavailable', 409, { code: 'ONBOARDING_CONFLICT' });
      }
      // Validation failures are safe to surface verbatim (field rules only).
      return error(res, result.error, 400, { code: 'ONBOARDING_INVALID' });
    }

    return success(res, {
      company: {
        id: result.company.id,
        name: result.company.name,
        defaultBranch: result.company.defaultBranch
      },
      admin: { username: result.admin.username, role: result.admin.role },
      branch: result.branch,
      openingBalance: result.openingBalance,
      nextStep: 'login'
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
