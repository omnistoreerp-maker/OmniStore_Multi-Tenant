const router = require('express').Router();
const ctrl = require('../controllers/customers.controller');

/**
 * @openapi
 * /api/v1/customers:
 *   get:
 *     tags: [Customers]
 *     summary: List customers
 *     description: Returns paginated list of customers
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - name: search
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
 *         description: Customers retrieved
 *       401:
 *         description: Authentication required
 *   post:
 *     tags: [Customers]
 *     summary: Create customer
 *     description: Create a new customer
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/Customer'
 *     responses:
 *       201:
 *         description: Customer created
 *       400:
 *         description: Validation error
 *       401:
 *         description: Authentication required
 */
router.get('/', ctrl.list);
router.post('/', ctrl.create);

/**
 * @openapi
 * /api/v1/customers/stats:
 *   get:
 *     tags: [Customers]
 *     summary: Get customer statistics
 *     description: Returns customer count and totals
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
 * /api/v1/customers/{id}:
 *   get:
 *     tags: [Customers]
 *     summary: Get customer by ID
 *     description: Returns a specific customer
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
 *         description: Customer retrieved
 *       404:
 *         description: Customer not found
 *   put:
 *     tags: [Customers]
 *     summary: Update customer
 *     description: Update a customer
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
 *             $ref: '#/components/schemas/Customer'
 *     responses:
 *       200:
 *         description: Customer updated
 *       404:
 *         description: Customer not found
 *   delete:
 *     tags: [Customers]
 *     summary: Delete customer
 *     description: Delete a customer
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
 *         description: Customer deleted
 *       404:
 *         description: Customer not found
 */
router.get('/:id', ctrl.getById);
router.put('/:id', ctrl.update);
router.delete('/:id', ctrl.remove);

module.exports = router;
