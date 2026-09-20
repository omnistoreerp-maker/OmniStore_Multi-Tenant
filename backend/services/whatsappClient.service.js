'use strict';

const logger = require('../utils/logger');

async function sendWhatsAppMessage({ tenantId, to, template, variables }) {
  const tid = tenantId ? String(tenantId) : 'unknown';
  const phone = String(to || '').trim();
  if (!phone) {
    logger.warn(`whatsappClient.sendWhatsAppMessage skipped for tenant ${tid}: missing phone`);
    return { ok: false, reason: 'missing_phone' };
  }

  const payload = {
    tenantId: tid,
    to: phone,
    template: template || 'generic',
    variables: variables || {},
    provider: process.env.WHATSAPP_PROVIDER || 'local_fallback'
  };

  if (payload.provider === 'local_fallback' || !process.env.WHATSAPP_API_KEY) {
    logger.info(`[whatsapp:local] tenant=${tid} to=${phone} template=${payload.template} vars=${JSON.stringify(variables || {})}`);
    return { ok: true, provider: 'local_fallback', messageId: `local-${Date.now()}` };
  }

  try {
    const url = process.env.WHATSAPP_API_URL || 'https://graph.facebook.com/v18.0/me/messages';
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.WHATSAPP_API_KEY}`
      },
      body: JSON.stringify(payload)
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data) {
      logger.warn(`whatsappClient.sendWhatsAppMessage failed for tenant ${tid}: ${res.status} ${JSON.stringify(data)}`);
      return { ok: false, status: res.status, reason: data?.error?.message || 'whatsapp_api_error' };
    }
    logger.info(`whatsappClient.sendWhatsAppMessage success for tenant ${tid}: messageId=${data.messages?.[0]?.id || 'unknown'}`);
    return { ok: true, messageId: data.messages?.[0]?.id || 'unknown', provider: 'external' };
  } catch (err) {
    logger.error(`whatsappClient.sendWhatsAppMessage error for tenant ${tid}:`, err.message);
    return { ok: false, reason: err.message };
  }
}

module.exports = {
  sendWhatsAppMessage
};
