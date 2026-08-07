const partnersService = require('../services/partners.service');
const { success, error } = require('../utils/apiResponse');
const logger = require('../utils/logger');

function list(req, res) {
  try {
    const result = partnersService.list(req.query);
    success(res, result, 'Partners retrieved');
  } catch (err) {
    logger.error('partners.list error:', err.message);
    error(res, 'Failed to retrieve partners', 500);
  }
}

function getById(req, res) {
  try {
    const partner = partnersService.getById(req.params.id);
    if (!partner) return error(res, 'Partner not found', 404);
    success(res, partner, 'Partner retrieved');
  } catch (err) {
    logger.error('partners.getById error:', err.message);
    error(res, 'Failed to retrieve partner', 500);
  }
}

function getStats(req, res) {
  try {
    const result = partnersService.stats();
    success(res, result, 'Partner stats retrieved');
  } catch (err) {
    logger.error('partners.stats error:', err.message);
    error(res, 'Failed to retrieve partner stats', 500);
  }
}

function create(req, res) {
  try {
    const result = partnersService.create(req.body);
    if (result.error) return error(res, result.error, 400);
    success(res, result.partner, 'Partner created', 201);
  } catch (err) {
    logger.error('partners.create error:', err.message);
    error(res, 'Failed to create partner', 500);
  }
}

function update(req, res) {
  try {
    const result = partnersService.update(req.params.id, req.body);
    if (result.error === 'Partner not found') return error(res, result.error, 404);
    if (result.error) return error(res, result.error, 400);
    success(res, result.partner, 'Partner updated');
  } catch (err) {
    logger.error('partners.update error:', err.message);
    error(res, 'Failed to update partner', 500);
  }
}

function remove(req, res) {
  try {
    const result = partnersService.delete(req.params.id);
    if (result.error === 'Partner not found') return error(res, result.error, 404);
    if (result.error) return error(res, result.error, 500);
    success(res, null, 'Partner deleted');
  } catch (err) {
    logger.error('partners.delete error:', err.message);
    error(res, 'Failed to delete partner', 500);
  }
}

module.exports = { list, getStats, getById, create, update, remove };
