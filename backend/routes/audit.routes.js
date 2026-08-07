const router = require('express').Router();
const ctrl = require('../controllers/audit.controller');
const { requireAuth } = require('../middleware/auth');

/**
 * @openapi
 * /api/v1/audit-log:
 *   get:
 *     tags: [Audit Log]
 *     summary: Query audit log
 *     description: |
 *       Query the audit trail with filtering and pagination.
 *       Returns entries for mutating operations (POST, PUT, DELETE) only.
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - name: userId
 *         in: query
 *         schema:
 *           type: string
 *         description: Filter by user ID
 *       - name: apiKeyId
 *         in: query
 *         schema:
 *           type: string
 *         description: Filter by API key ID
 *       - name: resource
 *         in: query
 *         schema:
 *           type: string
 *         description: Filter by resource name (e.g., sales, users)
 *       - name: method
 *         in: query
 *         schema:
 *           type: string
 *           enum: [POST, PUT, PATCH, DELETE]
 *         description: Filter by HTTP method
 *       - name: startDate
 *         in: query
 *         schema:
 *           type: string
 *           format: date-time
 *         description: Filter entries after this date
 *       - name: endDate
 *         in: query
 *         schema:
 *           type: string
 *           format: date-time
 *         description: Filter entries before this date
 *       - name: page
 *         in: query
 *         schema:
 *           type: integer
 *           default: 1
 *         description: Page number
 *       - name: limit
 *         in: query
 *         schema:
 *           type: integer
 *           default: 50
 *           maximum: 100
 *         description: Items per page
 *     responses:
 *       200:
 *         description: Audit log entries retrieved
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *       401:
 *         description: Authentication required
 */
router.get('/', requireAuth, ctrl.query);

/**
 * @openapi
 * /api/v1/audit-log/stats:
 *   get:
 *     tags: [Audit Log]
 *     summary: Get audit statistics
 *     description: Returns audit log statistics including counts by method, resource, and time windows
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
 * /api/v1/audit-log/{id}:
 *   get:
 *     tags: [Audit Log]
 *     summary: Get audit entry by ID
 *     description: Returns a specific audit log entry
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
 *         description: Audit entry retrieved
 *       404:
 *         description: Audit entry not found
 *       401:
 *         description: Authentication required
 */
router.get('/:id', requireAuth, ctrl.getById);

module.exports = router;
