const suppliersService = require('../services/suppliers.service');
const { success, error } = require('../utils/apiResponse');
const logger = require('../utils/logger');

async function list(req, res) {
  try {
    const result = await suppliersService.list(req.query);
    success(res, result, 'Suppliers retrieved');
  } catch (err) {
    logger.error('suppliers.list error:', err.message);
    error(res, 'Failed to retrieve suppliers', 500);
  }
}

async function getById(req, res) {
  try {
    const supplier = await suppliersService.getById(req.params.id);
    if (!supplier) return error(res, 'Supplier not found', 404);
    success(res, supplier, 'Supplier retrieved');
  } catch (err) {
    logger.error('suppliers.getById error:', err.message);
    error(res, 'Failed to retrieve supplier', 500);
  }
}

async function getStats(req, res) {
  try {
    const result = await suppliersService.stats();
    success(res, result, 'Supplier stats retrieved');
  } catch (err) {
    logger.error('suppliers.stats error:', err.message);
    error(res, 'Failed to retrieve supplier stats', 500);
  }
}

async function create(req, res) {
  try {
    const result = await suppliersService.create(req.body);
    if (result.error) return error(res, result.error, 400);
    success(res, result.supplier, 'Supplier created', 201);
  } catch (err) {
    logger.error('suppliers.create error:', err.message);
    error(res, 'Failed to create supplier', 500);
  }
}

async function update(req, res) {
  try {
    const result = await suppliersService.update(req.params.id, req.body);
    if (result.error === 'Supplier not found') return error(res, result.error, 404);
    if (result.error) return error(res, result.error, 400);
    success(res, result.supplier, 'Supplier updated');
  } catch (err) {
    logger.error('suppliers.update error:', err.message);
    error(res, 'Failed to update supplier', 500);
  }
}

async function remove(req, res) {
  try {
    const result = await suppliersService.delete(req.params.id);
    if (result.error === 'Supplier not found') return error(res, result.error, 404);
    if (result.error) return error(res, result.error, 500);
    success(res, null, 'Supplier deleted');
  } catch (err) {
    logger.error('suppliers.delete error:', err.message);
    error(res, 'Failed to delete supplier', 500);
  }
}

module.exports = { list, getStats, getById, create, update, remove };
