const inventoryTransactionsService = require('../services/inventoryTransactions.service');
const { success, error } = require('../utils/apiResponse');
const logger = require('../utils/logger');

function list(req, res) {
  try {
    const result = inventoryTransactionsService.list(req.query);
    success(res, result, 'Inventory transactions retrieved');
  } catch (err) {
    logger.error('inventoryTransactions.list error:', err.message);
    error(res, 'Failed to retrieve inventory transactions', 500);
  }
}

function getById(req, res) {
  try {
    const transaction = inventoryTransactionsService.getById(req.params.id);
    if (!transaction) return error(res, 'Transaction not found', 404);
    success(res, transaction, 'Inventory transaction retrieved');
  } catch (err) {
    logger.error('inventoryTransactions.getById error:', err.message);
    error(res, 'Failed to retrieve inventory transaction', 500);
  }
}

function getStats(req, res) {
  try {
    const result = inventoryTransactionsService.stats();
    success(res, result, 'Inventory transaction stats retrieved');
  } catch (err) {
    logger.error('inventoryTransactions.stats error:', err.message);
    error(res, 'Failed to retrieve inventory transaction stats', 500);
  }
}

function create(req, res) {
  try {
    const result = inventoryTransactionsService.create(req.body);
    if (result.error) return error(res, result.error, 400);
    success(res, result.transaction, 'Inventory transaction created', 201);
  } catch (err) {
    logger.error('inventoryTransactions.create error:', err.message);
    error(res, 'Failed to create inventory transaction', 500);
  }
}

function update(req, res) {
  try {
    const result = inventoryTransactionsService.update(req.params.id, req.body);
    if (result.error === 'Transaction not found') return error(res, result.error, 404);
    if (result.error) return error(res, result.error, 400);
    success(res, result.transaction, 'Inventory transaction updated');
  } catch (err) {
    logger.error('inventoryTransactions.update error:', err.message);
    error(res, 'Failed to update inventory transaction', 500);
  }
}

function remove(req, res) {
  try {
    const result = inventoryTransactionsService.delete(req.params.id);
    if (result.error === 'Transaction not found') return error(res, result.error, 404);
    if (result.error) return error(res, result.error, 500);
    success(res, null, 'Inventory transaction deleted');
  } catch (err) {
    logger.error('inventoryTransactions.delete error:', err.message);
    error(res, 'Failed to delete inventory transaction', 500);
  }
}

module.exports = { list, getStats, getById, create, update, remove };
