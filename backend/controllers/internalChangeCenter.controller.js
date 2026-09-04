'use strict';

const { success, error } = require('../utils/apiResponse');
const customerRequest = require('../services/customerRequest.service');
const releaseService = require('../services/release.service');
const logger = require('../utils/logger');

function getDashboard(req, res) {
  try {
    const summary = customerRequest.getDashboardSummary();
    const build = customerRequest.getBuildIdentityPublic();
    success(res, {
      summary: summary,
      currentBuild: build,
      artifactIdentity: customerRequest.getArtifactIdentityPublic()
    }, 'Dashboard retrieved');
  } catch (err) {
    logger.error('internalChangeCenter.dashboard error:', err.message);
    error(res, 'Failed to retrieve dashboard', 500);
  }
}

function listChanges(req, res) {
  try {
    const filters = {
      status: req.query.status,
      companyId: req.query.companyId,
      priority: req.query.priority,
      product: req.query.product,
      historical: req.query.historical
    };
    const requests = customerRequest.listAllForInternal(filters);
    success(res, {
      requests: requests,
      filter: filters,
      companies: customerRequest.listCompaniesWithRequests()
    }, 'Changes retrieved');
  } catch (err) {
    logger.error('internalChangeCenter.list error:', err.message);
    error(res, 'Failed to retrieve changes', 500);
  }
}

function getChange(req, res) {
  try {
    const requestId = String(req.params.id || '').trim();
    if (!requestId) return error(res, 'Request ID is required', 400);
    const found = customerRequest.getByIdForInternal(requestId);
    if (!found) return error(res, 'Request not found', 404);
    const audit = customerRequest.getAuditForRequest(requestId);
    const verifications = customerRequest.getVerificationsForRequest(requestId);
    const timeline = customerRequest.getTimeline(requestId);
    const releaseMatch = customerRequest.verifyReleaseMatches(found);
    success(res, {
      request: found,
      audit: audit,
      verifications: verifications,
      timeline: timeline,
      releaseMatch: releaseMatch,
      currentBuild: customerRequest.getBuildIdentityPublic(),
      artifactIdentity: customerRequest.getArtifactIdentityPublic()
    }, 'Change retrieved');
  } catch (err) {
    logger.error('internalChangeCenter.get error:', err.message);
    error(res, 'Failed to retrieve change', 500);
  }
}

function listReleases(req, res) {
  try {
    const releases = releaseService.listReleases();
    success(res, { releases: releases }, 'Releases retrieved');
  } catch (err) {
    logger.error('internalChangeCenter.releases.list error:', err.message);
    error(res, 'Failed to retrieve releases', 500);
  }
}

function getRelease(req, res) {
  try {
    const releaseId = String(req.params.id || '').trim();
    if (!releaseId) return error(res, 'Release ID is required', 400);
    const found = releaseService.getReleaseById(releaseId);
    if (!found) return error(res, 'Release not found', 404);
    success(res, { release: releaseService.sanitizeForResponse(found) }, 'Release retrieved');
  } catch (err) {
    logger.error('internalChangeCenter.releases.get error:', err.message);
    error(res, 'Failed to retrieve release', 500);
  }
}

function registerRelease(req, res) {
  try {
    const actor = req.platformAdmin ? req.platformAdmin.username : 'system';
    const result = releaseService.registerRelease(Object.assign({}, req.body || {}, { registeredBy: actor }));
    if (result.error) {
      const status = result.code === 'DUPLICATE_ARTIFACT' ? 409 : 400;
      return error(res, result.error, status, result.code ? { code: result.code } : null);
    }
    success(res, { release: releaseService.sanitizeForResponse(result.release) }, 'Release registered', 201);
  } catch (err) {
    logger.error('internalChangeCenter.releases.create error:', err.message);
    error(res, 'Failed to register release', 500);
  }
}

module.exports = {
  getDashboard,
  listChanges,
  getChange,
  listReleases,
  getRelease,
  registerRelease
};
