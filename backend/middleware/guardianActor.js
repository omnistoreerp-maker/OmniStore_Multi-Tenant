'use strict';

// guardianActor — resolves the guardian record (if any) linked to the
// signed-in account, for every request under the Education namespace.
//
// WHY IT EXISTS. Phase 0 introduced a Parent identity. Binding an
// authenticated account to a Guardian is an explicit operator action
// (POST /guardians/:id/link-user, Owner/Admin only). This middleware performs
// that resolution ONCE per request and parks it on `req.guardianActor`, so
// ownership rules downstream never re-query the store and can never disagree
// with each other.
//
// CONTRACT — deliberately identical to teacherActor.js:
//   - `req.guardianActor` is either a guardian record object or `null`.
//   - It is `null` whenever there is no signed-in user, no trusted tenant, or
//     no link — never a guess, never derived from a claim, never defaulted.
//   - It NEVER rejects: routes decide what an actor means for them.
//   - A resolution failure is swallowed to `null`: the safe direction is to
//     treat the caller as a plain operator, which then still has to pass
//     every permission gate.
//
// The tenant comes only from the canonical trustedTenantId(req) helper — never
// from query, body or header. No role is ever read from the client.
//
// MOUNT ORDER. Like attachTeacherActor, this is mounted OUTSIDE the
// AUTH_REQUIRED block on purpose: the controllers must be able to scope a
// linked parent's reads even in legacy open mode, and for anonymous traffic
// the resolution is a no-op.
//
// PHASE 0 SCOPE. This actor grants READ access to a parent's own children
// only. It deliberately does NOT add any entry to the Education write-guard
// exception set, so a linked parent account still passes the global
// scopedWriteRoleGuard('Owner','Admin','Manager') on every Education write.
// Parents are read-only in Phase 0 by design, not by omission.

const guardianService = require('../services/guardian.service');
const { trustedTenantId } = require('./authorize');

function attachGuardianActor(req, res, next) {
  req.guardianActor = null;
  try {
    if (req.user && req.user.id) {
      const tenantId = trustedTenantId(req);
      if (tenantId) {
        req.guardianActor = guardianService.getGuardianByUserId({ tenantId: String(tenantId) }, req.user.id);
      }
    }
  } catch (_) {
    req.guardianActor = null;
  }
  next();
}

module.exports = { attachGuardianActor };