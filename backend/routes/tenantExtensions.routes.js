'use strict';

const router = require('express').Router();
const ctrl = require('../controllers/tenantExtensions.controller');
const { requireAuth } = require('../middleware/auth');
const { requireRole } = require('../middleware/authorize');

// AUTHORIZATION — tenant add-ons and custom domains are TENANT CONFIGURATION
// (billing surface + the domain the storefront answers on), not a workflow any
// signed-in account may drive. This router is mounted at /api/v1/tenant,
// OUTSIDE the AUTH_REQUIRED block, so it carried `requireAuth` and nothing
// else: any authenticated Viewer — including a linked Teacher or a linked
// Student — could upsert add-ons and register domains for their tenant.
//
// It now uses the existing authorization contract: `requireRole('Owner','Admin')`
// with the server-resolved per-tenant effective role, exactly as
// /students/:id/link-user and /teachers/:id/link-user already do. Manager keeps
// what it had (it never had a grant here), and nothing is granted to Teachers:
// the Teacher workflow is served entirely by /api/v1/tenant/education, which is
// where a teacher's legitimate tenant context lives.
const auth = [requireAuth, requireRole('Owner', 'Admin')];

// ---------------- add-ons ----------------

router.get('/addons', auth, ctrl.listMyAddons);
router.post('/addons', auth, ctrl.upsertMyAddon);
router.delete('/addons/:addonKey', auth, ctrl.deleteMyAddon);

// ---------------- custom domains ----------------

router.get('/custom-domains', auth, ctrl.listMyCustomDomains);
router.post('/custom-domains', auth, ctrl.registerMyCustomDomain);

module.exports = router;
