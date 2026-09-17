const router = require('express').Router();
const ctrl = require('../controllers/sales.controller');
const asyncHandler = require('../utils/asyncHandler');
const { requirePermissionIfAuth } = require('../middleware/authorize');

/**
 * @openapi
 * /api/v1/sales/stats:
 *   get:
 *     tags: [Sales]
 *     summary: Get sales statistics
 *     description: Returns sales count, totals, and profit
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Statistics retrieved
 *       401:
 *         description: Authentication required
 */
router.get('/stats', requirePermissionIfAuth('sales.view'), asyncHandler(ctrl.getStats));

/**
 * @openapi
 * /api/v1/sales:
 *   get:
 *     tags: [Sales]
 *     summary: List sales
 *     description: Returns paginated list of sales invoices
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - name: search
 *         in: query
 *         schema:
 *           type: string
 *       - name: customerName
 *         in: query
 *         schema:
 *           type: string
 *       - name: paymentType
 *         in: query
 *         schema:
 *           type: string
 *       - name: startDate
 *         in: query
 *         schema:
 *           type: string
 *           format: date
 *       - name: endDate
 *         in: query
 *         schema:
 *           type: string
 *           format: date
 *       - name: page
 *         in: query
 *         schema:
 *           type: integer
 *       - name: limit
 *         in: query
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Sales retrieved
 *       401:
 *         description: Authentication required
 *   post:
 *     tags: [Sales]
 *     summary: Create sale
 *     description: Create a new sales invoice
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/Sale'
 *     responses:
 *       201:
 *         description: Sale created
 *       400:
 *         description: Validation error
 *       401:
 *         description: Authentication required
 */
router.get('/', requirePermissionIfAuth('sales.view'), asyncHandler(ctrl.list));
router.post('/', requirePermissionIfAuth('sales.create'), asyncHandler(ctrl.create));

/**
 * @openapi
 * /api/v1/sales/{id}:
 *   get:
 *     tags: [Sales]
 *     summary: Get sale by ID
 *     description: Returns a specific sales invoice
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
 *         description: Sale retrieved
 *       404:
 *         description: Sale not found
 *   put:
 *     tags: [Sales]
 *     summary: Update sale
 *     description: Update a sales invoice
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
 *             $ref: '#/components/schemas/Sale'
 *     responses:
 *       200:
 *         description: Sale updated
 *       404:
 *         description: Sale not found
 *   delete:
 *     tags: [Sales]
 *     summary: Delete sale
 *     description: Delete a sales invoice
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
 *         description: Sale deleted
 *       404:
 *         description: Sale not found
 */
router.get('/:id', requirePermissionIfAuth('sales.view'), asyncHandler(ctrl.getById));
router.put('/:id', requirePermissionIfAuth('sales.edit'), asyncHandler(ctrl.update));
router.delete('/:id', requirePermissionIfAuth('sales.delete'), asyncHandler(ctrl.remove));

module.exports = router;