// Event Bus unit tests.
const { EventBus, EVENT_TYPES } = require('../services/eventBus');

describe('EventBus', () => {
  let bus;

  beforeEach(() => {
    bus = new EventBus();
  });

  test('publish dispatches to subscribers', () => {
    const received = [];
    bus.subscribe('sale.created', (ev) => received.push(ev));
    const event = bus.publish('sale.created', { id: 1 });

    expect(received).toHaveLength(1);
    expect(received[0].type).toBe('sale.created');
    expect(received[0].data).toEqual({ id: 1 });
    expect(event.timestamp).toBeTruthy();
  });

  test('publish returns the event object', () => {
    const event = bus.publish('inventory.updated', { productId: 'p1' });
    expect(event).toHaveProperty('type', 'inventory.updated');
    expect(event).toHaveProperty('timestamp');
  });

  test('publish rejects invalid event types', () => {
    expect(() => bus.publish('not.a.real.event', {})).toThrow(/Invalid event type/);
  });

  test('subscribe rejects invalid event types', () => {
    expect(() => bus.subscribe('bad.event', () => {})).toThrow(/Invalid event type/);
  });

  test('subscribe rejects non-functions', () => {
    expect(() => bus.subscribe('sale.created', 'not-a-function')).toThrow(/must be a function/);
  });

  test('unsubscribe stops delivery', () => {
    const received = [];
    const handler = (ev) => received.push(ev);
    bus.subscribe('user.created', handler);
    bus.unsubscribe('user.created', handler);
    bus.publish('user.created', { id: 1 });
    expect(received).toHaveLength(0);
  });

  test('subscribe returns an unsubscribe function', () => {
    const received = [];
    const off = bus.subscribe('sale.created', (ev) => received.push(ev));
    off();
    bus.publish('sale.created', {});
    expect(received).toHaveLength(0);
  });

  test('multiple subscribers receive the same event', () => {
    const a = [];
    const b = [];
    bus.subscribe('sale.created', (ev) => a.push(ev));
    bus.subscribe('sale.created', (ev) => b.push(ev));
    bus.publish('sale.created', { id: 9 });
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
  });

  test('handler errors do not break other subscribers', () => {
    const a = [];
    bus.subscribe('sale.created', () => { throw new Error('boom'); });
    bus.subscribe('sale.created', (ev) => a.push(ev));
    expect(() => bus.publish('sale.created', {})).not.toThrow();
    expect(a).toHaveLength(1);
  });

  test('getHistory keeps recent events up to a limit', () => {
    for (let i = 0; i < 10; i++) bus.publish('user.created', { id: i });
    const history = bus.getHistory(3);
    expect(history).toHaveLength(3);
    expect(history[history.length - 1].data.id).toBe(9);
  });

  test('EVENT_TYPES contains webhook.delivery.failed', () => {
    expect(EVENT_TYPES).toContain('webhook.delivery.failed');
  });
});