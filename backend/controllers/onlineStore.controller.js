'use strict';

const { success, error } = require('../utils/apiResponse');
const onlineStore = require('../services/onlineStore.service');
const logger = require('../utils/logger');

function _resolveTenantId(req) {
  if (req.tenantContext && req.tenantContext.tenantId) return String(req.tenantContext.tenantId);
  if (req.user && req.user.tenantId) return String(req.user.tenantId);
  return null;
}

function getStoreConfig(req, res) {
  try {
    const tenantId = _resolveTenantId(req);
    if (!tenantId) return error(res, 'Tenant context required', 400);
    const config = onlineStore.getStoreConfig({ tenantId });
    success(res, config || null, 'Store config retrieved');
  } catch (err) {
    logger.error('onlineStore.getStoreConfig error:', err.message);
    error(res, 'Failed to retrieve store config', 500);
  }
}

function upsertStoreConfig(req, res) {
  try {
    const tenantId = _resolveTenantId(req);
    if (!tenantId) return error(res, 'Tenant context required', 400);
    const data = req.body || {};
    const config = onlineStore.upsertStoreConfig({ tenantId }, data);
    success(res, config, 'Store config saved');
  } catch (err) {
    logger.error('onlineStore.upsertStoreConfig error:', err.message);
    error(res, err.message || 'Failed to save store config', 400);
  }
}

function listStoreConfigs(req, res) {
  try {
    const configs = onlineStore.listActiveStoreConfigs();
    success(res, configs, 'Store configs retrieved');
  } catch (err) {
    logger.error('onlineStore.listStoreConfigs error:', err.message);
    error(res, 'Failed to retrieve store configs', 500);
  }
}

function getStoreBySlug(req, res) {
  try {
    const { storeSlug } = req.params;
    const config = onlineStore.getStoreConfigBySlug(storeSlug);
    if (!config) return error(res, 'Store not found', 404);
    success(res, config, 'Store retrieved');
  } catch (err) {
    logger.error('onlineStore.getStoreBySlug error:', err.message);
    error(res, 'Failed to retrieve store', 500);
  }
}

function createOrder(req, res) {
  try {
    const tenantId = _resolveTenantId(req);
    if (!tenantId) return error(res, 'Tenant context required', 400);
    const data = req.body || {};
    const result = onlineStore.createOnlineOrder({ tenantId }, data);
    success(res, result, 'Order created', 201);
  } catch (err) {
    logger.error('onlineStore.createOrder error:', err.message);
    // Public storefront endpoint: return a generic rejection instead of
    // leaking internal store state through raw service error messages
    // (e.g. 'Store not configured for this tenant').
    error(res, 'Failed to create order: invalid request', 400);
  }
}

function getOrder(req, res) {
  try {
    const tenantId = _resolveTenantId(req);
    if (!tenantId) return error(res, 'Tenant context required', 400);
    const { id } = req.params;
    const order = onlineStore.getOnlineOrder({ tenantId }, id);
    if (!order) return error(res, 'Order not found', 404);
    success(res, order, 'Order retrieved');
  } catch (err) {
    logger.error('onlineStore.getOrder error:', err.message);
    error(res, 'Failed to retrieve order', 500);
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
    const result = onlineStore.listOnlineOrders({ tenantId }, query);
    success(res, result, 'Orders retrieved');
  } catch (err) {
    logger.error('onlineStore.listOrders error:', err.message);
    error(res, 'Failed to retrieve orders', 500);
  }
}

function updateOrderStatus(req, res) {
  try {
    const tenantId = _resolveTenantId(req);
    if (!tenantId) return error(res, 'Tenant context required', 400);
    const { id } = req.params;
    const { status } = req.body || {};
    const order = onlineStore.updateOnlineOrderStatus({ tenantId }, id, status);
    if (!order) return error(res, 'Order not found', 404);
    success(res, order, 'Order status updated');
  } catch (err) {
    logger.error('onlineStore.updateOrderStatus error:', err.message);
    error(res, err.message || 'Failed to update order status', 400);
  }
}

module.exports = {
  getStoreConfig,
  upsertStoreConfig,
  listStoreConfigs,
  getStoreBySlug,
  createOrder,
  getOrder,
  listOrders,
  updateOrderStatus
};
