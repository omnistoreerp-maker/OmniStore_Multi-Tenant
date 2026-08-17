const salesService = require('../services/sales.service');
const { success, error } = require('../utils/apiResponse');
const logger = require('../utils/logger');

async function list(req, res) {
  try {
    const result = await salesService.list(req.query, req.tenantContext);
    success(res, result, 'Sales invoices retrieved');
  } catch (err) {
    logger.error('sales.list error:', err.message);
    error(res, 'Failed to retrieve sales invoices', 500);
  }
}

async function getStats(req, res) {
  try {
    const result = await salesService.stats(req.tenantContext);
    success(res, result, 'Sales stats retrieved');
  } catch (err) {
    logger.error('sales.stats error:', err.message);
    error(res, 'Failed to retrieve sales stats', 500);
  }
}

async function getById(req, res) {
  try {
    const inv = await salesService.getById(req.params.id, req.tenantContext);
    if (!inv) return error(res, 'Sale invoice not found', 404);
    success(res, inv, 'Sale invoice retrieved');
  } catch (err) {
    logger.error('sales.getById error:', err.message);
    error(res, 'Failed to retrieve sale invoice', 500);
  }
}

async function create(req, res) {
  try {
    const result = await salesService.create(req.body, req.tenantContext);
    if (result.error) return error(res, result.error, 400);
    success(res, result.invoice, 'Sale invoice created', 201);
  } catch (err) {
    logger.error('sales.create error:', err.message);
    error(res, 'Failed to create sale invoice', 500);
  }
}

async function update(req, res) {
  try {
    const result = await salesService.update(req.params.id, req.body, req.tenantContext);
    if (result.error === 'Invoice not found') return error(res, result.error, 404);
    if (result.error) return error(res, result.error, 400);
    success(res, result.invoice, 'Sale invoice updated');
  } catch (err) {
    logger.error('sales.update error:', err.message);
    error(res, 'Failed to update sale invoice', 500);
  }
}

async function remove(req, res) {
  try {
    const result = await salesService.delete(req.params.id, req.tenantContext);
    if (result.error === 'Invoice not found') return error(res, result.error, 404);
    if (result.error) return error(res, result.error, 500);
    success(res, null, 'Sale invoice deleted');
  } catch (err) {
    logger.error('sales.delete error:', err.message);
    error(res, 'Failed to delete sale invoice', 500);
  }
}

module.exports = { list, getStats, getById, create, update, remove };