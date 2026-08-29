const { error } = require('../utils/apiResponse');
const { verifyCustomerToken } = require('../utils/marketJwt');
const { isRevoked } = require('../utils/tokenStore');
const marketAuthService = require('../services/marketAuth.service');
const marketConfigService = require('../services/marketConfig.service');

function extractToken(req) {
  const header = req.headers.authorization || '';
  if (header.startsWith('Bearer ')) return header.slice(7).trim();
  return null;
}

function resolveTenantId(req) {
  const fromHeader = req.header && req.header('X-Tenant-Id');
  if (fromHeader) return String(fromHeader).trim();
  if (req.query && req.query.tenant) return String(req.query.tenant).trim();
  if (req.body && req.body.tenantId) return String(req.body.tenantId).trim();
  return null;
}

function requireMarketTenant(req, res, next) {
  const tenantId = resolveTenantId(req);
  if (!tenantId) return error(res, 'tenantId is required', 400);
  if (!marketConfigService.exists(tenantId)) return error(res, 'Unknown tenant', 404);
  req.marketTenant = tenantId;
  next();
}

function requireCustomer(req, res, next) {
  const token = extractToken(req);
  if (!token || isRevoked(token)) return error(res, 'Authentication required', 401);
  const payload = verifyCustomerToken(token);
  if (!payload) return error(res, 'Authentication required', 401);
  const customer = marketAuthService.getById(payload.sub);
  if (!customer) return error(res, 'Authentication required', 401);
  if (Number(customer.tokenVersion || 0) !== Number(payload.ver || 0)) {
    return error(res, 'Authentication required', 401);
  }
  if (req.marketTenant && String(customer.tenantId) !== String(req.marketTenant)) {
    return error(res, 'Tenant mismatch', 403);
  }
  req.customer = {
    id: customer.id,
    tenantId: customer.tenantId,
    email: customer.email,
    name: customer.name
  };
  next();
}

function optionalCustomer(req, res, next) {
  const token = extractToken(req);
  if (token && !isRevoked(token)) {
    const payload = verifyCustomerToken(token);
    if (payload) {
      const customer = marketAuthService.getById(payload.sub);
      if (customer && Number(customer.tokenVersion || 0) === Number(payload.ver || 0)) {
        if (!req.marketTenant || String(customer.tenantId) === String(req.marketTenant)) {
          req.customer = {
            id: customer.id,
            tenantId: customer.tenantId,
            email: customer.email,
            name: customer.name
          };
        }
      }
    }
  }
  next();
}

module.exports = { extractToken, resolveTenantId, requireMarketTenant, requireCustomer, optionalCustomer };
