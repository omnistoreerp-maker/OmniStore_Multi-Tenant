const salesService = require('../services/sales.service');
const { success, error } = require('../utils/apiResponse');
const logger = require('../utils/logger');

function list(req, res) {
  try {
    const result = salesService.list(req.query);
    success(res, result, 'Sales invoices retrieved');
  } catch (err) {
    logger.error('sales.list error:', err.message);
    error(res, 'Failed to retrieve sales invoices', 500);
  }
}

function getStats(req, res) {
  try {
    const result = salesService.stats();
    success(res, result, 'Sales stats retrieved');
  } catch (err) {
    logger.error('sales.stats error:', err.message);
    error(res, 'Failed to retrieve sales stats', 500);
  }
}

function getById(req, res) {
  try {
    const inv = salesService.getById(req.params.id);
    if (!inv) return error(res, 'Sale invoice not found', 404);
    success(res, inv, 'Sale invoice retrieved');
  } catch (err) {
    logger.error('sales.getById error:', err.message);
    error(res, 'Failed to retrieve sale invoice', 500);
  }
}

function create(req, res) {
  try {
    const result = salesService.create(req.body);
    if (result.error) return error(res, result.error, 400);
    success(res, result.invoice, 'Sale invoice created', 201);
  } catch (err) {
    logger.error('sales.create error:', err.message);
    error(res, 'Failed to create sale invoice', 500);
  }
}

function update(req, res) {
  try {
    const result = salesService.update(req.params.id, req.body);
    if (result.error === 'Invoice not found') return error(res, result.error, 404);
    if (result.error) return error(res, result.error, 400);
    success(res, result.invoice, 'Sale invoice updated');
  } catch (err) {
    logger.error('sales.update error:', err.message);
    error(res, 'Failed to update sale invoice', 500);
  }
}

function remove(req, res) {
  try {
    const result = salesService.delete(req.params.id);
    if (result.error === 'Invoice not found') return error(res, result.error, 404);
    if (result.error) return error(res, result.error, 500);
    success(res, null, 'Sale invoice deleted');
  } catch (err) {
    logger.error('sales.delete error:', err.message);
    error(res, 'Failed to delete sale invoice', 500);
  }
}

module.exports = { list, getStats, getById, create, update, remove };