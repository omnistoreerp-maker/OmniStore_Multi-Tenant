const router = require('express').Router();
const ctrl = require('../controllers/inventoryTransactions.controller');

/**
 * @openapi
 * /api/v1/inventory-transactions:
 *   get:
 *     tags: [InventoryTransactions]
 *     summary: List inventory transactions
 *     description: Returns paginated list of inventory transactions
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - name: search
 *         in: query
 *         schema:
 *           type: string
 *       - name: type
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
 *         description: Transactions retrieved
 *       401:
 *         description: Authentication required
 *   post:
 *     tags: [InventoryTransactions]
 *     summary: Create inventory transaction
 *     description: Create a new inventory transaction
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
 *         description: Transaction created
 *       400:
 *         description: Validation error
 *       401:
 *         description: Authentication required
 */
router.get('/', ctrl.list);
router.post('/', ctrl.create);

/**
 * @openapi
 * /api/v1/inventory-transactions/stats:
 *   get:
 *     tags: [InventoryTransactions]
 *     summary: Get inventory transaction statistics
 *     description: Returns inventory transaction count and totals
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Statistics retrieved
 *       401:
 *         description: Authentication required
 */
router.get('/stats', ctrl.getStats);

/**
 * @openapi
 * /api/v1/inventory-transactions/{id}:
 *   get:
 *     tags: [InventoryTransactions]
 *     summary: Get inventory transaction by ID
 *     description: Returns a specific inventory transaction
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
 *         description: Transaction retrieved
 *       404:
 *         description: Transaction not found
 *   put:
 *     tags: [InventoryTransactions]
 *     summary: Update inventory transaction
 *     description: Update an inventory transaction
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
 *         description: Transaction updated
 *       404:
 *         description: Transaction not found
 *   delete:
 *     tags: [InventoryTransactions]
 *     summary: Delete inventory transaction
 *     description: Delete an inventory transaction
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
 *         description: Transaction deleted
 *       404:
 *         description: Transaction not found
 */
router.get('/:id', ctrl.getById);
router.put('/:id', ctrl.update);
router.delete('/:id', ctrl.remove);

module.exports = router;
