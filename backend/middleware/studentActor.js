'use strict';

// studentActor — resolves the student record (if any) linked to the
// signed-in account, for every request under the Education namespace.
//
// It is the exact twin of middleware/teacherActor and middleware/centerActor:
// same contract, same mount point, same fail-closed direction.
//
// WHY IT EXISTS. The repository links an authenticated user to a Student only
// when an operator has explicitly created that link (POST /students/:id/link-
// user, Owner/Admin only, one account <-> one student per tenant). This
// middleware performs that resolution ONCE per request and parks it on
// `req.educationStudent`, so the SELF-scope rules downstream never re-query
// the store and can never disagree with each other.
//
// CONTRACT.
//   - `req.educationStudent` is either a student record object or `null`.
//   - It is `null` whenever there is no signed-in user, no trusted tenant, or
//     no link — never a guess, never derived from a claim, never defaulted.
//   - It NEVER rejects: routes decide what an actor means for them (a linked
//     student gets SELF-scoped reads; everyone else follows the permission
//     gate alone, exactly as before).
//   - A resolution failure is swallowed to `null`: the safe direction is to
//     treat the caller as a plain caller, which then still has to pass every
//     permission gate.
//   - The link GRANTS NO PERMISSION. Identity, role and actor ownership stay
//     three separate things: this file resolves identity-link ownership only;
//     the route's requirePermission / requirePermissionOrSelf gate still
//     decides access; the write role gate is untouched by this actor.
//
// The tenant comes only from the canonical trustedTenantId(req) helper —
// never from query, body or header. A `studentId` supplied by the client is
// NEVER used to establish this actor.

const studentService = require('../services/student.service');
const { trustedTenantId } = require('./authorize');

function attachStudentActor(req, res, next) {
  req.educationStudent = null;
  try {
    if (req.user && req.user.id) {
      const tenantId = trustedTenantId(req);
      if (tenantId) {
        req.educationStudent = studentService.getStudentByUserId({ tenantId: String(tenantId) }, req.user.id);
      }
    }
  } catch (_) {
    req.educationStudent = null;
  }
  next();
}

module.exports = { attachStudentActor };