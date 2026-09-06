'use strict';

// gameHosting.service — Phase A data layer for the Game Hosting module.
//
// Phase A scope (per the Device 2 handoff plan):
//   1. Define the data model for plans, servers, and provisioning requests.
//   2. Enforce tenant isolation at every read and write.
//   3. Provide a clean API surface for the Phase B controller + routes.
//
// Phase A does NOT:
//   - Modify server.js (no new mounts; routes are deferred to Phase B).
//   - Modify permissions/registry.js (no new permissions).
//   - Modify eventBus.js.
//   - Implement real provisioning, billing, or external provider integration.
//   - Touch the existing Market / ERP / PlayStation services.
//
// The intended ownership chain is:
//   Customer (auth via marketAuth-style JWT, separate `type: 'hosting_customer'`)
//     ↓
//   Company / Tenant (server-authoritative, from req.tenantContext)
//     ↓
//   Hosting Account (per-tenant, per-customer)
//     ↓
//   Server (per-tenant, per-account)
//
// Every read filters by tenant. Every write stamps tenantId from the
// trusted context (never from the request body). Cross-tenant access
// is rejected with `null` (not-found) or `404` — never 403, to avoid
// leaking the existence of foreign records.

const { v4: uuidv4 } = require('uuid');
const BaseRepository = require('../repositories/BaseRepository');

// === Store registry ===
//
// Following the same convention as Market (marketPlans / marketServers
// would be the natural names) we use a single JSON store per
// collection type. Each store is { items: [...] } per the existing
// patterns. The three stores are intentionally separate to make
// future cross-collection transactions explicit if Phase B needs them.

const planRepository = new BaseRepository('gameHostingPlans');
const serverRepository = new BaseRepository('gameHostingServers');
const requestRepository = new BaseRepository('gameHostingRequests');

// === Trusted tenant resolution ===
//
// The Market uses req.marketTenant (a synthetic value derived from the
// X-Tenant-Id header + the requireMarketTenant middleware). Game
// Hosting uses the same trusted source. The service NEVER reads
// tenantId from the request body. The only accepted tenant context
// is the second argument to every public method.
function _trustedTenantId(tenantContext) {
  if (!tenantContext) return null;
  const t = tenantContext.tenantId;
  if (t == null || t === '') return null;
  return String(t);
}

// === Validation helpers ===
//
// Two flavors: for-create requires every field; for-update only
// validates the fields that are present in the patch. This matches
// the existing Phase 1 / Phase 22 services' pattern of separating
// strict-create validation from partial-update validation.

function _validatePlanForCreate(data) {
  const errors = [];
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return ['request body must be a JSON object'];
  }
  if (data.name === undefined || String(data.name).trim() === '') errors.push('name is required');
  if (data.name !== undefined && typeof data.name !== 'string') errors.push('name must be a string');
  if (data.gameTitle === undefined || String(data.gameTitle).trim() === '') errors.push('gameTitle is required');
  if (data.gameTitle !== undefined && typeof data.gameTitle !== 'string') errors.push('gameTitle must be a string');
  if (data.maxPlayers !== undefined && (!Number.isInteger(data.maxPlayers) || data.maxPlayers < 1)) {
    errors.push('maxPlayers must be a positive integer');
  }
  if (data.pricePerMonth !== undefined && (typeof data.pricePerMonth !== 'number' || data.pricePerMonth < 0)) {
    errors.push('pricePerMonth must be a non-negative number');
  }
  if (data.status !== undefined && !['draft', 'active', 'archived'].includes(data.status)) {
    errors.push('status must be one of draft, active, archived');
  }
  return errors;
}

function _validatePlanForUpdate(data) {
  const errors = [];
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return ['request body must be a JSON object'];
  }
  if (data.name !== undefined && (typeof data.name !== 'string' || String(data.name).trim() === '')) {
    errors.push('name must be a non-empty string');
  }
  if (data.gameTitle !== undefined && (typeof data.gameTitle !== 'string' || String(data.gameTitle).trim() === '')) {
    errors.push('gameTitle must be a non-empty string');
  }
  if (data.maxPlayers !== undefined && (!Number.isInteger(data.maxPlayers) || data.maxPlayers < 1)) {
    errors.push('maxPlayers must be a positive integer');
  }
  if (data.pricePerMonth !== undefined && (typeof data.pricePerMonth !== 'number' || data.pricePerMonth < 0)) {
    errors.push('pricePerMonth must be a non-negative number');
  }
  if (data.status !== undefined && !['draft', 'active', 'archived'].includes(data.status)) {
    errors.push('status must be one of draft, active, archived');
  }
  return errors;
}

