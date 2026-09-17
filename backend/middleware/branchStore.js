'use strict';

// Request-scoped branch store, backed by AsyncLocalStorage (same pattern as
// middleware/tenantStore.js). Carries the TRUSTED branchId for the current
// request — resolved exclusively from the server-side user record, never from
// the client (body/query/headers are attacker-controlled).
//
// OPT-IN via ENABLE_BRANCH_ISOLATION. When disabled the store always reads
// null and every guard below is a no-op, so legacy behaviour is unchanged and
// the baseline suites are unaffected.
//
// Middleware chain dependency: the branch cannot be resolved until
// authMiddleware has populated req.user, so
//   app.use(branchStore.middleware);
// must run AFTER app.use(authMiddleware) in server.js. It opens the ALS
// context for the whole request (inside the tenantStore context), so every
// async continuation — controller -> service -> repository — sees the branch.

const { AsyncLocalStorage } = require('node:async_hooks');
const config = require('../config');
const usersService = require('../services/users.service');
const { error: errorResponse } = require('../utils/apiResponse');

const als = new AsyncLocalStorage();

// Error code returned on branch-scope violations (details field).
const BRANCH_SCOPE_DENIED = 'BRANCH_SCOPE_DENIED';

// Claim sources a client can use to assert a branch on a request.
const QUERY_BRANCH_KEYS = ['branch', 'branchId'];
const BODY_BRANCH_KEYS = ['branchId', 'branch'];

// Entities whose records carry a branch concept (branchId/branch fields) and
// whose list endpoints honour a branch filter (sales.service / purchase.service).
const BRANCHED_PATHS = /^\/api\/v1\/(sales|purchases)(\/|$)/;

const branchStore = {
  middleware(req, res, next) {
    als.run({ branchId: null }, () => {
      if (config.branchIsolationEnabled && req.user && req.user.id) {
        // Trusted branch comes from the STORED user record — never from the
        // JWT itself (which may lack a branch claim or be stale).
        const stored = usersService.getById(req.user.id);
        if (stored && stored.branchId != null && stored.branchId !== '') {
          const branchId = String(stored.branchId);
          branchStore.set(branchId);
          if (req.user) req.user.branchId = branchId;
        }
      }
      next();
    });
  },

  set(branchId) {
    const store = als.getStore();
    if (!store) return; // outside a request context — never leak globally
    store.branchId = branchId || null;
  },

  get() {
    const store = als.getStore();
    return store ? store.branchId : null;
  },

  clear() {
    const store = als.getStore();
    if (store) store.branchId = null;
  },

  createAccessor() {
    return {
      getCurrentBranch() {
        return branchStore.get();
      }
    };
  },

  // Route-level enforcement guard. No-op unless branch isolation is enabled
  // AND the authenticated user has a trusted branch scope. When a scope is
  // active:
  //   - any client branch claim (query OR body) differing from the scope is
  //     rejected 403 BRANCH_SCOPE_DENIED (branch override defence);
  //   - GET list reads on branch-bearing entities are scoped server-side by
  //     injecting the trusted branch into the query;
  //   - POST creates on branch-bearing entities are server-stamped with the
  //     trusted branchId (the client can never choose the branch).
  // PUT/PATCH are never re-stamped (that would let a scoped user hijack a
  // record belonging to another branch); they only reject conflicting claims.
  branchScope(req, res, next) {
    const scope = branchStore.get();
    if (!scope) return next();

    const claim = branchStore._claimFrom(req);
    if (claim != null && String(claim) !== String(scope)) {
      return errorResponse(res, 'Branch scope denied: target branch does not match your branch', 403, BRANCH_SCOPE_DENIED);
    }

    if (BRANCHED_PATHS.test(req.path)) {
      if (req.method === 'GET') {
        if (!req.query) req.query = {};
        req.query.branch = scope;
      } else if (req.method === 'POST' && req.body && typeof req.body === 'object' && !Array.isArray(req.body)) {
        req.body.branchId = scope;
      }
    }
    next();
  },

  // Reads the client-supplied branch claim (query first, then body), or null.
  _claimFrom(req) {
    if (req.query) {
      for (const key of QUERY_BRANCH_KEYS) {
        if (req.query[key] !== undefined) return req.query[key];
      }
    }
    if (req.body && typeof req.body === 'object' && !Array.isArray(req.body)) {
      for (const key of BODY_BRANCH_KEYS) {
        if (req.body[key] !== undefined) return req.body[key];
      }
    }
    return null;
  }
};

module.exports = branchStore;
module.exports.BRANCH_SCOPE_DENIED = BRANCH_SCOPE_DENIED;
