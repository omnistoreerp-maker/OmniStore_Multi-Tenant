'use strict';

const { success, error } = require('../utils/apiResponse');
const notificationEngine = require('../services/notificationEngine.service');
const logger = require('../utils/logger');

function _resolveTenantId(req) {
  if (req.tenantContext && req.tenantContext.tenantId) return String(req.tenantContext.tenantId);
  if (req.user && req.user.tenantId) return String(req.user.tenantId);
  return null;
}

function getSettings(req, res) {
  try {
    const tenantId = _resolveTenantId(req);
    if (!tenantId) return error(res, 'Tenant context required', 400);
    const settings = notificationEngine.getSettings(tenantId);
    success(res, settings, 'Notification settings retrieved');
  } catch (err) {
    logger.error('tenantNotifications.getSettings error:', err.message);
    error(res, 'Failed to retrieve notification settings', 500);
  }
}

function updateSettings(req, res) {
  try {
    const tenantId = _resolveTenantId(req);
    if (!tenantId) return error(res, 'Tenant context required', 400);
    const data = req.body || {};
    const settings = notificationEngine.saveSettings(tenantId, data);
    success(res, settings, 'Notification settings saved');
  } catch (err) {
    logger.error('tenantNotifications.updateSettings error:', err.message);
    error(res, err.message || 'Failed to save notification settings', 400);
  }
}

function testTelegram(req, res) {
  try {
    const tenantId = _resolveTenantId(req);
    if (!tenantId) return error(res, 'Tenant context required', 400);
    const { botToken, chatId } = req.body || {};
    notificationEngine.testTelegramConnection(tenantId, botToken, chatId).then(result => {
      if (result && result.ok) {
        success(res, result, 'Test message sent');
      } else {
        error(res, (result && result.reason) || 'Telegram test failed', 400);
      }
    }).catch(err => {
      logger.error('tenantNotifications.testTelegram error:', err.message);
      error(res, err.message || 'Telegram test failed', 400);
    });
  } catch (err) {
    logger.error('tenantNotifications.testTelegram error:', err.message);
    error(res, err.message || 'Telegram test failed', 400);
  }
}

module.exports = {
  getSettings,
  updateSettings,
  testTelegram
};