function _validateServerForCreate(data) {
  const errors = [];
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return ['request body must be a JSON object'];
  }
  if (data.planId === undefined || String(data.planId).trim() === '') errors.push('planId is required');
  if (data.planId !== undefined && typeof data.planId !== 'string') errors.push('planId must be a string');
  if (data.serverName === undefined || String(data.serverName).trim() === '') errors.push('serverName is required');
  if (data.serverName !== undefined && typeof data.serverName !== 'string') errors.push('serverName must be a string');
  if (data.region !== undefined && typeof data.region !== 'string') errors.push('region must be a string');
  if (data.status !== undefined && !['pending', 'provisioning', 'running', 'stopped', 'terminated', 'error'].includes(data.status)) {
    errors.push('status must be one of pending, provisioning, running, stopped, terminated, error');
  }
  return errors;
}

function _validateServerForUpdate(data) {
  const errors = [];
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return ['request body must be a JSON object'];
  }
  if (data.planId !== undefined && (typeof data.planId !== 'string' || String(data.planId).trim() === '')) {
    errors.push('planId must be a non-empty string');
  }
  if (data.serverName !== undefined && (typeof data.serverName !== 'string' || String(data.serverName).trim() === '')) {
    errors.push('serverName must be a non-empty string');
  }
  if (data.region !== undefined && typeof data.region !== 'string') errors.push('region must be a string');
  if (data.status !== undefined && !['pending', 'provisioning', 'running', 'stopped', 'terminated', 'error'].includes(data.status)) {
    errors.push('status must be one of pending, provisioning, running, stopped, terminated, error');
  }
  return errors;
}

// Reject a foreign tenantId claim in a write body. The Market
// uses the same pattern (sales.service:34, marketCheckout.service:184).
function _rejectForeignTenantClaim(data, trustedTid) {
  if (data && data.tenantId !== undefined && data.tenantId !== null && data.tenantId !== '') {
    if (trustedTid && String(data.tenantId) !== trustedTid) {
      return 'tenantId claim does not match the trusted tenant';
    }
  }
  return null;
}

// === Plans ===
//
// A plan is a tenant-defined offering (e.g., "Minecraft 10 players,
// $20/month, Asia region"). Plans are per-tenant — two tenants can
// define a plan with the same name without conflict.
async function listPlans({ tenantContext, status } = {}) {
  const trustedTid = _trustedTenantId(tenantContext);
  const db = await planRepository.readAsync();
  const all = Array.isArray(db.plans) ? db.plans : [];
  let plans = all;
  if (trustedTid) plans = plans.filter((p) => p && String(p.tenantId) === trustedTid);
  if (status) plans = plans.filter((p) => String(p.status) === String(status));
  return plans.map((p) => Object.assign({}, p));
}

async function getPlanById({ id, tenantContext } = {}) {
  if (id == null || id === '') return null;
  const target = String(id).trim();
  const trustedTid = _trustedTenantId(tenantContext);
  const db = await planRepository.readAsync();
  const found = (Array.isArray(db.plans) ? db.plans : []).find((p) => p && (String(p.id) === target || String(p._backendId || '') === target));
  if (!found) return null;
  if (trustedTid && String(found.tenantId) !== trustedTid) return null;
  return found;
}

async function createPlan({ data, tenantContext } = {}) {
  const errors = _validatePlanForCreate(data);
  if (errors.length) return { error: errors.join('; ') };
  const trustedTid = _trustedTenantId(tenantContext);
  const claimErr = _rejectForeignTenantClaim(data, trustedTid);
  if (claimErr) return { error: claimErr };

  const now = new Date().toISOString();
  const plan = {
    id: uuidv4(),
    tenantId: trustedTid || null,
    name: String(data.name).trim(),
    gameTitle: String(data.gameTitle).trim(),
    maxPlayers: Number.isInteger(data.maxPlayers) ? data.maxPlayers : null,
    pricePerMonth: typeof data.pricePerMonth === 'number' ? data.pricePerMonth : null,
    region: data.region || null,
    status: data.status || 'draft',
    createdAt: now,
    updatedAt: now
  };
  const db = await planRepository._rawStoreAsync();
  if (!db.plans) db.plans = [];
  // Per-tenant uniqueness on plan name.
  if (db.plans.some((p) => p && String(p.tenantId || '') === String(plan.tenantId || '') && String(p.name).toLowerCase() === plan.name.toLowerCase())) {
    return { error: 'Duplicate plan name for this tenant' };
  }
  db.plans.push(plan);
  if (await planRepository.writeAsync(db)) return { plan: Object.assign({}, plan) };
  return { error: 'Failed to persist plan' };
}

