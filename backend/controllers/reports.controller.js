const reportsService = require('../services/reports.service');
const { success, error } = require('../utils/apiResponse');
const logger = require('../utils/logger');

function list(req, res) {
  try {
    const result = reportsService.list(req.query);
    success(res, result, 'Reports retrieved');
  } catch (err) {
    logger.error('reports.list error:', err.message);
    error(res, 'Failed to retrieve reports', 500);
  }
}

function getById(req, res) {
  try {
    const report = reportsService.getById(req.params.id);
    if (!report) return error(res, 'Report not found', 404);
    success(res, report, 'Report retrieved');
  } catch (err) {
    logger.error('reports.getById error:', err.message);
    error(res, 'Failed to retrieve report', 500);
  }
}

function getStats(req, res) {
  try {
    const result = reportsService.stats();
    success(res, result, 'Report stats retrieved');
  } catch (err) {
    logger.error('reports.stats error:', err.message);
    error(res, 'Failed to retrieve report stats', 500);
  }
}

function create(req, res) {
  try {
    const result = reportsService.create(req.body);
    if (result.error) return error(res, result.error, 400);
    success(res, result.report, 'Report created', 201);
  } catch (err) {
    logger.error('reports.create error:', err.message);
    error(res, 'Failed to create report', 500);
  }
}

function update(req, res) {
  try {
    const result = reportsService.update(req.params.id, req.body);
    if (result.error === 'Report not found') return error(res, result.error, 404);
    if (result.error) return error(res, result.error, 400);
    success(res, result.report, 'Report updated');
  } catch (err) {
    logger.error('reports.update error:', err.message);
    error(res, 'Failed to update report', 500);
  }
}

function remove(req, res) {
  try {
    const result = reportsService.delete(req.params.id);
    if (result.error === 'Report not found') return error(res, result.error, 404);
    if (result.error) return error(res, result.error, 500);
    success(res, null, 'Report deleted');
  } catch (err) {
    logger.error('reports.delete error:', err.message);
    error(res, 'Failed to delete report', 500);
  }
}

module.exports = { list, getStats, getById, create, update, remove };
