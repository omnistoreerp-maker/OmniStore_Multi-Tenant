const customersService = require('../services/customers.service');
const { success, error } = require('../utils/apiResponse');
const logger = require('../utils/logger');

function list(req, res) {
  try {
    const result = customersService.list(req.query);
    success(res, result, 'Customers retrieved');
  } catch (err) {
    logger.error('customers.list error:', err.message);
    error(res, 'Failed to retrieve customers', 500);
  }
}

function getById(req, res) {
  try {
    const customer = customersService.getById(req.params.id);
    if (!customer) return error(res, 'Customer not found', 404);
    success(res, customer, 'Customer retrieved');
  } catch (err) {
    logger.error('customers.getById error:', err.message);
    error(res, 'Failed to retrieve customer', 500);
  }
}

function getStats(req, res) {
  try {
    const result = customersService.stats();
    success(res, result, 'Customer stats retrieved');
  } catch (err) {
    logger.error('customers.stats error:', err.message);
    error(res, 'Failed to retrieve customer stats', 500);
  }
}

function create(req, res) {
  try {
    const result = customersService.create(req.body);
    if (result.error) return error(res, result.error, 400);
    success(res, result.customer, 'Customer created', 201);
  } catch (err) {
    logger.error('customers.create error:', err.message);
    error(res, 'Failed to create customer', 500);
  }
}

function update(req, res) {
  try {
    const result = customersService.update(req.params.id, req.body);
    if (result.error === 'Customer not found') return error(res, result.error, 404);
    if (result.error) return error(res, result.error, 400);
    success(res, result.customer, 'Customer updated');
  } catch (err) {
    logger.error('customers.update error:', err.message);
    error(res, 'Failed to update customer', 500);
  }
}

function remove(req, res) {
  try {
    const result = customersService.delete(req.params.id);
    if (result.error === 'Customer not found') return error(res, result.error, 404);
    if (result.error) return error(res, result.error, 500);
    success(res, null, 'Customer deleted');
  } catch (err) {
    logger.error('customers.delete error:', err.message);
    error(res, 'Failed to delete customer', 500);
  }
}

module.exports = { list, getStats, getById, create, update, remove };
