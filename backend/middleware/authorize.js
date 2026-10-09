const { error: errorResponse } = require('../utils/apiResponse');
const config = require('../config');
const usersService = require('../services/users.service');
const tenantRole = require('../services/tenantRole.service');
const authorization = require('../services/authorization.service');

// Phase 20 — Tenant-scoped authorization resolution.
//
// When ENABLE_TENANT_ROLES is enabled AND a valid tenant context is present on
// the request, the *effective role* the user acts as in that tenant is resolved
// from the REAL user record (per-tenant role, or global `role` fallback — never
// invented) and exposed as `req.user.effectiveRole`. The gates below then gate
// on the effective role instead of the raw global role.
//
// Deliberately narrow — the pre-Phase-20 behavior is untouched whenever any of
// these holds:
//   - Feature OFF            -> total no-op (GoLive-1: gate on req.user.role).
//   - No valid tenant context (legacy token, no tenant, unknown/inactive tenancy)
//                              -> gate on req.user.role.
//   - Token tenant claim and reconstructed context disagree -> gate on
//                              req.user.role (never escalates).
//   - Username absent / user record missing -> gate on req.user.role.
//
// The tenant is consumed exclusively from server-side state: the signed token
// claim (req.user.tenantId, set by auth middleware) and the reconstructed
// req.tenantContext (tenantCarry). It is NEVER taken from query/body/header.
function resolveTenantRoleForRequest(req) {
  if (!config.tenantRolesEnabled) return undefined;
  if (req.__tenantAuthResolved) return req.user ? req.user.effectiveRole : undefined;
  req.__tenantAuthResolved = true;
  const user = req.user;
  if (!user) return undefined;
  const contextTenantId = req.tenantContext ? String(req.tenantContext.tenantId) : undefined;
  if (!contextTenantId) return undefined;
  if (user.tenantId !== undefined && user.tenantId !== null && String(user.tenantId) !== contextTenantId) {
    return undefined;
  }
  if (!user.username) return undefined;
  const record = usersService.getByUsername(user.username);
  if (!record) return undefined;
  const effective = tenantRole.resolveEffectiveRole(record, contextTenantId);
  if (effective !== undefined && effective !== null) user.effectiveRole = effective;
  return effective;
}

// Role gate: 401 when unauthenticated, 403 when the role is not allowed.
function requireRole(...roles) {
  return function (req, res, next) {
    if (!req.user) return errorResponse(res, 'Authentication required', 401);
    const effective = resolveTenantRoleForRequest(req);
    const role = effective !== undefined ? effective : req.user.role;
    if (!roles.includes(role)) {
      return errorResponse(res, 'Insufficient role', 403);
    }
    next();
  };
}

// Identity without a resolvable user-record username: gate on the permissions
// carried on the request (legacy behavior; used by header-driven test stubs).
function resolveActor(req) {
  if (req.__resolvedActor !== undefined) return req.__resolvedActor;
  req.__resolvedActor = null;
  if (!req.user || !req.user.username) return req.__resolvedActor;
  const record = usersService.getByUsername(req.user.username);
  if (record) req.__resolvedActor = record;
  return req.__resolvedActor;
}

// The trusted tenant for the request: the reconstructed tenant context when
// present, else the tenant claim signed into the token. Never from query/body.
function trustedTenantId(req) {
  if (req.tenantContext && req.tenantContext.tenantId != null) return String(req.tenantContext.tenantId);
  if (req.user && req.user.tenantId != null) return String(req.user.tenantId);
  return undefined;
}

// Permission gate: Owner/Admin (by effective role) bypass. For a resolvable
// real user, access is decided by the authorization engine against the REAL
// user record, scoped to the trusted tenant. Synthetic identities (no
// username) keep the legacy permissions-array check.
function requirePermission(permission) {
  return function (req, res, next) {
    if (!req.user) return errorResponse(res, 'Authentication required', 401);
    const effective = resolveTenantRoleForRequest(req);
    const role = effective !== undefined ? effective : req.user.role;
    if (role === 'Owner' || role === 'Admin') return next();

    const actor = resolveActor(req);
    if (!actor) {
      const perms = Array.isArray(req.user.permissions) ? req.user.permissions : [];
      if (perms.includes('all') || perms.includes(permission)) return next();
      return errorResponse(res, 'Insufficient permission', 403, { code: 'PERMISSION_DENIED' });
    }

    const tenantId = effective !== undefined ? trustedTenantId(req) : undefined;
    if (authorization.hasPermission(actor, permission, tenantId)) return next();
    return errorResponse(res, 'Insufficient permission', 403, { code: 'PERMISSION_DENIED' });
  };
}

// Write gate: non-GET requests restricted to the given roles.
function writeRoleGuard(...roles) {
  return function (req, res, next) {
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
    return requireRole(...roles)(req, res, next);
  };
}

// Route prefixes that enforce their OWN per-route permissions via
// requirePermissionIfAuth (the permission-registry model). The legacy global
// role gate is intentionally SKIPPED for them so roles like BranchManager —
// granted limited write permissions by the registry — can operate the business
// workflow they are authorized for, while routes WITHOUT per-route guards keep
// the broad Owner/Admin/Manager write restriction.
const PERMISSION_GUARDED_WRITE_ROUTES = new Set([
  '/sales',
  '/purchases',
  '/inventory',
  '/inventory-transactions',
  '/customers',
  '/suppliers',
  '/partners',
  '/vouchers',
  '/employees',
  '/treasury',
  '/dashboard',
  '/reports',
  '/users',
  '/audit-log',
  '/permissions'
]);

