const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const logger = require('../utils/logger');
const config = require('../config');
const { eventBus } = require('./eventBus');
const repository = require('../repositories').webhooks;

const STORE_NAME = 'webhooks';
const MAX_RETRIES = config.webhookMaxRetries || 3;
const RETRY_DELAYS = [1000, 5000, 30000]; // ms
const TIMEOUT_MS = config.webhookTimeout || 10000;
const DEFAULT_EVENTS = ['sale.created', 'sale.updated', 'sale.deleted', 'inventory.updated', 'inventory.low'];

function _store() {
  const store = repository.read();
  if (!store.entries) store.entries = [];
  return store;
}

// HMAC-SHA256 signature of the canonical JSON payload.
function signPayload(payload, secret) {
  return crypto.createHmac('sha256', secret)
    .update(JSON.stringify(payload))
    .digest('hex');
}

// Timing-safe verification of an incoming signature.
// Expected format: "sha256=<hex>".
function verifySignature(payload, secret, signatureHeader) {
  if (!signatureHeader || typeof signatureHeader !== 'string') return false;
  const parts = signatureHeader.split('=');
  if (parts.length !== 2 || parts[0] !== 'sha256') return false;
  const expected = Buffer.from(parts[1], 'hex');
  const actual = Buffer.from(signPayload(payload, secret), 'hex');
  if (expected.length !== actual.length) return false;
  return crypto.timingSafeEqual(expected, actual);
}

function register({ url, events, secret, description }) {
  if (!url || !/^https?:\/\//i.test(url)) {
    throw new Error('Invalid webhook URL. Must be http(s).');
  }
  const allowed = DEFAULT_EVENTS.concat(['inventory.transaction.created']);
  const eventList = Array.isArray(events) && events.length > 0
    ? events.filter(e => allowed.includes(e))
    : DEFAULT_EVENTS;
  if (eventList.length === 0) {
    throw new Error('No valid events provided for webhook');
  }

  const store = _store();
  const webhook = {
    id: uuidv4(),
    url,
    events: eventList,
    description: description || null,
    secret: secret || crypto.randomBytes(32).toString('hex'),
    active: true,
    createdAt: new Date().toISOString()
  };
  store.entries.push(webhook);
  repository.write(store);
  // Never expose the raw secret in a response.
  const { secret: _s, ...safe } = webhook;
  return safe;
}

function list() {
  const store = _store();
  return store.entries.map(({ secret, ...safe }) => safe);
}

function getById(id) {
  const store = _store();
  const hook = store.entries.find(h => h.id === id);
  if (!hook) return null;
  const { secret: _s, ...safe } = hook;
  return safe;
}

function update(id, { url, events, active, description }) {
  const store = _store();
  const hook = store.entries.find(h => h.id === id);
  if (!hook) return null;
  if (url !== undefined) {
    if (!/^https?:\/\//i.test(url)) throw new Error('Invalid webhook URL. Must be http(s).');
    hook.url = url;
  }
  if (Array.isArray(events) && events.length > 0) hook.events = events;
  if (typeof active === 'boolean') hook.active = active;
  if (description !== undefined) hook.description = description;
  repository.write(store);
  const { secret: _s, ...safe } = hook;
  return safe;
}

function remove(id) {
  const store = _store();
  const idx = store.entries.findIndex(h => h.id === id);
  if (idx === -1) return false;
  store.entries.splice(idx, 1);
  repository.write(store);
  return true;
}

// Deliver a single event to every active webhook subscribed to it.
// Dispatch is asynchronous and non-blocking; failures are retried.
function dispatch(eventType, payload) {
  const store = _store();
  const hooks = store.entries.filter(h => h.active && h.events.includes(eventType));
  for (const hook of hooks) {
    _deliver(hook, eventType, payload);
  }
}

function _deliver(hook, eventType, payload, attempt = 0) {
  const body = {
    event: eventType,
    data: payload,
    timestamp: new Date().toISOString()
  };
  const signature = signPayload(body, hook.secret);
  const deliveryId = uuidv4();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  if (typeof timer.unref === 'function') timer.unref();

  fetch(hook.url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Webhook-Signature': `sha256=${signature}`,
      'X-Webhook-Event': eventType,
      'X-Webhook-Delivery': deliveryId
    },
    body: JSON.stringify(body),
    signal: controller.signal
  })
    .then(async (res) => {
      if (!res.ok) throw new Error(`Webhook ${hook.url} responded ${res.status}`);
      const text = await res.text();
      logger.info(`Webhook delivery ${deliveryId} to ${hook.url} OK`);
      return text;
    })
    .catch((err) => {
      logger.warn(`Webhook delivery ${deliveryId} to ${hook.url} failed (attempt ${attempt + 1}):`, err.message);
      if (attempt < MAX_RETRIES - 1) {
        const retryTimer = setTimeout(() => _deliver(hook, eventType, payload, attempt + 1), RETRY_DELAYS[attempt]);
        if (typeof retryTimer.unref === 'function') retryTimer.unref();
      } else {
        logger.error(`Webhook delivery ${deliveryId} to ${hook.url} exhausted retries`);
        try {
          eventBus.publish('webhook.delivery.failed', { webhookId: hook.id, event: eventType, deliveryId });
        } catch (_) {}
      }
    })
    .finally(() => clearTimeout(timer));
}

// Send a test event to a single webhook (used by the /test endpoint).
// Looks up the full stored record so the signing secret is available.
async function sendTest(hook, eventType = 'sale.created') {
  const full = _store().entries.find(h => h.id === hook.id);
  if (!full) return { ok: false, status: 404, response: 'Webhook not found' };
  hook = full;
  const body = {
    event: eventType,
    data: { message: 'This is a test webhook delivery from DigiTronics V2' },
    timestamp: new Date().toISOString()
  };
  const signature = signPayload(body, hook.secret);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(hook.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Webhook-Signature': `sha256=${signature}`,
        'X-Webhook-Event': eventType,
        'X-Webhook-Delivery': uuidv4()
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    const text = await res.text();
    return { ok: res.ok, status: res.status, response: text };
  } catch (err) {
    return { ok: false, status: 0, response: err.message };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = {
  STORE_NAME,
  MAX_RETRIES,
  RETRY_DELAYS,
  DEFAULT_EVENTS,
  register,
  list,
  getById,
  update,
  remove,
  dispatch,
  sendTest,
  signPayload,
  verifySignature
};
