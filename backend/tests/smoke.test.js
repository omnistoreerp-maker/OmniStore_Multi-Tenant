// Infrastructure smoke test — proves Jest + Supertest are wired correctly.
const request = require('supertest');

describe('test infrastructure', () => {
  test('jest runs tests', () => {
    expect(1 + 1).toBe(2);
  });

  test('supertest agent can be constructed', () => {
    const agent = request('http://127.0.0.1:1');
    expect(agent).toBeDefined();
    expect(typeof agent.get).toBe('function');
  });
});
