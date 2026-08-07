// Authentication helpers shared by test suites.
const request = require('supertest');

async function createUser(app, user) {
  const res = await request(app)
    .post('/api/v1/users')
    .send({
      username: user.username,
      password: user.password,
      fullName: user.fullName || user.username,
      role: user.role || 'Cashier',
      ...(user.extra || {})
    });
  if (res.statusCode !== 201) {
    throw new Error(`createUser(${user.username}) failed: ${res.statusCode} ${JSON.stringify(res.body)}`);
  }
  return res.body.data;
}

async function login(app, username, password) {
  const res = await request(app)
    .post('/api/v1/auth/login')
    .send({ username, password });
  if (res.statusCode !== 200) {
    throw new Error(`login(${username}) failed: ${res.statusCode} ${JSON.stringify(res.body)}`);
  }
  return res.body.data; // { user, accessToken, refreshToken }
}

function authHeader(token) {
  return { Authorization: `Bearer ${token}` };
}

module.exports = { createUser, login, authHeader };
