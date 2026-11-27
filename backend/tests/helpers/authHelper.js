// Authentication helpers shared by test suites.
const request = require('supertest');
const { createUser: fixtureCreateUser } = require('./userFixture');

async function createUser(app, user) {
  return fixtureCreateUser(app, user);
}

async function login(app, username, password, company) {
  const body = { username, password };
  if (company !== undefined) body.company = company;
  const res = await request(app)
    .post('/api/v1/auth/login')
    .send(body);
  if (res.statusCode !== 200) {
    throw new Error(`login(${username}) failed: ${res.statusCode} ${JSON.stringify(res.body)}`);
  }
  return res.body.data; // { user, accessToken, refreshToken }
}

function authHeader(token) {
  return { Authorization: `Bearer ${token}` };
}

module.exports = { createUser, login, authHeader };
