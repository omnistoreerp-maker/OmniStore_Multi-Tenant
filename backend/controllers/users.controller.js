const usersService = require('../services/users.service');
const { success, error } = require('../utils/apiResponse');
const logger = require('../utils/logger');

function list(req, res) {
  try {
    const result = usersService.list(req.query);
    result.users = result.users.map(usersService.sanitizeUser);
    success(res, result, 'Users retrieved');
  } catch (err) {
    logger.error('users.list error:', err.message);
    error(res, 'Failed to retrieve users', 500);
  }
}

function getById(req, res) {
  try {
    const user = usersService.getById(req.params.id);
    if (!user) return error(res, 'User not found', 404);
    success(res, usersService.sanitizeUser(user), 'User retrieved');
  } catch (err) {
    logger.error('users.getById error:', err.message);
    error(res, 'Failed to retrieve user', 500);
  }
}

function getStats(req, res) {
  try {
    const result = usersService.stats();
    success(res, result, 'User stats retrieved');
  } catch (err) {
    logger.error('users.stats error:', err.message);
    error(res, 'Failed to retrieve user stats', 500);
  }
}

function create(req, res) {
  try {
    const result = usersService.create(req.body);
    if (result.error) return error(res, result.error, 400);
    success(res, usersService.sanitizeUser(result.user), 'User created', 201);
  } catch (err) {
    logger.error('users.create error:', err.message);
    error(res, 'Failed to create user', 500);
  }
}

function update(req, res) {
  try {
    const result = usersService.update(req.params.id, req.body);
    if (result.error === 'User not found') return error(res, result.error, 404);
    if (result.error) return error(res, result.error, 400);
    success(res, usersService.sanitizeUser(result.user), 'User updated');
  } catch (err) {
    logger.error('users.update error:', err.message);
    error(res, 'Failed to update user', 500);
  }
}

function remove(req, res) {
  try {
    const result = usersService.delete(req.params.id);
    if (result.error === 'User not found') return error(res, result.error, 404);
    if (result.error) return error(res, result.error, 500);
    success(res, null, 'User deleted');
  } catch (err) {
    logger.error('users.remove error:', err.message);
    error(res, 'Failed to delete user', 500);
  }
}

module.exports = { list, getById, getStats, create, update, remove };
