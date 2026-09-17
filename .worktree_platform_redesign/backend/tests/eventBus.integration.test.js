// Event Bus integration: events published on business operations flow to webhook dispatch.
const http = require('http');
const request = require('supertest');
const { startServer } = require('./helpers/testServer');
const { makeTempDataDir } = require('./helpers/testData');
const { createUser, login, authHeader } = require('./helpers/authHelper');
const { registerCleanup } = require('./helpers/cleanup');

let server;
let dataDir;
let accessToken;

registerCleanup(() => [server], () => [dataDir]);

beforeAll(async () => {
  dataDir = makeTempDataDir('eventbus');
  server = await startServer(dataDir);
  await createUser(server.app, { username: 'eventadmin', password: 'EventAdmin#1', fullName: 'Event Admin', role: 'Admin' });
  const loginData = await login(server.app, 'eventadmin', 'EventAdmin#1');
  accessToken = loginData.accessToken;
});

// Local HTTP receiver that captures webhook deliveries.
function startReceiver() {
  const deliveries = [];
  const srv = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      deliveries.push({
        event: req.headers['x-webhook-event'],
        signature: req.headers['x-webhook-signature'],
        delivery: req.headers['x-webhook-delivery'],
        payload: body
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{"ok":true}');
    });
  });
  return new Promise((resolve) => {
    srv.listen(0, '127.0.0.1', () => {
      resolve({ srv, deliveries, url: `http://127.0.0.1:${srv.address().port}/hook` });
    });
  });
}

describe('Event Bus → Webhook Integration', () => {
  test('sale.created event triggers webhook delivery with signature', async () => {
    const receiver = await startReceiver();

    // Register a webhook pointing at the local receiver
    const hookRes = await request(server.app)
      .post('/api/v1/webhooks')
      .set(authHeader(accessToken))
      .send({ url: receiver.url, events: ['sale.created'], secret: 'test-secret' });
    expect(hookRes.statusCode).toBe(201);

    // Create a sale via the API — sales service publishes sale.created
    const saleRes = await request(server.app)
      .post('/api/v1/sales')
      .send({ id: 'INV-EV-1', items: [{ productId: 'p1', qty: 1, price: 10 }], total: 10, customer: 'Event', payment: 'cash' });

    // Wait for async dispatch
    await new Promise(r => setTimeout(r, 200));

    expect(receiver.deliveries.length).toBeGreaterThan(0);
    const delivery = receiver.deliveries.find(d => d.event === 'sale.created');
    expect(delivery).toBeTruthy();
    expect(delivery.signature).toMatch(/^sha256=[0-9a-f]{64}$/);
    expect(delivery.delivery).toBeTruthy();

    const payload = JSON.parse(delivery.payload);
    expect(payload.event).toBe('sale.created');
    expect(payload.timestamp).toBeTruthy();

    receiver.srv.close();
  });
});