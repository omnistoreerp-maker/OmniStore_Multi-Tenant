const jwt = require('jsonwebtoken');
const { randomUUID } = require('crypto');
const config = require('../config');

const CUSTOMER_TTL = process.env.MARKET_JWT_TTL || '7d';

function _claims(customer) {
  return {
    sub: String(customer.id),
    type: 'customer',
    tenantId: String(customer.tenantId),
    role: 'customer',
    jti: randomUUID(),
    ver: Number(customer.tokenVersion) || 0
  };
}

function signCustomerToken(customer) {
  return jwt.sign(_claims(customer), config.jwtSecret, { expiresIn: CUSTOMER_TTL });
}

function verifyCustomerToken(token) {
  try {
    const payload = jwt.verify(token, config.jwtSecret);
    if (!payload || payload.type !== 'customer' || !payload.sub) return null;
    return payload;
  } catch (_) {
    return null;
  }
}

module.exports = { signCustomerToken, verifyCustomerToken };
