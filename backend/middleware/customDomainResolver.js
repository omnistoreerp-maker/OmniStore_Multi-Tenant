'use strict';

// customDomainResolver — resolves tenant from custom domain host headers.
//
// Responsibilities:
//   1. Inspect `req.headers.host` / `x-forwarded-host` for custom domains.
//   2. If host matches a registered ACTIVE custom domain, attach the tenant.
//   3. If host matches a domain but it is NOT active, return a structured 404.
//   4. If host is the main platform domain or localhost, pass through.
//   5. Never override an already-resolved tenant context (auth/JWT wins).
//
// Placement: run AFTER tenantCarry so auth-bound tenants take precedence.
// Only active when ENABLE_CUSTOM_DOMAIN_RESOLUTION is true.

const config = require('../config');
const customDomainService = require('../services/tenantCustomDomains.service');
const TenantContext = require('../tenant/TenantContext');
const ContextFactory = require('../context/ContextFactory');
const requestContextLike = require('../context/RequestContext');
const tenantStore = require('./tenantStore');
const logger = require('../utils/logger');

function _extractHost(req) {
  const xForwardedHost = req.headers['x-forwarded-host'];
  if (xForwardedHost && typeof xForwardedHost === 'string') {
    return xForwardedHost.split(',')[0].trim();
  }
  const host = req.headers['host'];
  if (host && typeof host === 'string') {
    return host.split(':')[0].trim();
  }
  return '';
}

function _isPlatformDomain(host, platformDomain) {
  const normalizedHost = host.toLowerCase();
  const normalizedPlatform = platformDomain.toLowerCase();
  if (normalizedHost === normalizedPlatform) return true;
  if (normalizedHost === 'localhost' || normalizedHost === '127.0.0.1') return true;
  if (normalizedHost.endsWith('.localhost')) return true;
  if (normalizedPlatform && normalizedHost.endsWith('.' + normalizedPlatform)) return true;
  return false;
}

function _attachTenant(req, tenantId) {
  const tenant = TenantContext.create({
    tenantId,
    tenantName: null,
    status: 'active'
  });

  const base = req.requestContext instanceof requestContextLike
    ? req.requestContext
    : ContextFactory.createEmpty();
  req.requestContext = base.with({ tenant });
  req.tenantContext = tenant;

  tenantStore.set({ tenantId });
}

function customDomainResolver(req, res, next) {
  if (!config.customDomainResolutionEnabled) return next();
  if (req.tenantContext && req.tenantContext.tenantId) return next();

  const host = _extractHost(req);
  if (!host) return next();

  if (_isPlatformDomain(host, config.platformDomain)) return next();

  customDomainService.getTenantByCustomDomain(host).then((result) => {
    if (!result) return next();

    if (result.status !== 'active') {
      return res.status(404).json({
        status: 'error',
        message: 'Domain is not active',
        code: 'CUSTOM_DOMAIN_INACTIVE',
        customDomain: host
      });
    }

    _attachTenant(req, result.tenantId);
    next();
  }).catch((err) => {
    logger.error('customDomainResolver: resolution failed', err.message);
    next();
  });
}

module.exports = customDomainResolver;
