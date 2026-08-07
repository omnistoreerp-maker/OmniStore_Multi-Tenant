const inventoryService = require('../services/inventory.service');
const { success, error } = require('../utils/apiResponse');
const logger = require('../utils/logger');

function list(req, res) {
  try {
    const result = inventoryService.list(req.query);
    success(res, result, 'Products retrieved');
  } catch (err) {
    logger.error('inventory.list error:', err.message);
    error(res, 'Failed to retrieve products', 500);
  }
}

function getById(req, res) {
  try {
    const product = inventoryService.getById(req.params.id);
    if (!product) return error(res, 'Product not found', 404);
    success(res, product, 'Product retrieved');
  } catch (err) {
    logger.error('inventory.getById error:', err.message);
    error(res, 'Failed to retrieve product', 500);
  }
}

function getStats(req, res) {
  try {
    const result = inventoryService.stats();
    success(res, result, 'Product stats retrieved');
  } catch (err) {
    logger.error('inventory.stats error:', err.message);
    error(res, 'Failed to retrieve product stats', 500);
  }
}

function create(req, res) {
  try {
    const result = inventoryService.create(req.body);
    if (result.error) return error(res, result.error, 400);
    success(res, result.product, 'Product created', 201);
  } catch (err) {
    logger.error('inventory.create error:', err.message);
    error(res, 'Failed to create product', 500);
  }
}

function update(req, res) {
  try {
    const result = inventoryService.update(req.params.id, req.body);
    if (result.error === 'Product not found') return error(res, result.error, 404);
    if (result.error) return error(res, result.error, 400);
    success(res, result.product, 'Product updated');
  } catch (err) {
    logger.error('inventory.update error:', err.message);
    error(res, 'Failed to update product', 500);
  }
}

function remove(req, res) {
  try {
    const result = inventoryService.delete(req.params.id);
    if (result.error === 'Product not found') return error(res, result.error, 404);
    if (result.error) return error(res, result.error, 500);
    success(res, null, 'Product deleted');
  } catch (err) {
    logger.error('inventory.delete error:', err.message);
    error(res, 'Failed to delete product', 500);
  }
}

module.exports = { list, getStats, getById, create, update, remove };
