const usersService = require('../services/users.service');
const { success, error } = require('../utils/apiResponse');
const logger = require('../utils/logger');
const auditService = require('../services/audit.service');
const { validatePassword } = require('../utils/passwordPolicy');
const { trustedTenantId } = require('../middleware/authorize');
const authorization = require('../services/authorization.service');
const registry = require('../permissions/registry');

function list(req, res) {
  try {
    const scope = _readTenantScope(req);
    const result = usersService.list(req.query, scope);
    result.users = result.users.map(usersService.sanitizeUser);
    success(res, result, 'Users retrieved');
  } catch (err) {
    logger.error('users.list error:', err.message);
    error(res, 'Failed to retrieve users', 500);
  }
}

function getById(req, res) {
  try {
    const user = usersService.getById(req.params.id);
    if (!user) return error(res, 'User not found', 404);
    // Phase G — trusted-tenant read scope: a record bound to another tenant is
    // indistinguishable from missing (no existence leak).
    const scope = _readTenantScope(req);
    if (scope !== undefined && scope !== null && !isTargetInTenant(user, scope)) {
      return error(res, 'User not found', 404);
    }
    success(res, usersService.sanitizeUser(user), 'User retrieved');
  } catch (err) {
    logger.error('users.getById error:', err.message);
    error(res, 'Failed to retrieve user', 500);
  }
}

function getStats(req, res) {
  try {
    const scope = _readTenantScope(req);
    const result = usersService.stats(scope);
    success(res, result, 'User stats retrieved');
  } catch (err) {
    logger.error('users.stats error:', err.message);
    error(res, 'Failed to retrieve user stats', 500);
  }
}

// Phase G — a READ surface is tenant-scoped ONLY when the request carries an
// authenticated trusted tenant (never client-supplied). Legacy/unauthenticated
// requests keep the global view exactly as before.
function _readTenantScope(req) {
  if (!req.user) return undefined;
  const tenantId = trustedTenantId(req);
  return tenantId === undefined || tenantId === null ? undefined : tenantId;
}

function create(req, res) {
  try {
    const result = usersService.create(req.body);
    if (result.error) return error(res, result.error, 400);
    success(res, usersService.sanitizeUser(result.user), 'User created', 201);
  } catch (err) {
    logger.error('users.create error:', err.message);
    error(res, 'Failed to create user', 500);
  }
}

function update(req, res) {
  try {
    const targetId = String(req.params.id || '');
    if (!targetId) return error(res, 'Missing user id', 400);

    const target = usersService.getById(targetId);
    if (!target) return error(res, 'User not found', 404);

    const tenantId = trustedTenantId(req);

    // Phase G — write (update/delete/role) surface: in tenant mode the actor
    // must be privileged OR hold users.edit for the target's tenant, and the
    // target must actually belong to that tenant (cross-tenant + vertical
    // escalation closure). Mirrors the Phase E sub-resource endpoints.
    if (tenantId && req.user && !authorization.canManageUser(req.user, target, tenantId)) {
      return error(res, 'Insufficient permission to modify this user', 403, { code: 'PERMISSION_DENIED' });
    }

    if (tenantId && req.body && req.body.role !== undefined && req.body.role !== target.role) {
      const targetRole = authorization.resolveEffectiveRole(target, tenantId);
      if (targetRole === 'Owner') {
        const allUsers = usersService.list().users;
        const tenantUsers = allUsers.filter(u => isTargetInTenant(u, tenantId));
        const owners = tenantUsers.filter(u => authorization.resolveEffectiveRole(u, tenantId) === 'Owner');
        if (owners.length <= 1) {
          return error(res, 'Cannot change role of the last Owner in the tenant', 409, { code: 'LAST_OWNER_PROTECTION' });
        }
      }
      if (!authorization.canManageRole(req.user, req.body.role, tenantId)) {
        return error(res, 'Insufficient permission to assign this role', 403, { code: 'PERMISSION_DENIED' });
      }
    }

    const result = usersService.update(targetId, req.body);
    if (result.error === 'User not found') return error(res, result.error, 404);
    if (result.error) return error(res, result.error, 400);

    if (tenantId && req.body && req.body.role !== undefined && req.body.role !== target.role) {
      try {
        auditService.record({
          method: 'PUT',
          path: '/api/v1/users/' + targetId,
          statusCode: 200,
          userId: req.user.id,
          action: 'USER_ROLE_CHANGED',
          resource: 'user',
          resourceId: targetId,
          changes: { before: { role: target.role }, after: { role: req.body.role } }
        });
      } catch (err) {
        logger.error('users.update audit error:', err.message);
      }
    }

    success(res, usersService.sanitizeUser(result.user), 'User updated');
  } catch (err) {
    logger.error('users.update error:', err.message);
    error(res, 'Failed to update user', 500);
  }
}

