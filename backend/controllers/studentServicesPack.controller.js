'use strict';

const { success, error } = require('../utils/apiResponse');
const studentServicesPack = require('../services/studentServicesPack.service');
const logger = require('../utils/logger');

function _resolveTenantId(req) {
  if (req.tenantContext && req.tenantContext.tenantId) return String(req.tenantContext.tenantId);
  if (req.user && req.user.tenantId) return String(req.user.tenantId);
  return null;
}

function listRates(req, res) {
  try {
    const tenantId = _resolveTenantId(req);
    if (!tenantId) return error(res, 'Tenant context required', 400);
    const rates = studentServicesPack.listRates({ tenantId });
    success(res, rates, 'Print rates retrieved');
  } catch (err) {
    logger.error('studentServicesPack.listRates error:', err.message);
    error(res, 'Failed to retrieve print rates', 500);
  }
}

function upsertRate(req, res) {
  try {
    const tenantId = _resolveTenantId(req);
    if (!tenantId) return error(res, 'Tenant context required', 400);
    const data = req.body || {};
    const rate = studentServicesPack.upsertRate({ tenantId }, data);
    success(res, rate, 'Print rate saved');
  } catch (err) {
    logger.error('studentServicesPack.upsertRate error:', err.message);
    error(res, err.message || 'Failed to save print rate', 400);
  }
}

function deleteRate(req, res) {
  try {
    const tenantId = _resolveTenantId(req);
    if (!tenantId) return error(res, 'Tenant context required', 400);
    const { id } = req.params;
    const ok = studentServicesPack.deleteRate({ tenantId }, id);
    if (!ok) return error(res, 'Rate not found', 404);
    success(res, { ok: true }, 'Print rate deleted');
  } catch (err) {
    logger.error('studentServicesPack.deleteRate error:', err.message);
    error(res, err.message || 'Failed to delete print rate', 400);
  }
}

function calculate(req, res) {
  try {
    const tenantId = _resolveTenantId(req);
    if (!tenantId) return error(res, 'Tenant context required', 400);
    const data = req.body || {};
    const result = studentServicesPack.calculateCost(
      { tenantId },
      data.totalPages,
      data.copies,
      data.paperSize,
      data.printType,
      data.duplexType,
      data.hasBinding
    );
    success(res, result, 'Cost calculated');
  } catch (err) {
    logger.error('studentServicesPack.calculate error:', err.message);
    error(res, err.message || 'Failed to calculate cost', 400);
  }
}

function createOrder(req, res) {
  try {
    const tenantId = _resolveTenantId(req);
    if (!tenantId) return error(res, 'Tenant context required', 400);
    const data = req.body || {};
    const result = studentServicesPack.createOrder({ tenantId }, data);
    success(res, result, 'Print order created', 201);
  } catch (err) {
    logger.error('studentServicesPack.createOrder error:', err.message);
    error(res, err.message || 'Failed to create print order', 400);
  }
}

function listOrders(req, res) {
  try {
    const tenantId = _resolveTenantId(req);
    if (!tenantId) return error(res, 'Tenant context required', 400);
    const query = {
      status: req.query.status,
      search: req.query.search,
      page: req.query.page,
      limit: req.query.limit
    };
    const result = studentServicesPack.listOrders({ tenantId }, query);
    success(res, result, 'Print orders retrieved');
  } catch (err) {
    logger.error('studentServicesPack.listOrders error:', err.message);
    error(res, 'Failed to retrieve print orders', 500);
  }
}

function updateOrderStatus(req, res) {
  try {
    const tenantId = _resolveTenantId(req);
    if (!tenantId) return error(res, 'Tenant context required', 400);
    const { id } = req.params;
    const { status } = req.body || {};
    const order = studentServicesPack.updateOrderStatus({ tenantId }, id, status);
    if (!order) return error(res, 'Order not found', 404);
    success(res, order, 'Order status updated');
  } catch (err) {
    logger.error('studentServicesPack.updateOrderStatus error:', err.message);
    error(res, err.message || 'Failed to update order status', 400);
  }
}

function sendReceipt(req, res) {
  try {
    const tenantId = _resolveTenantId(req);
    if (!tenantId) return error(res, 'Tenant context required', 400);
    const { id } = req.params;
    studentServicesPack.sendOrderReceipt({ tenantId }, id).then(result => {
      if (result && result.ok) {
        success(res, result, 'Receipt sent');
      } else {
        error(res, (result && result.messageId) ? 'Receipt queued' : 'Failed to send receipt', 400);
      }
    }).catch(err => {
      logger.error('studentServicesPack.sendReceipt error:', err.message);
      error(res, err.message || 'Failed to send receipt', 400);
    });
  } catch (err) {
    logger.error('studentServicesPack.sendReceipt error:', err.message);
    error(res, err.message || 'Failed to send receipt', 400);
  }
}

function createPass(req, res) {
  try {
    const tenantId = _resolveTenantId(req);
    if (!tenantId) return error(res, 'Tenant context required', 400);
    const data = req.body || {};
    const pass = studentServicesPack.createPass({ tenantId }, data);
    success(res, pass, 'Student pass created', 201);
  } catch (err) {
    logger.error('studentServicesPack.createPass error:', err.message);
    error(res, err.message || 'Failed to create student pass', 400);
  }
}

function listPasses(req, res) {
  try {
    const tenantId = _resolveTenantId(req);
    if (!tenantId) return error(res, 'Tenant context required', 400);
    const query = {
      month: req.query.month,
      year: req.query.year,
      page: req.query.page,
      limit: req.query.limit
    };
    const result = studentServicesPack.listPasses({ tenantId }, query);
    success(res, result, 'Student passes retrieved');
  } catch (err) {
    logger.error('studentServicesPack.listPasses error:', err.message);
    error(res, 'Failed to retrieve student passes', 500);
  }
}

function getSettings(req, res) {
  try {
    const tenantId = _resolveTenantId(req);
    if (!tenantId) return error(res, 'Tenant context required', 400);
    const settings = studentServicesPack.getSettings({ tenantId });
    success(res, settings, 'Student services settings retrieved');
  } catch (err) {
    logger.error('studentServicesPack.getSettings error:', err.message);
    error(res, 'Failed to retrieve settings', 500);
  }
}

function updateSettings(req, res) {
  try {
    const tenantId = _resolveTenantId(req);
    if (!tenantId) return error(res, 'Tenant context required', 400);
    const data = req.body || {};
    const settings = studentServicesPack.updateSettings({ tenantId }, data);
    success(res, settings, 'Student services settings saved');
  } catch (err) {
    logger.error('studentServicesPack.updateSettings error:', err.message);
    error(res, err.message || 'Failed to save settings', 400);
  }
}

module.exports = {
  listRates,
  upsertRate,
  deleteRate,
  calculate,
  createOrder,
  listOrders,
  updateOrderStatus,
  sendReceipt,
  createPass,
  listPasses,
  getSettings,
  updateSettings
};
