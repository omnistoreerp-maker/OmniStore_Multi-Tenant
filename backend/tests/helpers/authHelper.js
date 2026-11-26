// Authentication helpers shared by test suites.
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { hashPassword } = require('../utils/password');
const request = require('supertest');

async function createUser(app, user) {
  const dir = process.env.DIGITRONICS_DATA_DIR;
  if (!dir) throw new Error(`createUser(${user.username}): DIGITRONICS_DATA_DIR not set`);

  const dbPath = path.join(dir, 'users.json');
  let db = { users: [] };
  if (fs.existsSync(dbPath)) {
    db = JSON.parse(fs.readFileSync(dbPath, 'utf-8'));
    if (!Array.isArray(db.users)) db.users = [];
  }

  const id = user.id || uuidv4();
  const now = new Date().toISOString();
  const record = {
    id,
    username: user.username,
    password: hashPassword(user.password),
    fullName: user.fullName || user.username,
    role: user.role || 'Cashier',
    createdAt: user.createdAt || now,
    updatedAt: now,
    tokenVersion: 0,
    ...(user.extra || {})
  };

  if (db.users.some(u => u.id === id)) throw new Error(`createUser(${user.username}): Duplicate user ID: ${id}`);
  if (db.users.some(u => u.username === user.username)) throw new Error(`createUser(${user.username}): Duplicate username`);

  db.users.push(record);
  fs.writeFileSync(dbPath, JSON.stringify(db, null, 2), 'utf-8');

  const { password, ...sanitized } = record;
  return sanitized;
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