// Global write gate used by server.js under AUTH_REQUIRED. Applies the role
// restriction ONLY to routes that do not have their own per-route permission
// enforcement; the rest are governed by their per-route requirePermissionIfAuth.
//
// ONE identity-based exception: `req.teacherActor` — the Teacher record that
// server-side attachTeacherActor (mounted for /api/v1/tenant/education BEFORE
// this gate) resolves for a signed-in account that an Owner/Admin has
// explicitly linked to a teacher row. Without that exception a linked teacher
// with a normal (Viewer-level) account could never confirm or cancel their own
// booking: this gate would answer 'Insufficient role' before the route
// permission was ever consulted. With it:
//   - the bypass exists ONLY on the eight TEACHER-OWNED education surfaces
//     (bookings, ratings, classes, scheduling, enrollments, attendance,
//     grading, assignments) and ONLY for a caller whose link was created by an
//     Owner/Admin — an unlinked account, an anonymous request, any other
//     education surface (students, programs, courses, centers,
//     educationPack, teachers) and any other /api/v1 path keeps the full role
//     restriction (all four 'fail closed' education suites pin that);
//   - `students` is deliberately NOT on the list: enrolling and creating
//     students is an operator action, not a teacher's. A teacher reaches their
//     own students through the READ paths, which are force-scoped.
//   - on those seven surfaces the controllers enforce ownership: a linked
//     teacher may write ONLY rows owned by their own teacher record (and the
//     ratings controller refuses teacher writes outright — entering feedback
//     is an operator action). `attendance` and `grading` store no `teacherId`,
//     so their controllers resolve ownership through
//     Enrollment -> Class -> teacherId via middleware/teacherOwnership;
//   - the route's strict requirePermission still decides access (fails closed
//     with no grant, unknown permissions refused).
const TEACHER_OWNED_EDUCATION_SURFACES = new Set([
  'bookings', 'ratings', 'classes', 'scheduling', 'enrollments', 'attendance', 'grading', 'assignments'
]);
function scopedWriteRoleGuard(...roles) {
  return function (req, res, next) {
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
    const segments = req.path ? req.path.split('/') : [];
    const seg = segments[1];
    if (seg && PERMISSION_GUARDED_WRITE_ROUTES.has('/' + seg)) return next();
    if (
      req.teacherActor &&
      seg === 'tenant' && segments[2] === 'education' &&
      TEACHER_OWNED_EDUCATION_SURFACES.has(segments[3])
    ) return next();
    return requireRole(...roles)(req, res, next);
  };
}

// Conditional permission gate: only enforces when AUTH_REQUIRED=true.
// When AUTH_REQUIRED=false, all requests pass through (legacy open behavior).
function requirePermissionIfAuth(permission) {
  return function (req, res, next) {
    if (!config.authRequired) return next();
    return requirePermission(permission)(req, res, next);
  };
}

// SELF-SCOPE permission gate — the smallest change that lets the permission
// model express SELF for the learner portal WITHOUT inventing a second
// authorization system and WITHOUT opening any education.* grant tenant-wide.
//
// THE PROBLEM IT SOLVES. The registry models flat, tenant-wide grants
// (`education.students.view` etc.). A linked Student must read THEIR OWN
// profile/enrollments/attendance/grades/schedule without holding an operator
// grant — but granting them `education.students.view` would hand them the
// whole tenant's student list, which is exactly what must never happen.
//
// THE DECISION. Authorization for SELF-scoped reads is the LINK itself — the
// same precedent `/students/me` already established ("Authorization is the
// LINK, not a permission grant"): an Owner/Admin created the
// user<->student link inside one tenant (POST /students/:id/link-user), and
// middleware/studentActor resolves it server-side from the signed token +
// trusted tenant. This gate therefore:
//   - passes ONLY when `req.educationStudent` was resolved server-side
//     (never from query, body or header — studentActor reads none of them);
//   - passes the request through to the controller, which force-NARROWS every
//     result to that student's own rows (studentOwnership helpers). The gate
//     opens SELF scope, never tenant scope: a linked student who ALSO holds
//     the operator grant is still narrowed to their own rows by the controller;
//   - falls through to the strict requirePermission for everyone else —
//     anonymous (401), unlinked accounts (403 without the grant) and operators
//     (permission decided by the authorization engine), exactly as before;
//   - is attached to READ routes only. Every write route keeps the strict
//     requirePermission plus the global scopedWriteRoleGuard, so a Student
//     remains read-only regardless of this gate.
function requirePermissionOrSelf(permission) {
  return function (req, res, next) {
    if (req.educationStudent) return next();
    return requirePermission(permission)(req, res, next);
  };
}

module.exports = { requireRole, requirePermission, requirePermissionIfAuth, requirePermissionOrSelf, writeRoleGuard, scopedWriteRoleGuard, resolveTenantRoleForRequest, trustedTenantId };
