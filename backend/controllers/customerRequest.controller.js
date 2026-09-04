'use strict';

const { success, error } = require('../utils/apiResponse');
const customerRequest = require('../services/customerRequest.service');
const logger = require('../utils/logger');

function _resolveCompanyId(req) {
  if (req.user && req.user.tenantId) return String(req.user.tenantId);
  if (req.tenantContext && req.tenantContext.tenantId) return String(req.tenantContext.tenantId);
  return null;
}

function _ensureHistorical(req, res) {
  const companyId = _resolveCompanyId(req);
  if (companyId) {
    try {
      customerRequest.ensureHistoricalForCompany(companyId);
    } catch (err) {
      logger.warn('customerRequest: historical import warning', err.message);
    }
  }
  return companyId;
}

function listRequests(req, res) {
  try {
    const companyId = _ensureHistorical(req, res);
    if (!companyId) return error(res, 'Unable to determine company context', 401);
    const requests = customerRequest.listForCompany(companyId);
    success(res, { requests: requests, currentBuild: customerRequest.getBuildIdentityPublic() }, 'Requests retrieved');
  } catch (err) {
    logger.error('customerRequest.list error:', err.message);
    error(res, 'Failed to retrieve requests', 500);
  }
}

function getRequest(req, res) {
  try {
    const companyId = _ensureHistorical(req, res);
    if (!companyId) return error(res, 'Unable to determine company context', 401);
    const requestId = String(req.params.id || '').trim();
    if (!requestId) return error(res, 'Request ID is required', 400);
    const found = customerRequest.getByIdForCompany(companyId, requestId);
    if (!found) return error(res, 'Request not found', 404);
    const audit = customerRequest.getAuditForRequest(requestId);
    const verifications = customerRequest.getVerificationsForRequest(requestId);
    const releaseMatch = customerRequest.verifyReleaseMatches(found);
    success(res, {
      request: found,
      audit: audit,
      verifications: verifications,
      releaseMatch: releaseMatch,
      currentBuild: customerRequest.getBuildIdentityPublic()
    }, 'Request retrieved');
  } catch (err) {
    logger.error('customerRequest.get error:', err.message);
    error(res, 'Failed to retrieve request', 500);
  }
}

function createRequest(req, res) {
  try {
    const companyId = _ensureHistorical(req, res);
    if (!companyId) return error(res, 'Unable to determine company context', 401);
    const branchId = (req.user && req.user.branchId) ? String(req.user.branchId) : null;
    const result = customerRequest.createRequest(companyId, branchId, req.user, req.body || {});
    if (result.error) return error(res, result.error, 400, result.code ? { code: result.code } : null);
    success(res, { request: result.request }, 'Request created', 201);
  } catch (err) {
    logger.error('customerRequest.create error:', err.message);
    error(res, 'Failed to create request', 500);
  }
}

function transitionStatus(req, res) {
  try {
    const companyId = _ensureHistorical(req, res);
    if (!companyId) return error(res, 'Unable to determine company context', 401);
    const requestId = String(req.params.id || '').trim();
    if (!requestId) return error(res, 'Request ID is required', 400);
    const body = req.body || {};
    const toStatus = String(body.toStatus || '').toUpperCase();
    const actor = body.actor || (req.user ? req.user.username : 'unknown');
    const note = body.note || '';
    const releaseId = body.releaseId || null;
    const result = customerRequest.transitionStatus(companyId, requestId, toStatus, actor, 'internal', note, releaseId);
    if (result.error) {
      const status = result.code === 'REQUEST_NOT_FOUND' ? 404 : 400;
      return error(res, result.error, status, result.code ? { code: result.code } : null);
    }
    success(res, { request: result.request }, 'Status transitioned');
  } catch (err) {
    logger.error('customerRequest.transition error:', err.message);
    error(res, 'Failed to transition status', 500);
  }
}

function verifyRequest(req, res) {
  try {
    const companyId = _ensureHistorical(req, res);
    if (!companyId) return error(res, 'Unable to determine company context', 401);
    const requestId = String(req.params.id || '').trim();
    if (!requestId) return error(res, 'Request ID is required', 400);
    const result = String((req.body || {}).result || '').toUpperCase();
    const note = (req.body || {}).note || '';
    const verifyResult = customerRequest.verifyRequest(companyId, requestId, req.user, result, note);
    if (verifyResult.error) {
      const status = verifyResult.code === 'REQUEST_NOT_FOUND' ? 404
        : verifyResult.code === 'RELEASE_BUILD_MISMATCH' ? 409
        : verifyResult.code === 'VERIFICATION_NOT_ALLOWED' ? 409
        : 400;
      return error(res, verifyResult.error, status, verifyResult.code ? { code: verifyResult.code } : null);
    }
    success(res, { request: verifyResult.request, verification: verifyResult.verification }, 'Verification recorded');
  } catch (err) {
    logger.error('customerRequest.verify error:', err.message);
    error(res, 'Failed to record verification', 500);
  }
}

function reopenRequest(req, res) {
  try {
    const companyId = _ensureHistorical(req, res);
    if (!companyId) return error(res, 'Unable to determine company context', 401);
    const requestId = String(req.params.id || '').trim();
    if (!requestId) return error(res, 'Request ID is required', 400);
    const note = (req.body || {}).note || '';
    const result = customerRequest.reopenRequest(companyId, requestId, req.user, note);
    if (result.error) {
      const status = result.code === 'REQUEST_NOT_FOUND' ? 404 : 400;
      return error(res, result.error, status, result.code ? { code: result.code } : null);
    }
    success(res, { request: result.request }, 'Request reopened');
  } catch (err) {
    logger.error('customerRequest.reopen error:', err.message);
    error(res, 'Failed to reopen request', 500);
  }
}

function getBuildIdentity(req, res) {
  try {
    success(res, { build: customerRequest.getBuildIdentityPublic() }, 'Build identity retrieved');
  } catch (err) {
    error(res, 'Failed to retrieve build identity', 500);
  }
}

module.exports = {
  listRequests,
  getRequest,
  createRequest,
  transitionStatus,
  verifyRequest,
  reopenRequest,
  getBuildIdentity
};
