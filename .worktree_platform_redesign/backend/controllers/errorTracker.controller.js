const errorTracker = require('../services/errorTracker.service');
const { success, error } = require('../utils/apiResponse');

function list(req, res) {
  const issues = errorTracker.list({
    status: req.query.status,
    level: req.query.level,
    limit: parseInt(req.query.limit, 10) || 50
  });
  return success(res, issues, 'Errors retrieved');
}

function getById(req, res) {
  const issue = errorTracker.getById(req.params.id);
  if (!issue) return error(res, 'Error not found', 404);
  return success(res, issue, 'Error retrieved');
}

function setStatus(req, res) {
  const issue = errorTracker.setStatus(req.params.id, req.body.status);
  if (issue === null) return error(res, 'Error not found', 404);
  if (issue.error) return error(res, issue.error, 400);
  return success(res, issue, 'Error status updated');
}

function getStats(req, res) {
  return success(res, errorTracker.getStats(), 'Error statistics retrieved');
}

module.exports = { list, getById, setStatus, getStats };