'use strict';

const BaseRepository = require('../repositories/BaseRepository');
const storageAdapter = require('../repositories/storageAdapter');
const logger = require('../utils/logger');

const domainRepository = new BaseRepository('tenantCustomDomains');

function _normalizeDomain(domain) {
  if (!domain || typeof domain !== 'string') return null;
  return domain.trim().toLowerCase().replace(/\.$/, '');
}

function _findDomain(domains, normalized) {
  if (!Array.isArray(domains)) return null;
  return domains.find(
    (d) => _normalizeDomain(d.custom_domain || d.customDomain) === normalized
  ) || null;
}

async function getTenantByCustomDomain(domain) {
  const normalized = _normalizeDomain(domain);
  if (!normalized) return null;

  try {
    const db = await domainRepository.readAsync();
    const found = _findDomain(db.tenantCustomDomains, normalized);
    if (!found) return null;
    if (found.status !== 'active') return null;
    return {
      tenantId: String(found.tenant_id || found.tenantId),
      customDomain: _normalizeDomain(found.custom_domain || found.customDomain),
      status: found.status,
      sslStatus: found.ssl_status || found.sslStatus || 'pending'
    };
  } catch (err) {
    logger.error('tenantCustomDomains.service: getTenantByCustomDomain failed', err.message);
    return null;
  }
}

async function addCustomDomain({ tenantId, customDomain }) {
  const normalizedTenantId = String(tenantId || '').trim();
  const normalizedDomain = _normalizeDomain(customDomain);
  if (!normalizedTenantId || !normalizedDomain) return null;

  try {
    const db = await domainRepository.readAsync();
    const domains = Array.isArray(db.tenantCustomDomains) ? db.tenantCustomDomains : [];

    const existing = _findDomain(domains, normalizedDomain);
    if (existing) {
      return {
        tenantId: String(existing.tenant_id || existing.tenantId),
        customDomain: _normalizeDomain(existing.custom_domain || existing.customDomain),
        status: existing.status,
        sslStatus: existing.ssl_status || existing.sslStatus || 'pending'
      };
    }

    const record = {
      tenant_id: normalizedTenantId,
      custom_domain: normalizedDomain,
      status: 'pending_verification',
      ssl_status: 'pending',
      created_at: new Date().toISOString()
    };

    domains.push(record);
    db.tenantCustomDomains = domains;
    await domainRepository.writeAsync(db);

    return {
      tenantId: record.tenant_id,
      customDomain: record.custom_domain,
      status: record.status,
      sslStatus: record.ssl_status
    };
  } catch (err) {
    logger.error('tenantCustomDomains.service: addCustomDomain failed', err.message);
    return null;
  }
}

async function updateDomainStatus(customDomain, status) {
  const normalizedDomain = _normalizeDomain(customDomain);
  if (!normalizedDomain) return false;

  const allowedStatuses = new Set(['pending_verification', 'active', 'disabled']);
  if (!allowedStatuses.has(status)) return false;

  try {
    const db = await domainRepository.readAsync();
    const domains = Array.isArray(db.tenantCustomDomains) ? db.tenantCustomDomains : [];
    const target = _findDomain(domains, normalizedDomain);
    if (!target) return false;

    const targetKey = _normalizeDomain(target.custom_domain || target.customDomain);
    const record = domains.find(
      (d) => _normalizeDomain(d.custom_domain || d.customDomain) === targetKey
    );
    if (!record) return false;

    record.status = status;
    if (record.custom_domain) record.custom_domain = normalizedDomain;
    if (record.customDomain) record.customDomain = normalizedDomain;
    db.tenantCustomDomains = domains;
    await domainRepository.writeAsync(db);
    return true;
  } catch (err) {
    logger.error('tenantCustomDomains.service: updateDomainStatus failed', err.message);
    return false;
  }
}

// ---------------- platform admin helpers ----------------

async function listDomainsForAdmin() {
  const db = await domainRepository.readAsync();
  const domains = Array.isArray(db.tenantCustomDomains) ? db.tenantCustomDomains : [];
  return domains.map((d) => ({
    id: d.id || null,
    tenantId: String(d.tenant_id || d.tenantId || ''),
    customDomain: _normalizeDomain(d.custom_domain || d.customDomain),
    status: d.status || 'pending_verification',
    sslStatus: d.ssl_status || d.sslStatus || 'pending',
    createdAt: d.created_at || d.createdAt || null
  }));
}

async function updateDomainStatusForAdmin(domainId, status) {
  const id = Number(domainId);
  if (!id) return false;

  const allowedStatuses = new Set(['pending_verification', 'active', 'disabled']);
  if (!allowedStatuses.has(status)) return false;

  try {
    const db = await domainRepository.readAsync();
    const domains = Array.isArray(db.tenantCustomDomains) ? db.tenantCustomDomains : [];
    const record = domains.find((d) => Number(d.id) === id);
    if (!record) return false;

    record.status = status;
    if (record.custom_domain) record.custom_domain = _normalizeDomain(record.custom_domain);
    if (record.customDomain) record.customDomain = _normalizeDomain(record.customDomain);
    db.tenantCustomDomains = domains;
    await domainRepository.writeAsync(db);
    return true;
  } catch (err) {
    logger.error('tenantCustomDomains.service: updateDomainStatusForAdmin failed', err.message);
    return false;
  }
}

module.exports = {
  getTenantByCustomDomain,
  addCustomDomain,
  updateDomainStatus,
  listDomainsForAdmin,
  updateDomainStatusForAdmin
};
