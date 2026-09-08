'use strict';

const router = require('express').Router();
const ctrl = require('../controllers/update.controller');
const { requireRole } = require('../middleware/authorize');

/**
 * @openapi
 * /api/v1/update/manifest:
 *   get:
 *     tags: [Update]
 *     summary: Check for available application updates
 *     description: Returns the current version and, when a newer release has
 *       been published, the update metadata (version, release date, HTTPS
 *       download URL, SHA-256 digest, mandatory flag, release notes).
 *     responses:
 *       200:
 *         description: Update availability
 */
router.get('/manifest', ctrl.getManifest);

/**
 * @openapi
 * /api/v1/update/apply:
 *   post:
 *     tags: [Update]
 *     summary: Start the safe in-app update flow
 *     description: Requires an authenticated Owner/Admin/Manager. Launches the
 *       separate updater process which downloads, verifies SHA-256, backs up,
 *       swaps, restarts and health-checks the new version (auto-rollback on
 *       failure). The updater runs detached and survives the app exit.
 *     responses:
 *       202:
 *         description: Update started
 *       401:
 *         description: Authentication required
 *       403:
 *         description: Insufficient permissions
 */
router.post('/apply', requireRole('Owner', 'Admin', 'Manager'), ctrl.apply);

module.exports = router;
