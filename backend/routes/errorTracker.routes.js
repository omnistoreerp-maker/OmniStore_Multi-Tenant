const router = require('express').Router();
const ctrl = require('../controllers/errorTracker.controller');
const { requireAuth } = require('../middleware/auth');

/**
 * @openapi
 * /api/v1/errors:
 *   get:
 *     tags: [Error Tracker]
 *     summary: List error issues
 *     description: Returns deduplicated error issues with filters by status and level
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - name: status
 *         in: query
 *         schema:
 *           type: string
 *           enum: [open, acknowledged, resolved]
 *       - name: level
 *         in: query
 *         schema:
 *           type: string
 *           enum: [error, warning, critical]
 *       - name: limit
 *         in: query
 *         schema:
 *           type: integer
 *           default: 50
 *     responses:
 *       200:
 *         description: Error issues retrieved
 *       401:
 *         description: Authentication required
 */
router.get('/', requireAuth, ctrl.list);

/**
 * @openapi
 * /api/v1/errors/stats:
 *   get:
 *     tags: [Error Tracker]
 *     summary: Error statistics
 *     description: Counts of issues by status
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Statistics retrieved
 *       401:
 *         description: Authentication required
 */
router.get('/stats', requireAuth, ctrl.getStats);

/**
 * @openapi
 * /api/v1/errors/{id}:
 *   get:
 *     tags: [Error Tracker]
 *     summary: Get error issue
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Error issue retrieved
 *       404:
 *         description: Error not found
 *   put:
 *     tags: [Error Tracker]
 *     summary: Update error status
 *     description: Acknowledge or resolve an error issue
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [status]
 *             properties:
 *               status:
 *                 type: string
 *                 enum: [open, acknowledged, resolved]
 *     responses:
 *       200:
 *         description: Error status updated
 *       400:
 *         description: Invalid status
 *       404:
 *         description: Error not found
 */
router.get('/:id', requireAuth, ctrl.getById);
router.put('/:id', requireAuth, ctrl.setStatus);

module.exports = router;