'use strict';

// DAY 3 — Customer payments controller (thin HTTP layer over the service).
const service = require('../services/customerPayments.service');
const { success, error } = require('../utils/apiResponse');
const logger = require('../utils/logger');

async function list(req, res) {
  try {
    const result = await service.list(req.query);
    success(res, result, 'Customer payments retrieved');
  } catch (err) {
    logger.error('customerPayments.list error:', err.message);
    error(res, 'Failed to retrieve customer payments', 500);
  }
}

async function getStats(req, res) {
  try {
    success(res, await service.stats(), 'Customer payment stats retrieved');
  } catch (err) {
    logger.error('customerPayments.stats error:', err.message);
    error(res, 'Failed to retrieve customer payment stats', 500);
  }
}

async function ledger(req, res) {
  try {
    const result = await service.ledger(req.params.customerId);
    if (result.error === 'Customer not found') return error(res, result.error, 404);
    if (result.error) return error(res, result.error, 400);
    success(res, result, 'Customer ledger retrieved');
  } catch (err) {
    logger.error('customerPayments.ledger error:', err.message);
    error(res, 'Failed to retrieve customer ledger', 500);
  }
}

async function getById(req, res) {
  try {
    const payment = await service.getById(req.params.id);
    if (!payment) return error(res, 'Customer payment not found', 404);
    success(res, payment, 'Customer payment retrieved');
  } catch (err) {
    logger.error('customerPayments.getById error:', err.message);
    error(res, 'Failed to retrieve customer payment', 500);
  }
}

async function create(req, res) {
  try {
    const result = await service.create(req.body);
    if (result.error === 'Customer not found') return error(res, result.error, 404);
    if (result.error) return error(res, result.error, 400);
    success(res, result.payment, 'Customer payment recorded', 201);
  } catch (err) {
    logger.error('customerPayments.create error:', err.message);
    error(res, 'Failed to record customer payment', 500);
  }
}

async function update(req, res) {
  try {
    const result = await service.update(req.params.id, req.body);
    if (result.error === 'Customer payment not found' || result.error === 'Customer not found') return error(res, result.error, 404);
    if (result.error) return error(res, result.error, 400);
    success(res, result.payment, 'Customer payment updated');
  } catch (err) {
    logger.error('customerPayments.update error:', err.message);
    error(res, 'Failed to update customer payment', 500);
  }
}

async function remove(req, res) {
  try {
    const result = await service.delete(req.params.id);
    if (result.error) return error(res, result.error, result.error === 'Customer payment not found' ? 404 : 400);
    success(res, result, 'Customer payment deleted');
  } catch (err) {
    logger.error('customerPayments.remove error:', err.message);
    error(res, 'Failed to delete customer payment', 500);
  }
}

module.exports = { list, getStats, ledger, getById, create, update, remove };