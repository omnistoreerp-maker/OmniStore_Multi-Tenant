'use strict';

const loyaltyService = require('../services/loyalty.service');
const { success, error } = require('../utils/apiResponse');
const logger = require('../utils/logger');

async function getBalance(req, res) {
  try {
    const { customerId } = req.params;
    if (!customerId) return error(res, 'customerId is required', 400);
    const result = await loyaltyService.getBalance(customerId);
    if (result.error) return error(res, result.error, 404);
    return success(res, result);
  } catch (err) {
    logger.error('loyalty.balance error:', err.message);
    return error(res, 'Failed to retrieve loyalty balance', 500);
  }
}

async function getTransactions(req, res) {
  try {
    const { customerId } = req.params;
    if (!customerId) return error(res, 'customerId is required', 400);
    const query = {
      type: req.query.type,
      ref: req.query.ref,
      refType: req.query.refType,
      startDate: req.query.startDate,
      endDate: req.query.endDate,
      page: req.query.page,
      limit: req.query.limit
    };
    const result = await loyaltyService.getTransactions(customerId, query);
    if (result.error) return error(res, result.error, 404);
    return success(res, result);
  } catch (err) {
    logger.error('loyalty.transactions error:', err.message);
    return error(res, 'Failed to retrieve loyalty transactions', 500);
  }
}

async function earn(req, res) {
  try {
    const ctx = {
      customerId: req.body.customerId,
      points: req.body.points,
      amount: req.body.amount,
      ref: req.body.ref,
      refType: req.body.refType || 'sale',
      note: req.body.note,
      branchId: req.body.branchId,
      source: req.body.source || 'pos',
      userId: req.user ? req.user.id : null,
      userName: req.user ? (req.user.fullName || req.user.username) : null
    };
    const result = await loyaltyService.earn(ctx);
    if (result.error) return error(res, result.error, 400);
    return success(res, result, result.duplicate ? 'Transaction already exists' : 'Points earned', result.duplicate ? 200 : 201);
  } catch (err) {
    logger.error('loyalty.earn error:', err.message);
    return error(res, 'Failed to earn points', 500);
  }
}

async function redeem(req, res) {
  try {
    const ctx = {
      customerId: req.body.customerId,
      points: req.body.points,
      amount: req.body.amount,
      ref: req.body.ref,
      refType: req.body.refType || 'manual',
      note: req.body.note,
      branchId: req.body.branchId,
      source: req.body.source || 'pos',
      userId: req.user ? req.user.id : null,
      userName: req.user ? (req.user.fullName || req.user.username) : null
    };
    const result = await loyaltyService.redeem(ctx);
    if (result.error) return error(res, result.error, 400);
    return success(res, result, result.duplicate ? 'Transaction already exists' : 'Points redeemed', result.duplicate ? 200 : 200);
  } catch (err) {
    logger.error('loyalty.redeem error:', err.message);
    return error(res, 'Failed to redeem points', 500);
  }
}

async function reverse(req, res) {
  try {
    const ctx = {
      customerId: req.body.customerId,
      originalSaleId: req.body.originalSaleId,
      returnId: req.body.returnId,
      refundAmount: req.body.refundAmount,
      note: req.body.note,
      branchId: req.body.branchId,
      userId: req.user ? req.user.id : null,
      userName: req.user ? (req.user.fullName || req.user.username) : null
    };
    const result = await loyaltyService.reverse(ctx);
    if (result.error) return error(res, result.error, 400);
    return success(res, result, result.duplicate ? 'Reversal already exists' : 'Points reversed', result.duplicate ? 200 : 200);
  } catch (err) {
    logger.error('loyalty.reverse error:', err.message);
    return error(res, 'Failed to reverse points', 500);
  }
}

async function getConfig(req, res) {
  try {
    const result = await loyaltyService.getConfig();
    return success(res, result);
  } catch (err) {
    logger.error('loyalty.config error:', err.message);
    return error(res, 'Failed to retrieve loyalty config', 500);
  }
}

async function updateConfig(req, res) {
  try {
    const result = await loyaltyService.updateConfig(req.body);
    if (result.error) return error(res, result.error, 400);
    return success(res, result.config);
  } catch (err) {
    logger.error('loyalty.config update error:', err.message);
    return error(res, 'Failed to update loyalty config', 500);
  }
}

async function getMetrics(req, res) {
  try {
    const result = await loyaltyService.getMetrics();
    return success(res, result);
  } catch (err) {
    logger.error('loyalty.metrics error:', err.message);
    return error(res, 'Failed to retrieve loyalty metrics', 500);
  }
}

module.exports = {
  getBalance,
  getTransactions,
  earn,
  redeem,
  reverse,
  getConfig,
  updateConfig,
  getMetrics
};
