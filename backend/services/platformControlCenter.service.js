'use strict';

// Platform Control Center — orchestration service.
//
// PLATFORM scope only. Every read/write here is gated by the platform
// authorization middleware (requirePlatformPermission); this module never reads
// tenant query/body/header state and never reaches across tenant stores except
// through the pre-existing platform-safe services (platform.service,
// platformOrdersAggregator) that already enforce the cross-tenant boundary.
//
// Honesty contract: metrics are read from REAL stores/services. When a source
// is unavailable it is reported as `null` / `unavailable` — never as invented
// numbers.

const platformAdmin = require('./platformAdmin.service');
const platformRegistry = require('../permissions/platformRegistry');
const platform = require('./platform.service');
const platformActivity = require('./platformActivity.service');
const platformCatalog = require('./platformCatalog.service');
const platformContent = require('./platformContent.service');
const auditService = require('./audit.service');
const errorTracker = require('./errorTracker.service');
const healthService = require('./health.service');
const buildIdentity = require('./buildIdentity.service');
const presenceService = require('./presence.service');
const logger = require('../utils/logger');

// ---- audit helper (platform scope; never stores secrets) ----
function _audit(actor, action, resource, resourceId, changes) {
  try {
    auditService.record({
      method: 'POST',
      path: '/api/v1/platform/control-center/' + resource + (resourceId ? '/' + resourceId : ''),
      statusCode: 200,
      userId: actor ? actor.id : null,
      action,
      resource,
      resourceId: resourceId || null,
      changes: changes || null
    });
  } catch (err) {
    // Audit must never break the platform operation.
  }
}

function _safe(fn, fallback) {
  try {
    return fn();
  } catch (err) {
    logger.warn('platformControlCenter: source unavailable —', err.message);
    return fallback;
  }
}

// ---- access (role-aware UI bootstrap; server is still the authority) ----
function access(actor) {
  const permissions = platformAdmin.resolvePermissionsFor(actor.username);
  return {
    username: actor.username,
    platformRole: actor.platformRole,
    permissions,
    fullAccess: permissions.includes(platformRegistry.ALL_WILDCARD)
  };
}

// ---- dashboard (real metrics only) ----
function dashboard() {
  const summary = _safe(() => platform.summary(), null);
  const activity = _safe(() => platformActivity.getStats(), null);
  const onlineCount = _safe(() => presenceService.countOnline(), null);
  const catalog = _safe(() => platformCatalog.getCatalog(), null);
  const auditStats = _safe(() => auditService.getStats(), null);
  const errorStats = _safe(() => errorTracker.getStats(), null);

  const activeServices = catalog && Array.isArray(catalog.sections)
    ? catalog.sections
        .filter(s => s && String(s.status || '').toLowerCase() === 'active')
        .map(s => ({ id: s.id, title: s.title, status: 'active' }))
    : null;

  const mem = process.memoryUsage();

  return {
    businesses: summary ? summary.companies : { available: false },
    users: summary ? { total: summary.users.total, online: onlineCount != null ? onlineCount : summary.users.online } : { available: false },
    licenses: summary ? summary.licenses : { available: false },
    orders: {
      today: activity ? activity.ordersToday : null,
      activeBusinesses: activity ? activity.activeBusinesses : null
    },
    visitors: activity ? activity.visitorsNow : null,
    activeServices,
    security: {
      auditEntries: auditStats ? auditStats.total : null,
      auditLastDay: auditStats ? auditStats.lastDay : null,
      openErrors: errorStats ? errorStats.open : null
    },
    system: {
      status: 'ok',
      uptimeSeconds: Math.round(process.uptime()),
      node: process.version,
      memoryRssMb: Math.round(mem.rss / 1024 / 1024 * 10) / 10
    },
    generatedAt: new Date().toISOString()
  };
}

// ---- team management ----
function _memberView(member) {
  const role = member.platformRole || 'PLATFORM_ADMIN';
  return Object.assign({}, member, {
    effectivePermissions: platformRegistry.resolvePermissions(role, member.permissions)
  });
}

function listTeam() {
  return platformAdmin.listMembers().map(_memberView);
}

function addTeamMember(actor, data) {
  const username = String((data && data.username) || '').trim();
  const platformRole = (data && data.platformRole) || 'DATA_ENTRY';
  const result = platformAdmin.addMember(username, platformRole, {
    displayName: data && data.displayName,
    permissions: data && data.permissions,
    addedBy: actor ? actor.username : null
  });
  if (result.error) return { error: result.error, status: 400 };
  _audit(actor, 'PLATFORM_TEAM_MEMBER_ADDED', 'team', result.member.username, {
    actor: actor ? actor.username : null,
    target: result.member.username,
    platformRole: result.member.platformRole,
    result: 'added'
  });
  return { member: _memberView(result.member) };
}