function remove(req, res) {
  try {
    const targetId = String(req.params.id || '');
    if (!targetId) return error(res, 'Missing user id', 400);

    const target = usersService.getById(targetId);
    if (!target) return error(res, 'User not found', 404);

    const tenantId = trustedTenantId(req);

    // Phase G — tenant-mode write gate (see update): reject cross-tenant and
    // vertical-escalation deletes before any ownership check runs.
    if (tenantId && req.user && !authorization.canManageUser(req.user, target, tenantId)) {
      return error(res, 'Insufficient permission to delete this user', 403, { code: 'PERMISSION_DENIED' });
    }

    if (tenantId) {
      const targetRole = authorization.resolveEffectiveRole(target, tenantId);
      if (targetRole === 'Owner') {
        const allUsers = usersService.list().users;
        const tenantUsers = allUsers.filter(u => isTargetInTenant(u, tenantId));
        const owners = tenantUsers.filter(u => authorization.resolveEffectiveRole(u, tenantId) === 'Owner');
        if (owners.length <= 1) {
          return error(res, 'Cannot delete the last Owner in the tenant', 409, { code: 'LAST_OWNER_PROTECTION' });
        }
      }
    }

    const result = usersService.delete(targetId);
    if (result.error === 'User not found') return error(res, result.error, 404);
    if (result.error) return error(res, result.error, 500);
    success(res, null, 'User deleted');
  } catch (err) {
    logger.error('users.remove error:', err.message);
    error(res, 'Failed to delete user', 500);
  }
}

// Does the TARGET user actually belong to the trusted tenant? Unbound targets
// live in the shared legacy space and stay reachable. Tenant membership derives
// from the stored record (tenantIds / tenantRoles) only.
function isTargetInTenant(target, tenantId) {
  if (tenantId === undefined || tenantId === null) return true;
  const tenants = new Set();
  if (target && Array.isArray(target.tenantIds)) {
    for (const t of target.tenantIds) if (t != null) tenants.add(String(t));
  }
  if (target && target.tenantRoles && typeof target.tenantRoles === 'object') {
    for (const t of Object.keys(target.tenantRoles)) tenants.add(String(t));
  }
  if (tenants.size === 0) return true;
  return tenants.has(String(tenantId));
}

