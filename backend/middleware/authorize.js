const { error: errorResponse } = require('../utils/apiResponse');

// Role gate: 401 when unauthenticated, 403 when the role is not allowed.
function requireRole(...roles) {
  return function (req, res, next) {
    if (!req.user) return errorResponse(res, 'Authentication required', 401);
    if (!roles.includes(req.user.role)) {
      return errorResponse(res, 'Insufficient role', 403);
    }
    next();
  };
}

// Permission gate: Owner/Admin bypass; otherwise the user must carry
// the permission (or 'all') in their permissions array.
function requirePermission(permission) {
  return function (req, res, next) {
    if (!req.user) return errorResponse(res, 'Authentication required', 401);
    if (req.user.role === 'Owner' || req.user.role === 'Admin') return next();
    const perms = Array.isArray(req.user.permissions) ? req.user.permissions : [];
    if (perms.includes('all') || perms.includes(permission)) return next();
    return errorResponse(res, 'Insufficient permission', 403);
  };
}

// Write gate: non-GET requests restricted to the given roles.
function writeRoleGuard(...roles) {
  return function (req, res, next) {
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
    return requireRole(...roles)(req, res, next);
  };
}

module.exports = { requireRole, requirePermission, writeRoleGuard };
