const purchaseService = require('../services/purchase.service');
const { success, error } = require('../utils/apiResponse');
const logger = require('../utils/logger');

function list(req, res) {
  try {
    const result = purchaseService.list(req.query);
    success(res, result, 'Purchase invoices retrieved');
  } catch (err) {
    logger.error('purchase.list error:', err.message);
    error(res, 'Failed to retrieve purchase invoices', 500);
  }
}

function getStats(req, res) {
  try {
    const result = purchaseService.stats();
    success(res, result, 'Purchase stats retrieved');
  } catch (err) {
    logger.error('purchase.stats error:', err.message);
    error(res, 'Failed to retrieve purchase stats', 500);
  }
}

function getById(req, res) {
  try {
    const inv = purchaseService.getById(req.params.id);
    if (!inv) return error(res, 'Purchase invoice not found', 404);
    success(res, inv, 'Purchase invoice retrieved');
  } catch (err) {
    logger.error('purchase.getById error:', err.message);
    error(res, 'Failed to retrieve purchase invoice', 500);
  }
}

function create(req, res) {
  try {
    const result = purchaseService.create(req.body);
    if (result.error) return error(res, result.error, 400);
    success(res, result.invoice, 'Purchase invoice created', 201);
  } catch (err) {
    logger.error('purchase.create error:', err.message);
    error(res, 'Failed to create purchase invoice', 500);
  }
}

function update(req, res) {
  try {
    const result = purchaseService.update(req.params.id, req.body);
    if (result.error === 'Invoice not found') return error(res, result.error, 404);
    if (result.error) return error(res, result.error, 400);
    success(res, result.invoice, 'Purchase invoice updated');
  } catch (err) {
    logger.error('purchase.update error:', err.message);
    error(res, 'Failed to update purchase invoice', 500);
  }
}

function remove(req, res) {
  try {
    const result = purchaseService.delete(req.params.id);
    if (result.error === 'Invoice not found') return error(res, result.error, 404);
    if (result.error) return error(res, result.error, 500);
    success(res, null, 'Purchase invoice deleted');
  } catch (err) {
    logger.error('purchase.delete error:', err.message);
    error(res, 'Failed to delete purchase invoice', 500);
  }
}

module.exports = { list, getStats, getById, create, update, remove };