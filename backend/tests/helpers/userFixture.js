// Shared test fixture: provision users via the real users service
// (no unauthenticated HTTP to the now-protected POST /api/v1/users).
//
// Supports both legacy callers passing { extra: {...} } and direct callers
// passing top-level tenantIds/tenantRoles/permissions/id. Values inside extra
// are flattened onto the actual payload and applied last, matching the legacy
// override semantics where extra wins over direct fields and defaults.
// Loading the service lazily ensures the per-instance config
// (DIGITRONICS_DATA_DIR, feature flags) set by startServer() is active.
function createUser(app, user) {
  const usersService = require('../../services/users.service');

  const { extra = {}, ...directFields } = user;

  const payload = {
    ...directFields,
    fullName: user.fullName || user.username,
    role: user.role || 'Cashier',
    ...(extra && typeof extra === 'object' ? extra : {})
  };

  const result = usersService.create(payload);
  if (result.error) throw new Error(`createUser(${user.username}) failed: ${result.error}`);
  return usersService.sanitizeUser(result.user);
}

module.exports = { createUser };
