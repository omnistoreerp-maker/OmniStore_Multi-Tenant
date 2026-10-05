'use strict';

// centerActor — resolves the center record (if any) linked to the signed-in
// account, for every request under the Education namespace.
//
// WHY IT EXISTS. The repository links an authenticated user to a Center only
// when an operator has explicitly created that link (POST /centers/:id/link-
// user, Owner/Admin only). This middleware performs that resolution ONCE per
// request and parks it on `req.centerActor`, so center-isolation rules
// downstream never re-query the store and can never disagree with each other.
// It is the exact twin of middleware/teacherActor: same contract, same mount
// point, same fail-closed direction.
//
// CONTRACT.
//   - `req.centerActor` is either a center record object or `null`.
//   - It is `null` whenever there is no signed-in user, no trusted tenant, or
//     no link — never a guess, never derived from a claim, never defaulted.
//   - It NEVER rejects: routes decide what an actor means for them (a linked
//     center sees only its own rows through middleware/centerOwnership; everyone
//     else follows the permission gate alone, exactly as before).
//   - A resolution failure is swallowed to `null`: the safe direction is to
//     treat the caller as a plain operator, which then still has to pass
//     every permission gate.
//
// The tenant comes only from the canonical trustedTenantId(req) helper —
// never from query, body or header. There is deliberately NO center bypass in
// scopedWriteRoleGuard: unlike a linked teacher, a linked center gains no
// write privilege — center scoping only ever NARROWS what the permission gate
// already allowed (least privilege).

const centerService = require('../services/center.service');
const { trustedTenantId } = require('./authorize');

function attachCenterActor(req, res, next) {
  req.centerActor = null;
  try {
    if (req.user && req.user.id) {
      const tenantId = trustedTenantId(req);
      if (tenantId) {
        req.centerActor = centerService.getCenterByUserId({ tenantId: String(tenantId) }, req.user.id);
      }
    }
  } catch (_) {
    req.centerActor = null;
  }
  next();
}

module.exports = { attachCenterActor };