// Phase D — admin password reset. Requires `users.password.reset`. The target
// must (a) exist, (b) not be the caller themselves (self-service uses
// change-password), and (c) belong to the trusted tenant when tenant features
// are active. On success the password is updated, tokenVersion bumped, and a
// USER_PASSWORD_RESET audit event recorded without the new password.
function resetPassword(req, res) {
  try {
    if (!req.user) return error(res, 'Authentication required', 401);
    const targetId = String(req.params.id || '');
    if (!targetId) return error(res, 'Missing user id', 400);
    if (String(targetId) === String(req.user.id)) {
      return error(res, 'Self-reset is not allowed; use change-password for your own account', 400);
    }

    const { newPassword } = req.body || {};
    if (newPassword === undefined || newPassword === null) {
      return error(res, 'newPassword is required', 400);
    }

    const target = usersService.getById(targetId);
    if (!target) return error(res, 'User not found', 404);

    const tenantId = trustedTenantId(req);
    if (!isTargetInTenant(target, tenantId)) {
      return error(res, 'Target user is outside the current tenant', 403, { code: 'PERMISSION_DENIED' });
    }

    const policy = validatePassword(newPassword);
    if (!policy.valid) {
      return error(res, 'Password does not meet policy requirements: ' + policy.errors.join('; '), 400, { code: 'PASSWORD_POLICY_VIOLATION' });
    }

    const updated = usersService.update(targetId, { password: newPassword });
    if (updated.error === 'User not found') return error(res, updated.error, 404);
    if (updated.error) return error(res, updated.error, 400);

    const bump = usersService.bumpTokenVersion(targetId);
    if (bump.error) return error(res, bump.error, 400);

    try {
      auditService.record({
        method: 'POST',
        path: '/api/v1/users/' + targetId + '/reset-password',
        statusCode: 200,
        userId: req.user.id,
        action: 'USER_PASSWORD_RESET',
        resource: 'user',
        resourceId: targetId,
        changes: { before: {}, after: { password: newPassword, tokenVersion: bump.tokenVersion } }
      });
    } catch (err) {
      logger.error('users.resetPassword audit error:', err.message);
    }

    return success(res, null, 'Password reset successfully');
  } catch (err) {
    logger.error('users.resetPassword error:', err.message);
    error(res, 'Failed to reset password', 500);
  }
}

function getPermissions(req, res) {
  try {
    if (!req.user) return error(res, 'Authentication required', 401);
    const targetId = String(req.params.id || '');
    if (!targetId) return error(res, 'Missing user id', 400);

    const target = usersService.getById(targetId);
    if (!target) return error(res, 'User not found', 404);

    const tenantId = trustedTenantId(req);
    if (!tenantId) return error(res, 'Tenant context required', 400);

    if (!isTargetInTenant(target, tenantId)) {
      return error(res, 'Target user is outside the current tenant', 403, { code: 'PERMISSION_DENIED' });
    }

    const effectiveRole = authorization.resolveEffectiveRole(target, tenantId);
    const baseline = registry.getRoleBaseline(effectiveRole);
    const effective = authorization.getEffectivePermissions(target, tenantId);
    const overrides = target.tenantPermissions && target.tenantPermissions[tenantId] ? target.tenantPermissions[tenantId] : {};

    const permissionGroups = registry.groups().map(g => ({
      group: g.group,
      permissions: g.permissions.map(p => ({
        name: p,
        baseline: baseline.includes(p),
        effective: effective.includes(p),
        overridden: overrides.hasOwnProperty(p) ? overrides[p] : undefined
      }))
    }));

    success(res, {
      tenantId,
      targetUser: { id: target.id, username: target.username, role: effectiveRole },
      permissionGroups,
      effective,
      overrides
    }, 'Permissions retrieved');
  } catch (err) {
    logger.error('users.getPermissions error:', err.message);
    error(res, 'Failed to retrieve permissions', 500);
  }
}