async function updatePlan({ id, data, tenantContext } = {}) {
  if (id == null || id === '') return { error: 'id is required' };
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { error: 'request body must be a JSON object' };
  }
  const errors = _validatePlanForUpdate(data);
  if (errors.length) return { error: errors.join('; ') };
  const target = String(id).trim();
  const trustedTid = _trustedTenantId(tenantContext);
  const db = await planRepository._rawStoreAsync();
  const idx = (db.plans || []).findIndex((p) => p && (String(p.id) === target || String(p._backendId || '') === target));
  if (idx === -1) return { error: 'Plan not found' };
  if (trustedTid && String(db.plans[idx].tenantId) !== trustedTid) return { error: 'Plan not found' };
  const claimErr = _rejectForeignTenantClaim(data, trustedTid);
  if (claimErr) return { error: claimErr };

  if (data.name !== undefined) db.plans[idx].name = String(data.name).trim();
  if (data.gameTitle !== undefined) db.plans[idx].gameTitle = String(data.gameTitle).trim();
  if (data.maxPlayers !== undefined) db.plans[idx].maxPlayers = Number.isInteger(data.maxPlayers) ? data.maxPlayers : db.plans[idx].maxPlayers;
  if (data.pricePerMonth !== undefined) db.plans[idx].pricePerMonth = typeof data.pricePerMonth === 'number' ? data.pricePerMonth : db.plans[idx].pricePerMonth;
  if (data.region !== undefined) db.plans[idx].region = data.region || null;
  if (data.status !== undefined) db.plans[idx].status = data.status;
  db.plans[idx].updatedAt = new Date().toISOString();
  if (await planRepository.writeAsync(db)) return { plan: Object.assign({}, db.plans[idx]) };
  return { error: 'Failed to persist plan update' };
}

async function deletePlan({ id, tenantContext } = {}) {
  if (id == null || id === '') return { error: 'id is required' };
  const target = String(id).trim();
  const trustedTid = _trustedTenantId(tenantContext);
  const db = await planRepository._rawStoreAsync();
  const idx = (db.plans || []).findIndex((p) => p && (String(p.id) === target || String(p._backendId || '') === target));
  if (idx === -1) return { error: 'Plan not found' };
  if (trustedTid && String(db.plans[idx].tenantId) !== trustedTid) return { error: 'Plan not found' };
  db.plans.splice(idx, 1);
  if (await planRepository.writeAsync(db)) return { success: true };
  return { error: 'Failed to persist plan delete' };
}

// === Servers ===
//
// A server is a provisioned (or being-provisioned) game server
// instance. The status field drives the customer-facing dashboard
// state. Phase A only defines the data shape and tenant isolation;
// Phase B will own the provisioning engine.

async function listServers({ query, tenantContext } = {}) {
  const trustedTid = _trustedTenantId(tenantContext);
  const db = await serverRepository.readAsync();
  let servers = Array.isArray(db.servers) ? db.servers : [];
  if (trustedTid) servers = servers.filter((s) => s && String(s.tenantId) === trustedTid);
  if (query && query.status) servers = servers.filter((s) => String(s.status) === String(query.status));
  if (query && query.planId) servers = servers.filter((s) => String(s.planId) === String(query.planId));
  if (query && query.customerId) servers = servers.filter((s) => String(s.customerId) === String(query.customerId));
  return servers;
}

async function getServerById({ id, tenantContext } = {}) {
  if (id == null || id === '') return null;
  const target = String(id).trim();
  const trustedTid = _trustedTenantId(tenantContext);
  const db = await serverRepository.readAsync();
  const found = (Array.isArray(db.servers) ? db.servers : []).find((s) => s && (String(s.id) === target || String(s._backendId || '') === target));
  if (!found) return null;
  if (trustedTid && String(found.tenantId) !== trustedTid) return null;
  return found;
}

