// Verifies the shared test helpers themselves: boot, isolation, cleanup.
const fs = require('fs');
const path = require('path');
const request = require('supertest');
const { startServer } = require('./helpers/testServer');
const { makeTempDataDir, readStore } = require('./helpers/testData');
const { createUser, login } = require('./helpers/authHelper');
const { registerCleanup } = require('./helpers/cleanup');

const PROD_DATA_DIR = path.join(__dirname, '..', 'data');

let server;
let dataDir;
let prodFilesBefore;

registerCleanup(() => [server], () => [dataDir]);

beforeAll(async () => {
  dataDir = makeTempDataDir('helpers');
  prodFilesBefore = fs.existsSync(PROD_DATA_DIR) ? fs.readdirSync(PROD_DATA_DIR).sort() : [];
  server = await startServer(dataDir);
});

describe('test helpers', () => {
  test('server boots and answers health', async () => {
    const res = await request(server.app).get('/api/v1/health');
    expect(res.statusCode).toBe(200);
  });

  test('records are written to the isolated temp store', async () => {
    await createUser(server.app, { username: 'helper-user', password: 'Pass#1234', role: 'Admin' });
    const store = readStore(dataDir, 'users');
    expect(store).not.toBeNull();
    expect(store.users).toHaveLength(1);
    expect(store.users[0].username).toBe('helper-user');
  });

  test('login works through authHelper', async () => {
    const session = await login(server.app, 'helper-user', 'Pass#1234');
    expect(session.accessToken).toBeTruthy();
    expect(session.user.username).toBe('helper-user');
  });

  test('production data directory is untouched', () => {
    const after = fs.existsSync(PROD_DATA_DIR) ? fs.readdirSync(PROD_DATA_DIR).sort() : [];
    expect(after).toEqual(prodFilesBefore);
  });
});