function updatePermissions(req, res) {
  try {
    if (!req.user) return error(res, 'Authentication required', 401);
    const targetId = String(req.params.id || '');
    if (!targetId) return error(res, 'Missing user id', 400);
    if (String(targetId) === String(req.user.id)) {
      return error(res, 'Self-permission modification is not allowed', 403, { code: 'PERMISSION_DENIED' });
    }

    const { overrides } = req.body || {};
    if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides)) {
      return error(res, 'overrides must be an object mapping permission to boolean', 400);
    }

    const target = usersService.getById(targetId);
    if (!target) return error(res, 'User not found', 404);

    const tenantId = trustedTenantId(req);
    if (!tenantId) return error(res, 'Tenant context required', 400);

    if (!isTargetInTenant(target, tenantId)) {
      return error(res, 'Target user is outside the current tenant', 403, { code: 'PERMISSION_DENIED' });
    }

    if (!authorization.canManageUser(req.user, target, tenantId)) {
      return error(res, 'Insufficient permission to manage this user', 403, { code: 'PERMISSION_DENIED' });
    }

    const actorEffectiveRole = authorization.resolveEffectiveRole(req.user, tenantId);
    const targetEffectiveRole = authorization.resolveEffectiveRole(target, tenantId);

    if (authorization.isPrivilegedRole(targetEffectiveRole)) {
      // Only an Owner may manage Owners; Admin/Manager never touch Owner.
      if (targetEffectiveRole === 'Owner' && actorEffectiveRole !== 'Owner') {
        return error(res, 'Only an Owner may modify permissions of an Owner', 403, { code: 'PERMISSION_DENIED' });
      }
      // Last-Owner protection: the sole Owner's permission set is immutable.
      if (targetEffectiveRole === 'Owner') {
        const allUsers = usersService.list().users;
        const tenantUsers = allUsers.filter(u => isTargetInTenant(u, tenantId));
        const owners = tenantUsers.filter(u => authorization.resolveEffectiveRole(u, tenantId) === 'Owner');
        if (owners.length <= 1) {
          return error(res, 'Cannot modify the permission set of the last Owner in the tenant', 409, { code: 'LAST_OWNER_PROTECTION' });
        }
      }
    }

    const { clean, errors } = authorization.validatePermissionMap(overrides);
    if (errors.length) {
      return error(res, errors.join('; '), 400);
    }

    for (const perm of Object.keys(clean)) {
      if (!authorization.canGrantPermission(req.user, perm, tenantId)) {
        return error(res, 'Insufficient permission to grant: ' + perm, 403, { code: 'PERMISSION_DENIED' });
      }
    }

    const mergedOverrides = { ...(target.tenantPermissions && target.tenantPermissions[tenantId] ? target.tenantPermissions[tenantId] : {}), ...clean };
    const updated = usersService.update(targetId, { tenantPermissions: { ...target.tenantPermissions, [tenantId]: mergedOverrides } });
    if (updated.error) return error(res, updated.error, 400);

    try {
      auditService.record({
        method: 'PUT',
        path: '/api/v1/users/' + targetId + '/permissions',
        statusCode: 200,
        userId: req.user.id,
        action: 'USER_PERMISSIONS_CHANGED',
        resource: 'user',
        resourceId: targetId,
        changes: { before: { overrides: target.tenantPermissions && target.tenantPermissions[tenantId] ? target.tenantPermissions[tenantId] : {} }, after: { overrides: clean } }
      });
    } catch (err) {
      logger.error('users.updatePermissions audit error:', err.message);
    }

    success(res, usersService.sanitizeUser(updated.user), 'Permissions updated');
  } catch (err) {
    logger.error('users.updatePermissions error:', err.message);
    error(res, 'Failed to update permissions', 500);
  }
}

