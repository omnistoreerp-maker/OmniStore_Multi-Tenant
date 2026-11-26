// Shared test fixture: provision users via the real users service
// (no unauthenticated HTTP to the now-protected POST /api/v1/users).
//
// The users service enforces password policy, hashes passwords, normalizes
// tenantIds/tenantRoles when the corresponding feature flags are on, rejects
// duplicates, and returns the full user record. Loading the service lazily
// inside the function ensures the per-instance config (DIGITRONICS_DATA_DIR,
// feature flags) set by startServer() is active.
function createUser(app, user) {
  const usersService = require('../../services/users.service');
  const result = usersService.create(user);
  if (result.error) throw new Error(`createUser(${user.username}) failed: ${result.error}`);
  const { password, ...sanitized } = result.user;
  return sanitized;
}

module.exports = { createUser };
