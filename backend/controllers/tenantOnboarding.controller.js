'use strict';

const { success, error } = require('../utils/apiResponse');
const tenantOnboarding = require('../services/tenantOnboarding.service');
const logger = require('../utils/logger');

function _resolveTenant(req) {
  if (req.tenantContext && req.tenantContext.tenantId) return { tenantId: String(req.tenantContext.tenantId) };
  if (req.user && req.user.tenantId) return { tenantId: String(req.user.tenantId) };
  return null;
}

async function getStatus(req, res) {
  try {
    const ctx = _resolveTenant(req);
    const status = await tenantOnboarding.getOnboardingStatus(ctx);
    success(res, status, 'Onboarding status retrieved');
  } catch (err) {
    logger.error('tenantOnboarding.getStatus error:', err.message);
    error(res, 'Failed to retrieve onboarding status', 500);
  }
}

async function complete(req, res) {
  try {
    const ctx = _resolveTenant(req);
    const data = req.body || {};
    const result = await tenantOnboarding.completeOnboarding(ctx, data);
    success(res, result, 'Onboarding completed');
  } catch (err) {
    logger.error('tenantOnboarding.complete error:', err.message);
    error(res, err.message || 'Failed to complete onboarding', 400);
  }
}

async function seedDemo(req, res) {
  try {
    const ctx = _resolveTenant(req);
    const data = req.body || {};
    const result = await tenantOnboarding.seedDemoData(ctx, data);
    success(res, result, 'Demo data seeded');
  } catch (err) {
    logger.error('tenantOnboarding.seedDemo error:', err.message);
    error(res, err.message || 'Failed to seed demo data', 400);
  }
}

module.exports = {
  getStatus,
  complete,
  seedDemo
};