function disableUser(req, res) {
  try {
    if (!req.user) return error(res, 'Authentication required', 401);
    const targetId = String(req.params.id || '');
    if (!targetId) return error(res, 'Missing user id', 400);
    if (String(targetId) === String(req.user.id)) {
      return error(res, 'Self-disable is not allowed', 403, { code: 'PERMISSION_DENIED' });
    }

    const target = usersService.getById(targetId);
    if (!target) return error(res, 'User not found', 404);

    const tenantId = trustedTenantId(req);
    if (!tenantId) return error(res, 'Tenant context required', 400);

    if (!isTargetInTenant(target, tenantId)) {
      return error(res, 'Target user is outside the current tenant', 403, { code: 'PERMISSION_DENIED' });
    }

    if (!authorization.canManageUser(req.user, target, tenantId)) {
      return error(res, 'Insufficient permission to disable this user', 403, { code: 'PERMISSION_DENIED' });
    }

    const actorEffectiveRole = authorization.resolveEffectiveRole(req.user, tenantId);
    const targetRole = authorization.resolveEffectiveRole(target, tenantId);
    if (targetRole === 'Owner') {
      // Only an Owner may disable an Owner (vertical escalation guard).
      if (actorEffectiveRole !== 'Owner') {
        return error(res, 'Only an Owner may disable an Owner', 403, { code: 'PERMISSION_DENIED' });
      }
      const allUsers = usersService.list().users;
      const tenantUsers = allUsers.filter(u => isTargetInTenant(u, tenantId));
      const owners = tenantUsers.filter(u => authorization.resolveEffectiveRole(u, tenantId) === 'Owner');
      if (owners.length <= 1) {
        return error(res, 'Cannot disable the last Owner in the tenant', 409, { code: 'LAST_OWNER_PROTECTION' });
      }
    }

    if (target.status === 'disabled') {
      return success(res, usersService.sanitizeUser(target), 'User already disabled');
    }

    const updated = usersService.update(targetId, { status: 'disabled' });
    if (updated.error) return error(res, updated.error, 400);

    const bump = usersService.bumpTokenVersion(targetId);
    if (bump.error) return error(res, bump.error, 400);

    try {
      auditService.record({
        method: 'POST',
        path: '/api/v1/users/' + targetId + '/disable',
        statusCode: 200,
        userId: req.user.id,
        action: 'USER_DISABLED',
        resource: 'user',
        resourceId: targetId,
        changes: { before: { status: target.status }, after: { status: 'disabled', tokenVersion: bump.tokenVersion } }
      });
    } catch (err) {
      logger.error('users.disableUser audit error:', err.message);
    }

    success(res, usersService.sanitizeUser(updated.user), 'User disabled');
  } catch (err) {
    logger.error('users.disableUser error:', err.message);
    error(res, 'Failed to disable user', 500);
  }
}

function enableUser(req, res) {
  try {
    if (!req.user) return error(res, 'Authentication required', 401);
    const targetId = String(req.params.id || '');
    if (!targetId) return error(res, 'Missing user id', 400);

    const target = usersService.getById(targetId);
    if (!target) return error(res, 'User not found', 404);

    const tenantId = trustedTenantId(req);
    if (!tenantId) return error(res, 'Tenant context required', 400);

    if (!isTargetInTenant(target, tenantId)) {
      return error(res, 'Target user is outside the current tenant', 403, { code: 'PERMISSION_DENIED' });
    }

    if (!authorization.canManageUser(req.user, target, tenantId)) {
      return error(res, 'Insufficient permission to enable this user', 403, { code: 'PERMISSION_DENIED' });
    }

    const actorEffectiveRole = authorization.resolveEffectiveRole(req.user, tenantId);
    const targetRole = authorization.resolveEffectiveRole(target, tenantId);
    if (targetRole === 'Owner' && actorEffectiveRole !== 'Owner') {
      return error(res, 'Only an Owner may enable an Owner', 403, { code: 'PERMISSION_DENIED' });
    }

    if (target.status !== 'disabled') {
      return success(res, usersService.sanitizeUser(target), 'User already active');
    }

    const updated = usersService.update(targetId, { status: 'active' });
    if (updated.error) return error(res, updated.error, 400);

    try {
      auditService.record({
        method: 'POST',
        path: '/api/v1/users/' + targetId + '/enable',
        statusCode: 200,
        userId: req.user.id,
        action: 'USER_ENABLED',
        resource: 'user',
        resourceId: targetId,
        changes: { before: { status: 'disabled' }, after: { status: 'active' } }
      });
    } catch (err) {
      logger.error('users.enableUser audit error:', err.message);
    }

    success(res, usersService.sanitizeUser(updated.user), 'User enabled');
  } catch (err) {
    logger.error('users.enableUser error:', err.message);
    error(res, 'Failed to enable user', 500);
  }
}

module.exports = { list, getById, getStats, create, update, remove, resetPassword, getPermissions, updatePermissions, disableUser, enableUser };