async function createServer({ data, tenantContext } = {}) {
  const errors = _validateServerForCreate(data);
  if (errors.length) return { error: errors.join('; ') };
  const trustedTid = _trustedTenantId(tenantContext);
  const claimErr = _rejectForeignTenantClaim(data, trustedTid);
  if (claimErr) return { error: claimErr };
  if (data.planId) {
    // Verify the plan belongs to the trusted tenant.
    const plan = await getPlanById({ id: data.planId, tenantContext });
    if (!plan) return { error: 'Plan not found in trusted tenant' };
  }
  const now = new Date().toISOString();
  const server = {
    id: uuidv4(),
    tenantId: trustedTid || null,
    planId: String(data.planId).trim(),
    serverName: String(data.serverName).trim(),
    region: data.region || null,
    status: data.status || 'pending',
    customerId: data.customerId || null,
    createdAt: now,
    updatedAt: now
  };
  const db = await serverRepository._rawStoreAsync();
  if (!db.servers) db.servers = [];
  db.servers.push(server);
  if (await serverRepository.writeAsync(db)) return { server: Object.assign({}, server) };
  return { error: 'Failed to persist server' };
}

async function updateServer({ id, data, tenantContext } = {}) {
  if (id == null || id === '') return { error: 'id is required' };
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { error: 'request body must be a JSON object' };
  }
  const errors = _validateServerForUpdate(data);
  if (errors.length) return { error: errors.join('; ') };
  const target = String(id).trim();
  const trustedTid = _trustedTenantId(tenantContext);
  const db = await serverRepository._rawStoreAsync();
  const idx = (db.servers || []).findIndex((s) => s && (String(s.id) === target || String(s._backendId || '') === target));
  if (idx === -1) return { error: 'Server not found' };
  if (trustedTid && String(db.servers[idx].tenantId) !== trustedTid) return { error: 'Server not found' };
  const claimErr = _rejectForeignTenantClaim(data, trustedTid);
  if (claimErr) return { error: claimErr };
  if (data.planId !== undefined) db.servers[idx].planId = String(data.planId).trim();
  if (data.serverName !== undefined) db.servers[idx].serverName = String(data.serverName).trim();
  if (data.region !== undefined) db.servers[idx].region = data.region || null;
  if (data.status !== undefined) db.servers[idx].status = data.status;
  if (data.customerId !== undefined) db.servers[idx].customerId = data.customerId || null;
  db.servers[idx].updatedAt = new Date().toISOString();
  if (await serverRepository.writeAsync(db)) return { server: Object.assign({}, db.servers[idx]) };
  return { error: 'Failed to persist server update' };
}

async function deleteServer({ id, tenantContext } = {}) {
  if (id == null || id === '') return { error: 'id is required' };
  const target = String(id).trim();
  const trustedTid = _trustedTenantId(tenantContext);
  const db = await serverRepository._rawStoreAsync();
  const idx = (db.servers || []).findIndex((s) => s && (String(s.id) === target || String(s._backendId || '') === target));
  if (idx === -1) return { error: 'Server not found' };
  if (trustedTid && String(db.servers[idx].tenantId) !== trustedTid) return { error: 'Server not found' };
  db.servers.splice(idx, 1);
  if (await serverRepository.writeAsync(db)) return { success: true };
  return { error: 'Failed to persist server delete' };
}

// === Provisioning requests ===
//
// A provisioning request is a customer-initiated ask to spin up a
// new server. Phase A records the request; Phase B will own the
// engine that actually provisions the server.
//
// Phase 4 adds:
//   - entitlement check before creation
//   - idempotency protection
//   - extended statuses: pending, approved, rejected, provisioning, error

const ENTITLEMENT_SERVICE = require('./gameHostingEntitlement.service');

