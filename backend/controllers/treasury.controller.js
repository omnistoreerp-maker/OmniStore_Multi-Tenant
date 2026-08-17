const treasuryService = require('../services/treasury.service');
const { success, error } = require('../utils/apiResponse');
const logger = require('../utils/logger');

async function list(req, res) {
  try {
    const result = await treasuryService.list(req.query);
    success(res, result, 'Treasury entries retrieved');
  } catch (err) {
    logger.error('treasury.list error:', err.message);
    error(res, 'Failed to retrieve treasury entries', 500);
  }
}

async function getById(req, res) {
  try {
    const entry = await treasuryService.getById(req.params.id);
    if (!entry) return error(res, 'Treasury entry not found', 404);
    success(res, entry, 'Treasury entry retrieved');
  } catch (err) {
    logger.error('treasury.getById error:', err.message);
    error(res, 'Failed to retrieve treasury entry', 500);
  }
}

async function getStats(req, res) {
  try {
    const result = await treasuryService.stats();
    success(res, result, 'Treasury stats retrieved');
  } catch (err) {
    logger.error('treasury.stats error:', err.message);
    error(res, 'Failed to retrieve treasury stats', 500);
  }
}

async function create(req, res) {
  try {
    const result = await treasuryService.create(req.body);
    if (result.error) return error(res, result.error, 400);
    success(res, result.entry, 'Treasury entry created', 201);
  } catch (err) {
    logger.error('treasury.create error:', err.message);
    error(res, 'Failed to create treasury entry', 500);
  }
}

async function update(req, res) {
  try {
    const result = await treasuryService.update(req.params.id, req.body);
    if (result.error === 'Treasury entry not found') return error(res, result.error, 404);
    if (result.error) return error(res, result.error, 400);
    success(res, result.entry, 'Treasury entry updated');
  } catch (err) {
    logger.error('treasury.update error:', err.message);
    error(res, 'Failed to update treasury entry', 500);
  }
}

async function remove(req, res) {
  try {
    const result = await treasuryService.delete(req.params.id);
    if (result.error === 'Treasury entry not found') return error(res, result.error, 404);
    if (result.error) return error(res, result.error, 500);
    success(res, null, 'Treasury entry deleted');
  } catch (err) {
    logger.error('treasury.delete error:', err.message);
    error(res, 'Failed to delete treasury entry', 500);
  }
}

module.exports = { list, getStats, getById, create, update, remove };
