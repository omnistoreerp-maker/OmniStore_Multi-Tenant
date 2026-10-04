'use strict';

// teacherActor — resolves the teacher record (if any) linked to the
// signed-in account, for every request under the Education namespace.
//
// WHY IT EXISTS. The repository links an authenticated user to a Teacher only
// when an operator has explicitly created that link (POST /teachers/:id/link-
// user). This middleware performs that resolution ONCE per request and parks
// it on `req.teacherActor`, so ownership rules downstream never re-query the
// store and can never disagree with each other.
//
// CONTRACT.
//   - `req.teacherActor` is either a teacher record object or `null`.
//   - It is `null` whenever there is no signed-in user, no trusted tenant, or
//     no link — never a guess, never derived from a claim, never defaulted.
//   - It NEVER rejects: routes decide what an actor means for them (a linked
//     teacher gets own-row scoping; everyone else follows the permission
//     gate alone).
//   - A resolution failure is swallowed to `null`: the safe direction is to
//     treat the caller as a plain operator, which then still has to pass
//     every permission gate.
//
// The tenant comes only from the canonical trustedTenantId(req) helper —
// never from query, body or header.

const teacherService = require('../services/teacher.service');
const { trustedTenantId } = require('./authorize');

function attachTeacherActor(req, res, next) {
  req.teacherActor = null;
  try {
    if (req.user && req.user.id) {
      const tenantId = trustedTenantId(req);
      if (tenantId) {
        req.teacherActor = teacherService.getTeacherByUserId({ tenantId: String(tenantId) }, req.user.id);
      }
    }
  } catch (_) {
    req.teacherActor = null;
  }
  next();
}

module.exports = { attachTeacherActor };
