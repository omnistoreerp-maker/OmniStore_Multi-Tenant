const partnersService = require('../services/partners.service');
const { success, error } = require('../utils/apiResponse');
const logger = require('../utils/logger');

async function list(req, res) {
  try {
    const result = await partnersService.list(req.query);
    success(res, result, 'Partners retrieved');
  } catch (err) {
    logger.error('partners.list error:', err.message);
    error(res, 'Failed to retrieve partners', 500);
  }
}

async function getById(req, res) {
  try {
    const partner = await partnersService.getById(req.params.id);
    if (!partner) return error(res, 'Partner not found', 404);
    success(res, partner, 'Partner retrieved');
  } catch (err) {
    logger.error('partners.getById error:', err.message);
    error(res, 'Failed to retrieve partner', 500);
  }
}

async function getStats(req, res) {
  try {
    const result = await partnersService.stats();
    success(res, result, 'Partner stats retrieved');
  } catch (err) {
    logger.error('partners.stats error:', err.message);
    error(res, 'Failed to retrieve partner stats', 500);
  }
}

async function create(req, res) {
  try {
    const result = await partnersService.create(req.body);
    if (result.error) return error(res, result.error, 400);
    success(res, result.partner, 'Partner created', 201);
  } catch (err) {
    logger.error('partners.create error:', err.message);
    error(res, 'Failed to create partner', 500);
  }
}

async function update(req, res) {
  try {
    const result = await partnersService.update(req.params.id, req.body);
    if (result.error === 'Partner not found') return error(res, result.error, 404);
    if (result.error) return error(res, result.error, 400);
    success(res, result.partner, 'Partner updated');
  } catch (err) {
    logger.error('partners.update error:', err.message);
    error(res, 'Failed to update partner', 500);
  }
}

async function remove(req, res) {
  try {
    const result = await partnersService.delete(req.params.id);
    if (result.error === 'Partner not found') return error(res, result.error, 404);
    if (result.error) return error(res, result.error, 500);
    success(res, null, 'Partner deleted');
  } catch (err) {
    logger.error('partners.remove error:', err.message);
    error(res, 'Failed to delete partner', 500);
  }
}

module.exports = { list, getStats, getById, create, update, remove };
