'use strict';

const storageAdapter = require('../repositories/storageAdapter');
const logger = require('../utils/logger');
const telegramClient = require('./telegramClient.service');
const whatsappClient = require('./whatsappClient.service');
const { eventBus } = require('./eventBus');

const STORE_KEY = 'tenantNotifications';

function _escapeMarkdown(text) {
  return String(text || '')
    .replace(/\\/g, '\\\\')
    .replace(/_/g, '\\_')
    .replace(/\*/g, '\\*')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)')
    .replace(/~/g, '\\~')
    .replace(/`/g, '\\`')
    .replace(/>/g, '\\>')
    .replace(/#/g, '\\#')
    .replace(/\+/g, '\\+')
    .replace(/-/g, '\\-')
    .replace(/=/g, '\\=')
    .replace(/\|/g, '\\|')
    .replace(/{/g, '\\{')
    .replace(/}/g, '\\}');
}

function _readStore() {
  try {
    const raw = storageAdapter.read(STORE_KEY);
    if (raw && typeof raw === 'object') return raw;
  } catch (err) {
    logger.warn('notificationEngine.service: failed to read store, using default', err.message);
  }
  return { settings: [], lastUpdated: new Date().toISOString() };
}

function _writeStore(raw) {
  try {
    storageAdapter.write(STORE_KEY, raw);
  } catch (err) {
    logger.warn('notificationEngine.service: failed to write store', err.message);
  }
}

function _getSettings(tenantId) {
  const raw = _readStore();
  const settings = Array.isArray(raw.settings) ? raw.settings : [];
  return settings.find(s => s && String(s.tenantId) === String(tenantId)) || null;
}

function _upsertSettings(tenantId, data) {
  const raw = _readStore();
  const settings = Array.isArray(raw.settings) ? raw.settings : [];
  const idx = settings.findIndex(s => s && String(s.tenantId) === String(tenantId));
  const record = Object.assign({}, data, { tenantId: String(tenantId), updatedAt: new Date().toISOString() });
  if (idx >= 0) {
    settings[idx] = Object.assign({}, settings[idx], record);
  } else {
    settings.push(record);
  }
  raw.settings = settings;
  raw.lastUpdated = new Date().toISOString();
  _writeStore(raw);
  return record;
}

async function _dispatchAsync(handler) {
  return new Promise((resolve) => {
    setImmediate(async () => {
      try {
        resolve(await handler());
      } catch (err) {
        logger.error('notificationEngine._dispatchAsync error:', err.message);
        resolve({ ok: false, reason: err.message });
      }
    });
  });
}

async function sendReceiptNotification({ tenantId, customerPhone, invoiceData }) {
  const tid = String(tenantId || '').trim();
  if (!tid) return { ok: false, reason: 'missing_tenant' };
  const settings = _getSettings(tid);
  if (!settings) return { ok: false, reason: 'no_settings' };

  const results = [];
  if (settings.telegramAlertsEnabled && settings.telegramBotToken && settings.telegramChatId) {
    const payload = Object.assign({}, invoiceData, { botToken: settings.telegramBotToken, chatId: settings.telegramChatId });
    const r = await _dispatchAsync(() => telegramClient.sendReceiptNotification(Object.assign({ tenantId: tid }, payload)));
    results.push({ channel: 'telegram', ...r });
  }
  if (settings.whatsappEnabled) {
    const r = await _dispatchAsync(() => whatsappClient.sendWhatsAppMessage({
      tenantId: tid,
      to: customerPhone,
      template: 'receipt',
      variables: { invoiceNumber: invoiceData?.invoiceNumber, total: invoiceData?.total, paymentType: invoiceData?.paymentType }
    }));
    results.push({ channel: 'whatsapp', ...r });
  }
  return { ok: results.some(r => r.ok), results };
}

async function sendLowStockAlert({ tenantId, itemCode, itemName, currentStock }) {
  const tid = String(tenantId || '').trim();
  if (!tid) return { ok: false, reason: 'missing_tenant' };
  const settings = _getSettings(tid);
  if (!settings || !settings.lowStockAlertsEnabled) return { ok: false, reason: 'disabled' };

  const r = await _dispatchAsync(() => telegramClient.sendLowStockAlert({
    tenantId: tid,
    botToken: settings.telegramBotToken,
    chatId: settings.telegramChatId,
    itemCode,
    itemName,
    currentStock
  }));
  return r;
}

async function sendSubscriptionAlert({ tenantId, daysRemaining, renewalUrl }) {
  const tid = String(tenantId || '').trim();
  if (!tid) return { ok: false, reason: 'missing_tenant' };
  const settings = _getSettings(tid);
  if (!settings || !settings.subscriptionAlertsEnabled) return { ok: false, reason: 'disabled' };

  const r = await _dispatchAsync(() => telegramClient.sendSubscriptionAlert({
    tenantId: tid,
    botToken: settings.telegramBotToken,
    chatId: settings.telegramChatId,
    daysRemaining,
    renewalUrl
  }));
  return r;
}

function getSettings(tenantId) {
  const tid = String(tenantId || '').trim();
  if (!tid) return null;
  return _getSettings(tid) || {
    tenantId: tid,
    telegramBotToken: '',
    telegramChatId: '',
    whatsappEnabled: false,
    telegramAlertsEnabled: false,
    lowStockAlertsEnabled: false,
    subscriptionAlertsEnabled: false
  };
}

function saveSettings(tenantId, data) {
  const tid = String(tenantId || '').trim();
  if (!tid) throw new Error('tenantId is required');
  const allowed = ['telegramBotToken', 'telegramChatId', 'whatsappEnabled', 'telegramAlertsEnabled', 'lowStockAlertsEnabled', 'subscriptionAlertsEnabled'];
  const patch = {};
  allowed.forEach(key => {
    if (Object.prototype.hasOwnProperty.call(data || {}, key)) patch[key] = data[key];
  });
  return _upsertSettings(tid, patch);
}

async function testTelegramConnection(tenantId, botToken, chatId) {
  const tid = String(tenantId || '').trim();
  const token = String(botToken || '').trim();
  const chat = String(chatId || '').trim();
  if (!tid || !token || !chat) return { ok: false, reason: 'missing_fields' };
  const r = await _dispatchAsync(() => telegramClient.sendTelegramAlert({
    tenantId: tid,
    botToken: token,
    chatId: chat,
    message: '🔔 *OmniStore Test*\nTelegram connection is working\\.'
  }));
  return r;
}

function bootstrapEventListeners() {
  eventBus.subscribe('sale.created', (event) => {
    const data = event.data || {};
    const tid = data.tenantId || event.data?.tenantId;
    if (!tid) return;
    const settings = _getSettings(tid);
    if (!settings || !settings.telegramAlertsEnabled) return;
    const message = [
      `🛒 *New Sale*`,
      `Invoice: ${_escapeMarkdown(data.invoiceNumber || data.id || '—')}`,
      `Total: ${_escapeMarkdown(data.currency || 'EGP')} ${data.total ?? '—'}`,
      `Payment: ${_escapeMarkdown(data.paymentType || data.payment || '—')}`
    ].join('\n');
    setImmediate(() => telegramClient.sendTelegramAlert({
      tenantId: tid,
      botToken: settings.telegramBotToken,
      chatId: settings.telegramChatId,
      message
    })).catch(() => {});
  });

  eventBus.subscribe('inventory.low', (event) => {
    const data = event.data || {};
    const tid = data.tenantId || event.data?.tenantId;
    if (!tid) return;
    const settings = _getSettings(tid);
    if (!settings || !settings.lowStockAlertsEnabled) return;
    setImmediate(() => telegramClient.sendLowStockAlert({
      tenantId: tid,
      botToken: settings.telegramBotToken,
      chatId: settings.telegramChatId,
      itemCode: data.productId || data.itemCode,
      itemName: data.productName || data.itemName,
      currentStock: data.stockQty ?? data.currentStock
    })).catch(() => {});
  });

  eventBus.subscribe('subscription.expiring', (event) => {
    const data = event.data || {};
    const tid = data.tenantId || event.data?.tenantId;
    if (!tid) return;
    const settings = _getSettings(tid);
    if (!settings || !settings.subscriptionAlertsEnabled) return;
    setImmediate(() => telegramClient.sendSubscriptionAlert({
      tenantId: tid,
      botToken: settings.telegramBotToken,
      chatId: settings.telegramChatId,
      daysRemaining: data.daysRemaining,
      renewalUrl: data.renewalUrl
    })).catch(() => {});
  });
}

module.exports = {
  sendReceiptNotification,
  sendLowStockAlert,
  sendSubscriptionAlert,
  getSettings,
  saveSettings,
  testTelegramConnection,
  bootstrapEventListeners
};
