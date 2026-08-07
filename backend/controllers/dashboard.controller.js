const dashboardService = require('../services/dashboard.service');
const { success, error } = require('../utils/apiResponse');
const logger = require('../utils/logger');

function list(req, res) {
  try {
    const result = dashboardService.list(req.query);
    success(res, result, 'Dashboard entries retrieved');
  } catch (err) {
    logger.error('dashboard.list error:', err.message);
    error(res, 'Failed to retrieve dashboard entries', 500);
  }
}

function getById(req, res) {
  try {
    const entry = dashboardService.getById(req.params.id);
    if (!entry) return error(res, 'Dashboard entry not found', 404);
    success(res, entry, 'Dashboard entry retrieved');
  } catch (err) {
    logger.error('dashboard.getById error:', err.message);
    error(res, 'Failed to retrieve dashboard entry', 500);
  }
}

function getStats(req, res) {
  try {
    const result = dashboardService.stats();
    success(res, result, 'Dashboard stats retrieved');
  } catch (err) {
    logger.error('dashboard.stats error:', err.message);
    error(res, 'Failed to retrieve dashboard stats', 500);
  }
}

function create(req, res) {
  try {
    const result = dashboardService.create(req.body);
    if (result.error) return error(res, result.error, 400);
    success(res, result.entry, 'Dashboard entry created', 201);
  } catch (err) {
    logger.error('dashboard.create error:', err.message);
    error(res, 'Failed to create dashboard entry', 500);
  }
}

function update(req, res) {
  try {
    const result = dashboardService.update(req.params.id, req.body);
    if (result.error === 'Dashboard entry not found') return error(res, result.error, 404);
    if (result.error) return error(res, result.error, 400);
    success(res, result.entry, 'Dashboard entry updated');
  } catch (err) {
    logger.error('dashboard.update error:', err.message);
    error(res, 'Failed to update dashboard entry', 500);
  }
}

function remove(req, res) {
  try {
    const result = dashboardService.delete(req.params.id);
    if (result.error) return error(res, result.error, 404);
    success(res, null, 'Dashboard entry deleted');
  } catch (err) {
    logger.error('dashboard.remove error:', err.message);
    error(res, 'Failed to delete dashboard entry', 500);
  }
}

module.exports = { list, getById, getStats, create, update, remove };
