const { v4: uuidv4 } = require('uuid');
const BaseRepository = require('../repositories/BaseRepository');
const repository = new BaseRepository('marketCustomers');
const { hashPassword, verifyPassword, verifyDummy } = require('../utils/password');
const { signCustomerToken } = require('../utils/marketJwt');
const logger = require('../utils/logger');

function _defaultDoc() {
  return { customers: [] };
}

async function _load() {
  const db = await repository.readAsync();
  if (!db || typeof db !== 'object') return _defaultDoc();
  if (!Array.isArray(db.customers)) db.customers = [];
  return db;
}

function _loadSync() {
  const db = repository.read();
  if (!db || typeof db !== 'object') return _defaultDoc();
  if (!Array.isArray(db.customers)) db.customers = [];
  return db;
}

async function _save(db) {
  return repository.writeAsync(db);
}

function getById(id) {
  const db = _loadSync();
  return db.customers.find((c) => String(c.id) === String(id)) || null;
}

function getByIdAndTenant(id, tenantId) {
  const db = _loadSync();
  return db.customers.find((c) => String(c.id) === String(id) && String(c.tenantId) === String(tenantId)) || null;
}

function isOperator(customerId, tenantId) {
  const customer = getByIdAndTenant(customerId, tenantId);
  if (!customer) return false;
  return String(customer.role || 'customer') === 'operator';
}

function setOperatorRole(customerId, tenantId, role) {
  const db = _loadSync();
  const idx = db.customers.findIndex((c) => String(c.id) === String(customerId) && String(c.tenantId) === String(tenantId));
  if (idx === -1) return { error: 'Customer not found' };
  const normalized = String(role || 'customer').toLowerCase();
  if (normalized !== 'customer' && normalized !== 'operator') return { error: 'role must be customer or operator' };
  db.customers[idx].role = normalized;
  db.customers[idx].updatedAt = new Date().toISOString();
  if (!_save(db)) return { error: 'Failed to persist role update' };
  return { customer: _safe(db.customers[idx]) };
}

function findByEmail(tenantId, email) {
  const db = _loadSync();
  const e = String(email).toLowerCase();
  return db.customers.find(
    (c) => String(c.tenantId) === String(tenantId) && String(c.email).toLowerCase() === e
  ) || null;
}

function _safe(customer) {
  if (!customer) return null;
  return {
    id: customer.id,
    tenantId: customer.tenantId,
    email: customer.email,
    name: customer.name,
    phone: customer.phone,
    role: customer.role || 'customer',
    addresses: Array.isArray(customer.addresses) ? customer.addresses : [],
    createdAt: customer.createdAt
  };
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

async function register({ tenantId, email, name, password, phone }) {
  if (!tenantId) return { error: 'tenantId is required' };
  if (!email || !EMAIL_RE.test(String(email))) return { error: 'valid email is required' };
  if (!password || String(password).length < 8) return { error: 'password must be at least 8 characters' };
  if (findByEmail(tenantId, email)) return { error: 'email already registered' };

  const db = await _load();
  const customer = {
    id: uuidv4(),
    tenantId: String(tenantId),
    email: String(email),
    name: name ? String(name) : '',
    phone: phone ? String(phone) : '',
    passwordHash: hashPassword(password),
    addresses: [],
    role: 'customer',
    tokenVersion: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  db.customers.push(customer);
  if (!(await _save(db))) return { error: 'Failed to persist customer' };
  const token = signCustomerToken(customer);
  return { customer: _safe(customer), token };
}

async function login({ tenantId, email, password }) {
  if (!tenantId || !email || !password) return { error: 'tenantId, email and password are required' };
  const customer = findByEmail(tenantId, email);
  if (!customer) {
    verifyDummy(password);
    return { error: 'Invalid credentials' };
  }
  const result = verifyPassword(password, customer.passwordHash);
  if (!result.match) return { error: 'Invalid credentials' };
  const token = signCustomerToken(customer);
  return { customer: _safe(customer), token };
}

async function updateProfile(id, patch) {
  const db = await _load();
  const idx = db.customers.findIndex((c) => String(c.id) === String(id));
  if (idx === -1) return { error: 'Customer not found' };
  const allowed = {};
  if (patch.name !== undefined) allowed.name = String(patch.name);
  if (patch.phone !== undefined) allowed.phone = String(patch.phone);
  if (patch.addresses !== undefined && Array.isArray(patch.addresses)) {
    allowed.addresses = patch.addresses.slice(0, 20);
  }
  db.customers[idx] = { ...db.customers[idx], ...allowed, updatedAt: new Date().toISOString() };
  if (!(await _save(db))) return { error: 'Failed to persist profile' };
  return { customer: _safe(db.customers[idx]) };
}

async function changePassword(id, currentPassword, newPassword) {
  if (!currentPassword || !newPassword) return { error: 'current and new password are required' };
  if (String(newPassword).length < 8) return { error: 'new password must be at least 8 characters' };
  const db = await _load();
  const idx = db.customers.findIndex((c) => String(c.id) === String(id));
  if (idx === -1) return { error: 'Customer not found' };
  const verify = verifyPassword(currentPassword, db.customers[idx].passwordHash);
  if (!verify.match) return { error: 'Current password is incorrect' };
  db.customers[idx].passwordHash = hashPassword(newPassword);
  db.customers[idx].tokenVersion = (Number(db.customers[idx].tokenVersion) || 0) + 1;
  db.customers[idx].updatedAt = new Date().toISOString();
  if (!(await _save(db))) return { error: 'Failed to persist password' };
  const token = signCustomerToken(db.customers[idx]);
  return { customer: _safe(db.customers[idx]), token };
}

module.exports = {
  getById,
  getByIdAndTenant,
  isOperator,
  setOperatorRole,
  findByEmail,
  register,
  login,
  updateProfile,
  changePassword
};

