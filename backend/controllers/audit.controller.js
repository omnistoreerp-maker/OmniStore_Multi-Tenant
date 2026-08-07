const auditService = require('../services/audit.service');
const { success, error } = require('../utils/apiResponse');

// GET /api/v1/audit-log — Query audit log
function query(req, res) {
  try {
    const result = auditService.query({
      userId: req.query.userId,
      apiKeyId: req.query.apiKeyId,
      resource: req.query.resource,
      method: req.query.method,
      startDate: req.query.startDate,
      endDate: req.query.endDate,
      page: req.query.page,
      limit: req.query.limit
    });
    return success(res, result, 'Audit log retrieved', 200);
  } catch (err) {
    return error(res, 'Failed to retrieve audit log', 500);
  }
}

// GET /api/v1/audit-log/stats — Get audit statistics
function getStats(req, res) {
  try {
    const stats = auditService.getStats();
    return success(res, stats, 'Audit statistics retrieved');
  } catch (err) {
    return error(res, 'Failed to retrieve audit statistics', 500);
  }
}

// GET /api/v1/audit-log/:id — Get a single audit entry
function getById(req, res) {
  try {
    const entry = auditService.getById(req.params.id);
    if (!entry) return error(res, 'Audit entry not found', 404);
    return success(res, entry, 'Audit entry retrieved');
  } catch (err) {
    return error(res, 'Failed to retrieve audit entry', 500);
  }
}

module.exports = { query, getStats, getById };