async function createProvisioningRequest({ data, tenantContext } = {}) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { error: 'request body must be a JSON object' };
  }
  const trustedTid = _trustedTenantId(tenantContext);
  if (data.planId === undefined || String(data.planId).trim() === '') {
    return { error: 'planId is required' };
  }
  const plan = await getPlanById({ id: data.planId, tenantContext });
  if (!plan) return { error: 'Plan not found in trusted tenant' };

  const customerId = data.customerId ? String(data.customerId).trim() : null;

  if (customerId) {
    const entitlementCheck = await ENTITLEMENT_SERVICE.findActiveEntitlement({
      customerId,
      planId: data.planId,
      tenantContext
    });
    if (!entitlementCheck) {
      return { error: 'No active entitlement for this plan. Contact your administrator.' };
    }
  }

  const idempotencyKey = data.idempotencyKey ? String(data.idempotencyKey).trim() : null;
  if (idempotencyKey) {
    const db = await requestRepository.readAsync();
    const all = Array.isArray(db.requests) ? db.requests : [];
    const duplicate = all.find((r) => {
      if (!r) return false;
      if (trustedTid && String(r.tenantId) !== trustedTid) return false;
      if (String(r.customerId) !== String(customerId)) return false;
      if (String(r.planId) !== String(data.planId)) return false;
      if (String(r.idempotencyKey || '') !== String(idempotencyKey)) return false;
      return true;
    });
    if (duplicate) {
      return { request: Object.assign({}, duplicate), idempotent: true };
    }
  }

  const now = new Date().toISOString();
  const request = {
    id: uuidv4(),
    tenantId: trustedTid || null,
    planId: String(data.planId).trim(),
    customerId,
    requestedRegion: data.region || null,
    status: 'pending',
    providerStatus: null,
    idempotencyKey: idempotencyKey,
    createdAt: now,
    updatedAt: now
  };
  const db = await requestRepository._rawStoreAsync();
  if (!db.requests) db.requests = [];
  db.requests.push(request);
  if (await requestRepository.writeAsync(db)) return { request: Object.assign({}, request) };
  return { error: 'Failed to persist provisioning request' };
}

async function updateProvisioningRequestStatus({ id, status, providerStatus, tenantContext } = {}) {
  if (id == null || id === '') return { error: 'id is required' };
  if (!status || !['approved', 'rejected', 'provisioning', 'error', 'pending'].includes(status)) {
    return { error: 'status must be one of approved, rejected, provisioning, error, pending' };
  }
  const target = String(id).trim();
  const trustedTid = _trustedTenantId(tenantContext);
  const db = await requestRepository._rawStoreAsync();
  const idx = (db.requests || []).findIndex((r) => r && (String(r.id) === target || String(r._backendId || '') === target));
  if (idx === -1) return { error: 'Provisioning request not found' };
  if (trustedTid && String(db.requests[idx].tenantId) !== trustedTid) return { error: 'Provisioning request not found' };
  db.requests[idx].status = status;
  if (providerStatus !== undefined) db.requests[idx].providerStatus = providerStatus;
  db.requests[idx].updatedAt = new Date().toISOString();
  if (await requestRepository.writeAsync(db)) return { request: Object.assign({}, db.requests[idx]) };
  return { error: 'Failed to persist provisioning request update' };
}

async function getProvisioningRequestById({ id, tenantContext } = {}) {
  if (id == null || id === '') return null;
  const target = String(id).trim();
  const trustedTid = _trustedTenantId(tenantContext);
  const db = await requestRepository.readAsync();
  const found = (Array.isArray(db.requests) ? db.requests : []).find((r) => r && (String(r.id) === target || String(r._backendId || '') === target));
  if (!found) return null;
  if (trustedTid && String(found.tenantId) !== trustedTid) return null;
  return found;
}

async function listProvisioningRequests({ tenantContext, customerId } = {}) {
  const trustedTid = _trustedTenantId(tenantContext);
  const db = await requestRepository.readAsync();
  let requests = Array.isArray(db.requests) ? db.requests : [];
  if (trustedTid) requests = requests.filter((r) => r && String(r.tenantId) === trustedTid);
  if (customerId) requests = requests.filter((r) => String(r.customerId) === String(customerId));
  return requests;
}

module.exports = {
  STORE_NAMES: {
    plans: 'gameHostingPlans',
    servers: 'gameHostingServers',
    requests: 'gameHostingRequests'
  },
  listPlans,
  getPlanById,
  createPlan,
  updatePlan,
  deletePlan,
  listServers,
  getServerById,
  createServer,
  updateServer,
  deleteServer,
  createProvisioningRequest,
  updateProvisioningRequestStatus,
  getProvisioningRequestById,
  listProvisioningRequests,
  // Exposed for tests
  _validatePlanForCreate,
  _validatePlanForUpdate,
  _validateServerForCreate,
  _validateServerForUpdate,
  _rejectForeignTenantClaim,
  _trustedTenantId
};
