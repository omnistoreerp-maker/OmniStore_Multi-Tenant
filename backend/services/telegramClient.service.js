'use strict';

const logger = require('../utils/logger');

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
    .replace(/|/g, '\\|')
    .replace(/{/g, '\\{')
    .replace(/}/g, '\\}');
}

async function sendTelegramAlert({ tenantId, botToken, chatId, message }) {
  const tid = tenantId ? String(tenantId) : 'unknown';
  const token = String(botToken || '').trim();
  const chat = String(chatId || '').trim();
  if (!token || !chat) {
    logger.warn(`telegramClient.sendTelegramAlert skipped for tenant ${tid}: missing token or chatId`);
    return { ok: false, reason: 'missing_token_or_chat' };
  }
  const safeMessage = _escapeMarkdown(message);
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  const body = {
    chat_id: chat,
    text: safeMessage,
    parse_mode: 'MarkdownV2',
    disable_web_page_preview: true
  };
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data || !data.ok) {
      logger.warn(`telegramClient.sendTelegramAlert failed for tenant ${tid}: ${res.status} ${JSON.stringify(data)}`);
      return { ok: false, status: res.status, reason: data?.description || 'telegram_api_error' };
    }
    logger.info(`telegramClient.sendTelegramAlert success for tenant ${tid}: messageId=${data.result?.message_id}`);
    return { ok: true, messageId: data.result?.message_id };
  } catch (err) {
    logger.error(`telegramClient.sendTelegramAlert error for tenant ${tid}:`, err.message);
    return { ok: false, reason: err.message };
  }
}

async function sendReceiptNotification({ tenantId, customerPhone, invoiceData }) {
  const tid = tenantId ? String(tenantId) : 'unknown';
  const phone = String(customerPhone || '').trim();
  if (!phone) {
    logger.warn(`telegramClient.sendReceiptNotification skipped for tenant ${tid}: missing customerPhone`);
    return { ok: false, reason: 'missing_phone' };
  }
  const lines = [
    `🧾 *Receipt*`,
    `Invoice: ${_escapeMarkdown(invoiceData?.invoiceNumber || '—')}`,
    `Total: ${_escapeMarkdown(invoiceData?.currency || 'EGP')} ${invoiceData?.total ?? '—'}`,
    `Payment: ${_escapeMarkdown(invoiceData?.paymentType || '—')}`
  ];
  if (invoiceData?.customerName) lines.push(`Customer: ${_escapeMarkdown(invoiceData.customerName)}`);
  const message = lines.join('\n');
  return sendTelegramAlert({ tenantId, botToken: invoiceData?.botToken, chatId: invoiceData?.chatId || phone, message });
}

async function sendLowStockAlert({ tenantId, itemCode, itemName, currentStock }) {
  const tid = tenantId ? String(tenantId) : 'unknown';
  const message = [
    `⚠️ *Low Stock Alert*`,
    `Item: ${_escapeMarkdown(itemName || itemCode || '—')}`,
    `Stock: ${currentStock ?? '?'}`
  ].join('\n');
  return sendTelegramAlert({ tenantId, message });
}

async function sendSubscriptionAlert({ tenantId, daysRemaining, renewalUrl }) {
  const tid = tenantId ? String(tenantId) : 'unknown';
  const message = [
    `🔔 *Subscription Renewal*`,
    `Days remaining: ${daysRemaining ?? '?'}`,
    renewalUrl ? `Renew: ${_escapeMarkdown(renewalUrl)}` : ''
  ].filter(Boolean).join('\n');
  return sendTelegramAlert({ tenantId, message });
}

module.exports = {
  sendTelegramAlert,
  sendReceiptNotification,
  sendLowStockAlert,
  sendSubscriptionAlert
};
