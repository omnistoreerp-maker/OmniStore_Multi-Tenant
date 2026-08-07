const employeesService = require('../services/employees.service');
const { success, error } = require('../utils/apiResponse');
const logger = require('../utils/logger');

function list(req, res) {
  try {
    const result = employeesService.list(req.query);
    success(res, result, 'Employees retrieved');
  } catch (err) {
    logger.error('employees.list error:', err.message);
    error(res, 'Failed to retrieve employees', 500);
  }
}

function getById(req, res) {
  try {
    const employee = employeesService.getById(req.params.id);
    if (!employee) return error(res, 'Employee not found', 404);
    success(res, employee, 'Employee retrieved');
  } catch (err) {
    logger.error('employees.getById error:', err.message);
    error(res, 'Failed to retrieve employee', 500);
  }
}

function getStats(req, res) {
  try {
    const result = employeesService.stats();
    success(res, result, 'Employee stats retrieved');
  } catch (err) {
    logger.error('employees.stats error:', err.message);
    error(res, 'Failed to retrieve employee stats', 500);
  }
}

function create(req, res) {
  try {
    const result = employeesService.create(req.body);
    if (result.error) return error(res, result.error, 400);
    success(res, result.employee, 'Employee created', 201);
  } catch (err) {
    logger.error('employees.create error:', err.message);
    error(res, 'Failed to create employee', 500);
  }
}

function update(req, res) {
  try {
    const result = employeesService.update(req.params.id, req.body);
    if (result.error === 'Employee not found') return error(res, result.error, 404);
    if (result.error) return error(res, result.error, 400);
    success(res, result.employee, 'Employee updated');
  } catch (err) {
    logger.error('employees.update error:', err.message);
    error(res, 'Failed to update employee', 500);
  }
}

function remove(req, res) {
  try {
    const result = employeesService.delete(req.params.id);
    if (result.error === 'Employee not found') return error(res, result.error, 404);
    if (result.error) return error(res, result.error, 500);
    success(res, null, 'Employee deleted');
  } catch (err) {
    logger.error('employees.delete error:', err.message);
    error(res, 'Failed to delete employee', 500);
  }
}

module.exports = { list, getStats, getById, create, update, remove };
