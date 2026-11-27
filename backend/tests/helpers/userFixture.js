// Shared test fixture: provision users via the real users service
// (no unauthenticated HTTP to the now-protected POST /api/v1/users).
//
// Supports both legacy callers passing { extra: {...} } and direct callers
// passing top-level tenantIds/tenantRoles/permissions/id. Values inside extra
// are flattened onto the actual payload (override semantics), matching the
// previous authHelper behavior. Loading the service lazily ensures the
// per-instance config (DIGITRONICS_DATA_DIR, feature flags) set by
// startServer() is active.
function createUser(app, user) {
  const usersService = require('../../services/users.service');

  // Flatten extra onto the payload while preserving direct fields.
  const payload = { ...(user.extra || {}) };
  if (user.id !== undefined) payload.id = user.id;
  if (user.username !== undefined) payload.username = user.username;
  if (user.password !== undefined) payload.password = user.password;
  if (user.fullName !== undefined) payload.fullName = user.fullName;
  if (user.role !== undefined) payload.role = user.role;
  if (user.email !== undefined) payload.email = user.email;
  if (user.phone !== undefined) payload.phone = user.phone;
  if (user.status !== undefined) payload.status = user.status;
  if (user.tenantIds !== undefined) payload.tenantIds = user.tenantIds;
  if (user.tenantRoles !== undefined) payload.tenantRoles = user.tenantRoles;
  if (user.permissions !== undefined) payload.permissions = user.permissions;

  const result = usersService.create(payload);
  if (result.error) throw new Error(`createUser(${user.username}) failed: ${result.error}`);
  return usersService.sanitizeUser(result.user);
}

module.exports = { createUser };
