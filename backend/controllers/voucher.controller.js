const voucherService = require('../services/voucher.service');
const { success, error } = require('../utils/apiResponse');
const logger = require('../utils/logger');

async function list(req, res) {
  try {
    const result = await voucherService.list(req.query);
    success(res, result, 'Vouchers retrieved');
  } catch (err) {
    logger.error('vouchers.list error:', err.message);
    error(res, 'Failed to retrieve vouchers', 500);
  }
}

async function getById(req, res) {
  try {
    const voucher = await voucherService.getById(req.params.id);
    if (!voucher) return error(res, 'Voucher not found', 404);
    success(res, voucher, 'Voucher retrieved');
  } catch (err) {
    logger.error('vouchers.getById error:', err.message);
    error(res, 'Failed to retrieve voucher', 500);
  }
}

async function getStats(req, res) {
  try {
    const result = await voucherService.stats();
    success(res, result, 'Voucher stats retrieved');
  } catch (err) {
    logger.error('vouchers.stats error:', err.message);
    error(res, 'Failed to retrieve voucher stats', 500);
  }
}

async function create(req, res) {
  try {
    const result = await voucherService.create(req.body);
    if (result.error) return error(res, result.error, 400);
    success(res, result.voucher, 'Voucher created', 201);
  } catch (err) {
    logger.error('vouchers.create error:', err.message);
    error(res, 'Failed to create voucher', 500);
  }
}

async function update(req, res) {
  try {
    const result = await voucherService.update(req.params.id, req.body);
    if (result.error === 'Voucher not found') return error(res, result.error, 404);
    if (result.error) return error(res, result.error, 400);
    success(res, result.voucher, 'Voucher updated');
  } catch (err) {
    logger.error('vouchers.update error:', err.message);
    error(res, 'Failed to update voucher', 500);
  }
}

async function remove(req, res) {
  try {
    const result = await voucherService.delete(req.params.id);
    if (result.error === 'Voucher not found') return error(res, result.error, 404);
    if (result.error) return error(res, result.error, 500);
    success(res, null, 'Voucher deleted');
  } catch (err) {
    logger.error('vouchers.remove error:', err.message);
    error(res, 'Failed to delete voucher', 500);
  }
}

module.exports = { list, getById, getStats, create, update, remove };
