const router = require('express').Router();
const ctrl = require('../controllers/inventory.controller');
const asyncHandler = require('../utils/asyncHandler');
const { requirePermissionIfAuth } = require('../middleware/authorize');

/**
 * @openapi
 * /api/v1/inventory:
 *   get:
 *     tags: [Inventory]
 *     summary: List inventory
 *     description: Returns paginated list of inventory items
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - name: search
 *         in: query
 *         schema:
 *           type: string
 *       - name: category
 *         in: query
 *         schema:
 *           type: string
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
 *         description: Inventory retrieved
 *       401:
 *         description: Authentication required
 *   post:
 *     tags: [Inventory]
 *     summary: Create inventory item
 *     description: Add a new item to inventory
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/Inventory'
 *     responses:
 *       201:
 *         description: Inventory item created
 *       400:
 *         description: Validation error
 *       401:
 *         description: Authentication required
 */
router.get('/', requirePermissionIfAuth('inventory.view'), asyncHandler(ctrl.list));
router.post('/', requirePermissionIfAuth('inventory.create'), asyncHandler(ctrl.create));

/**
 * @openapi
 * /api/v1/inventory/stats:
 *   get:
 *     tags: [Inventory]
 *     summary: Get inventory statistics
 *     description: Returns inventory count and value
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Statistics retrieved
 *       401:
 *         description: Authentication required
 */
router.get('/stats', requirePermissionIfAuth('inventory.view'), asyncHandler(ctrl.getStats));

/**
 * @openapi
 * /api/v1/inventory/{id}:
 *   get:
 *     tags: [Inventory]
 *     summary: Get inventory item by ID
 *     description: Returns a specific inventory item
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
 *         description: Inventory item retrieved
 *       404:
 *         description: Item not found
 *   put:
 *     tags: [Inventory]
 *     summary: Update inventory item
 *     description: Update an inventory item
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
 *             $ref: '#/components/schemas/Inventory'
 *     responses:
 *       200:
 *         description: Inventory item updated
 *       404:
 *         description: Item not found
 *   delete:
 *     tags: [Inventory]
 *     summary: Delete inventory item
 *     description: Delete an inventory item
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
 *         description: Inventory item deleted
 *       404:
 *         description: Item not found
 */
router.get('/:id', requirePermissionIfAuth('inventory.view'), asyncHandler(ctrl.getById));
router.put('/:id', requirePermissionIfAuth('inventory.edit'), asyncHandler(ctrl.update));
router.delete('/:id', requirePermissionIfAuth('inventory.delete'), asyncHandler(ctrl.remove));

module.exports = router;
