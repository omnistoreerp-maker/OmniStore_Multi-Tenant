const router = require('express').Router();
const ctrl = require('../controllers/treasury.controller');

/**
 * @openapi
 * /api/v1/treasury:
 *   get:
 *     tags: [Treasury]
 *     summary: List treasury transactions
 *     description: Returns paginated list of treasury transactions
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - name: type
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
 *         description: Transactions retrieved
 *       401:
 *         description: Authentication required
 *   post:
 *     tags: [Treasury]
 *     summary: Create treasury transaction
 *     description: Create a new treasury transaction
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
 * /api/v1/treasury/stats:
 *   get:
 *     tags: [Treasury]
 *     summary: Get treasury statistics
 *     description: Returns treasury transaction count and totals
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
 * /api/v1/treasury/{id}:
 *   get:
 *     tags: [Treasury]
 *     summary: Get treasury transaction by ID
 *     description: Returns a specific treasury transaction
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
 *     tags: [Treasury]
 *     summary: Update treasury transaction
 *     description: Update a treasury transaction
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
 *     tags: [Treasury]
 *     summary: Delete treasury transaction
 *     description: Delete a treasury transaction
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
