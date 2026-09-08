'use strict';

const { success, error } = require('../utils/apiResponse');
const companyProfile = require('../services/companyProfile.service');
const logger = require('../utils/logger');

function notFound(req, res) {
  return error(res, 'Not found', 404);
}

function getProfile(req, res) {
  try {
    const companyId = String(req.params.companyId || '').trim();
    if (!companyId) {
      return error(res, 'Company ID is required', 400);
    }
    const profile = companyProfile.getProfile(companyId);
    if (!profile) {
      return error(res, 'Company profile not found', 404);
    }
    success(res, profile, 'Company profile retrieved');
  } catch (err) {
    logger.error('companyProfile.getProfile error:', err.message);
    error(res, 'Failed to retrieve company profile', 500);
  }
}

function getProfileSection(req, res) {
  try {
    const companyId = String(req.params.companyId || '').trim();
    if (!companyId) {
      return error(res, 'Company ID is required', 400);
    }
    const profile = companyProfile.getProfile(companyId);
    if (!profile) {
      return error(res, 'Company profile not found', 404);
    }
    const section = String(req.params.section || '').trim();
    if (!Object.prototype.hasOwnProperty.call(profile, section)) {
      return error(res, 'Section not found', 404);
    }
    success(res, { [section]: profile[section] }, 'Profile section retrieved');
  } catch (err) {
    logger.error('companyProfile.getProfileSection error:', err.message);
    error(res, 'Failed to retrieve profile section', 500);
  }
}

module.exports = {
  getProfile,
  getProfileSection,
  notFound
};
