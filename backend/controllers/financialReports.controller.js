'use strict';

// DAY 4 — Financial reports controller (thin HTTP layer over computed readers).
const service = require('../services/financialReports.service');
const { success, error } = require('../utils/apiResponse');
const logger = require('../utils/logger');

function rangeFromQuery(query) {
  return { from: query && query.from ? String(query.from).slice(0, 10) : undefined, to: query && query.to ? String(query.to).slice(0, 10) : undefined };
}

async function customerStatement(req, res) {
  try {
    const result = await service.customerStatement(req.params.customerId, rangeFromQuery(req.query));
    if (result.error === 'Customer not found') return error(res, result.error, 404);
    if (result.error) return error(res, result.error, 400);
    success(res, result, 'Customer statement retrieved');
  } catch (err) {
    logger.error('financialReports.customerStatement error:', err.message);
    error(res, 'Failed to retrieve customer statement', 500);
  }
}

async function supplierStatement(req, res) {
  try {
    const result = await service.supplierStatement(req.params.supplierId, rangeFromQuery(req.query));
    if (result.error === 'Supplier not found') return error(res, result.error, 404);
    if (result.error) return error(res, result.error, 400);
    success(res, result, 'Supplier statement retrieved');
  } catch (err) {
    logger.error('financialReports.supplierStatement error:', err.message);
    error(res, 'Failed to retrieve supplier statement', 500);
  }
}

async function dailySales(req, res) {
  try {
    success(res, await service.dailySales(rangeFromQuery(req.query)), 'Daily sales retrieved');
  } catch (err) {
    logger.error('financialReports.dailySales error:', err.message);
    error(res, 'Failed to retrieve daily sales', 500);
  }
}

async function dailyPurchases(req, res) {
  try {
    success(res, await service.dailyPurchases(rangeFromQuery(req.query)), 'Daily purchases retrieved');
  } catch (err) {
    logger.error('financialReports.dailyPurchases error:', err.message);
    error(res, 'Failed to retrieve daily purchases', 500);
  }
}

async function cashFlow(req, res) {
  try {
    success(res, await service.cashFlow(rangeFromQuery(req.query)), 'Cash flow retrieved');
  } catch (err) {
    logger.error('financialReports.cashFlow error:', err.message);
    error(res, 'Failed to retrieve cash flow', 500);
  }
}

async function inventorySummary(req, res) {
  try {
    success(res, await service.inventorySummary(rangeFromQuery(req.query)), 'Inventory summary retrieved');
  } catch (err) {
    logger.error('financialReports.inventorySummary error:', err.message);
    error(res, 'Failed to retrieve inventory summary', 500);
  }
}

module.exports = { customerStatement, supplierStatement, dailySales, dailyPurchases, cashFlow, inventorySummary };