function updateTeamMember(actor, username, data) {
  const existing = platformAdmin.memberFor(username);
  if (!existing) return { error: 'Member not found', status: 404 };

  const changes = [];
  const target = String(username).trim();

  // Guard: never let the LAST active MASTER_OWNER be demoted or disabled.
  const isOwner = platformRegistry.normalizeRole(existing.platformRole) === 'MASTER_OWNER';
  const demoting = data && data.platformRole !== undefined &&
    platformRegistry.normalizeRole(data.platformRole) !== 'MASTER_OWNER';
  const disabling = data && data.status !== undefined && String(data.status).toLowerCase() === 'disabled';
  if (isOwner && (demoting || disabling) && platformAdmin.activeOwnerCount() <= 1) {
    return { error: 'Cannot demote or disable the last active MASTER_OWNER', status: 409 };
  }

  if (data && data.platformRole !== undefined) {
    const res = platformAdmin.setMemberRole(target, data.platformRole);
    if (res.error) return { error: res.error, status: 400 };
    changes.push('platformRole=' + res.member.platformRole);
  }
  if (data && data.status !== undefined) {
    const res = platformAdmin.setMemberStatus(target, data.status);
    if (res.error) return { error: res.error, status: 400 };
    changes.push('status=' + res.member.status);
  }
  if (data && data.permissions !== undefined) {
    const res = platformAdmin.setMemberPermissions(target, data.permissions);
    if (res.error) return { error: res.error, status: 400 };
    changes.push('permissions=' + res.member.permissions.join(','));
  }

  const updated = platformAdmin.memberFor(target);
  _audit(actor, 'PLATFORM_TEAM_MEMBER_UPDATED', 'team', target, {
    actor: actor ? actor.username : null,
    target,
    changes,
    result: 'updated'
  });
  return { member: _memberView(platformAdmin.listMembers().find(m => m.username === updated.username)) };
}

function removeTeamMember(actor, username) {
  const existing = platformAdmin.memberFor(username);
  if (!existing) return { error: 'Member not found', status: 404 };
  const target = existing.username;
  const isOwner = platformRegistry.normalizeRole(existing.platformRole) === 'MASTER_OWNER';
  if (isOwner && platformAdmin.activeOwnerCount() <= 1) {
    return { error: 'Cannot remove the last active MASTER_OWNER', status: 409 };
  }
  if (String(existing.username).toLowerCase() === String(actor && actor.username || '').toLowerCase()) {
    return { error: 'You cannot remove your own platform membership', status: 409 };
  }
  const result = platformAdmin.removeMember(target);
  if (result.error) return { error: result.error, status: 400 };
  _audit(actor, 'PLATFORM_TEAM_MEMBER_REMOVED', 'team', target, {
    actor: actor ? actor.username : null,
    target,
    result: 'removed'
  });
  return { ok: true, username: target };
}

// ---- platform content catalog (DATA_ENTRY domain) ----
function listCatalog(query) {
  return platformContent.list(query);
}

function createCatalogEntry(actor, data) {
  const result = platformContent.create(actor, data);
  if (result.error) return { error: result.error, status: result.status || 400 };
  _audit(actor, 'PLATFORM_CATALOG_ENTRY_CREATED', 'catalog', result.entry.id, {
    actor: actor ? actor.username : null,
    entryId: result.entry.id,
    type: result.entry.type,
    result: 'created'
  });
  return { entry: result.entry };
}

function updateCatalogEntry(actor, id, data) {
  const result = platformContent.update(actor, id, data);
  if (result.error) return { error: result.error, status: result.status || 400 };
  _audit(actor, 'PLATFORM_CATALOG_ENTRY_UPDATED', 'catalog', result.entry.id, {
    actor: actor ? actor.username : null,
    entryId: result.entry.id,
    result: 'updated'
  });
  return { entry: result.entry };
}

// ---- developer diagnostics (never secrets) ----
// Exposes ONLY technical status: component checks, artifact/build identity,
// recent error summaries (message/level/route/occurrences — never stacks),
// and integration connection state (masked markers only). No env values, no
// JWT/password material, no API keys, no tokens.
function listDiagnosticsErrors(limit) {
  const max = Math.min(100, Math.max(1, Number(limit) || 20));
  return errorTracker.list({ limit: max }).map(i => ({
    id: i.id,
    message: i.message,
    level: i.level,
    code: i.code || null,
    route: i.route || null,
    method: i.method || null,
    occurrences: i.occurrences,
    status: i.status,
    firstSeen: i.firstSeen || null,
    lastSeen: i.lastSeen || null
  }));
}

function diagnostics(limit) {
  const health = _safe(() => healthService.runAll(), null);
  return {
    health,
    services: health && health.checks ? health.checks : null,
    build: _safe(() => buildIdentity.getBuildIdentity(), null),
    integrations: _safe(() => platform.listIntegrations(), null),
    errors: {
      stats: _safe(() => errorTracker.getStats(), null),
      recent: _safe(() => listDiagnosticsErrors(limit), [])
    },
    generatedAt: new Date().toISOString()
  };
}

// ---- permission matrix (roles.manage) ----
function permissionMatrix() {
  return {
    roles: platformRegistry.roles(),
    groups: platformRegistry.groups(),
    matrix: platformRegistry.matrix()
  };
}

module.exports = {
  access,
  dashboard,
  listTeam,
  addTeamMember,
  updateTeamMember,
  removeTeamMember,
  listCatalog,
  createCatalogEntry,
  updateCatalogEntry,
  diagnostics,
  listDiagnosticsErrors,
  permissionMatrix
};