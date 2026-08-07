const { EventEmitter } = require('events');
const logger = require('../utils/logger');

// Canonical list of event types published by the application.
const EVENT_TYPES = Object.freeze([
  'sale.created',
  'sale.updated',
  'sale.deleted',
  'inventory.updated',
  'inventory.low',
  'user.created',
  'user.updated',
  'user.deleted',
  'api_key.created',
  'api_key.revoked',
  'webhook.delivery.failed',
  'job.completed',
  'job.failed'
]);

const MAX_HISTORY = 1000;

// In-process pub/sub event bus built on Node's EventEmitter.
// Single instance per process; safe for the current single-process PM2
// deployment. A future external broker (Redis/RabbitMQ) can replace the
// transport without changing publishers or subscribers.
class EventBus extends EventEmitter {
  constructor() {
    super();
    this.setMaxListeners(50);
    this._history = [];
  }

  publish(eventType, data) {
    if (!EVENT_TYPES.includes(eventType)) {
      throw new Error(`Invalid event type: ${eventType}`);
    }
    const event = { type: eventType, data, timestamp: new Date().toISOString() };
    this._history.push(event);
    if (this._history.length > MAX_HISTORY) this._history.shift();
    // Isolate each listener so a failing handler never blocks other subscribers.
    const listeners = this.listeners(eventType);
    for (const listener of listeners) {
      try {
        listener(event);
      } catch (err) {
        logger.error(`eventBus.publish('${eventType}') handler failed:`, err.message);
      }
    }
    return event;
  }

  subscribe(eventType, handler) {
    if (!EVENT_TYPES.includes(eventType)) {
      throw new Error(`Invalid event type: ${eventType}`);
    }
    if (typeof handler !== 'function') {
      throw new Error('Event handler must be a function');
    }
    this.on(eventType, handler);
    return () => this.removeListener(eventType, handler);
  }

  unsubscribe(eventType, handler) {
    this.removeListener(eventType, handler);
  }

  // Recent event history (newest last). In-memory only — never persisted.
  getHistory(limit = 50) {
    return this._history.slice(-limit);
  }

  reset() {
    this.removeAllListeners();
    this._history = [];
  }
}

module.exports = { EventBus, EVENT_TYPES, eventBus: new EventBus() };
