const router = require('express').Router();
const ctrl = require('../controllers/dashboard.controller');
const { requirePermission } = require('../middleware/authorize');

/**
 * @openapi
 * /api/v1/dashboard:
 *   get:
 *     tags: [Dashboard]
 *     summary: Get dashboard data
 *     description: Returns dashboard overview data
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Dashboard data retrieved
 *       401:
 *         description: Authentication required
 *   post:
 *     tags: [Dashboard]
 *     summary: Create dashboard item
 *     description: Create a new dashboard item
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *     responses:
 *       201:
 *         description: Dashboard item created
 *       400:
 *         description: Validation error
 *       401:
 *         description: Authentication required
 */
router.get('/', requirePermission('dashboard.view'), ctrl.list);
router.post('/', requirePermission('dashboard.view'), ctrl.create);

/**
 * @openapi
 * /api/v1/dashboard/stats:
 *   get:
 *     tags: [Dashboard]
 *     summary: Get dashboard statistics
 *     description: Returns dashboard statistics
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Statistics retrieved
 *       401:
 *         description: Authentication required
 */
router.get('/stats', requirePermission('dashboard.view'), ctrl.getStats);

/**
 * @openapi
 * /api/v1/dashboard/tenant-home:
 *   get:
 *     tags: [Dashboard]
 *     summary: Get tenant home dashboard data
 *     description: Returns aggregated real data for tenant Owner/Admin home pages. All data is tenant-scoped through the authenticated session's tenant context.
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Tenant home dashboard data retrieved
 *       401:
 *         description: Authentication required
 *       403:
 *         description: Insufficient permission
 */
router.get('/tenant-home', requirePermission('dashboard.view'), ctrl.getTenantHome);

/**
 * @openapi
 * /api/v1/dashboard/{id}:
 *   get:
 *     tags: [Dashboard]
 *     summary: Get dashboard item by ID
 *     description: Returns a specific dashboard item
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
 *         description: Dashboard item retrieved
 *       404:
 *         description: Item not found
 *   put:
 *     tags: [Dashboard]
 *     summary: Update dashboard item
 *     description: Update a dashboard item
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
 *     responses:
 *       200:
 *         description: Dashboard item updated
 *       404:
 *         description: Item not found
 *   delete:
 *     tags: [Dashboard]
 *     summary: Delete dashboard item
 *     description: Delete a dashboard item
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
 *         description: Dashboard item deleted
 *       404:
 *         description: Item not found
 */
router.get('/:id', requirePermission('dashboard.view'), ctrl.getById);
router.put('/:id', requirePermission('dashboard.view'), ctrl.update);
router.delete('/:id', requirePermission('dashboard.view'), ctrl.remove);

module.exports = router;
