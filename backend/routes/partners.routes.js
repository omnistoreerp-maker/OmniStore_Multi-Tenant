const router = require('express').Router();
const ctrl = require('../controllers/partners.controller');

/**
 * @openapi
 * /api/v1/partners:
 *   get:
 *     tags: [Partners]
 *     summary: List partners
 *     description: Returns paginated list of partners
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
 *         description: Partners retrieved
 *       401:
 *         description: Authentication required
 *   post:
 *     tags: [Partners]
 *     summary: Create partner
 *     description: Create a new partner
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
 *         description: Partner created
 *       400:
 *         description: Validation error
 *       401:
 *         description: Authentication required
 */
router.get('/', ctrl.list);
router.post('/', ctrl.create);

/**
 * @openapi
 * /api/v1/partners/stats:
 *   get:
 *     tags: [Partners]
 *     summary: Get partner statistics
 *     description: Returns partner count and totals
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
 * /api/v1/partners/{id}:
 *   get:
 *     tags: [Partners]
 *     summary: Get partner by ID
 *     description: Returns a specific partner
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
 *         description: Partner retrieved
 *       404:
 *         description: Partner not found
 *   put:
 *     tags: [Partners]
 *     summary: Update partner
 *     description: Update a partner
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
 *         description: Partner updated
 *       404:
 *         description: Partner not found
 *   delete:
 *     tags: [Partners]
 *     summary: Delete partner
 *     description: Delete a partner
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
 *         description: Partner deleted
 *       404:
 *         description: Partner not found
 */
router.get('/:id', ctrl.getById);
router.put('/:id', ctrl.update);
router.delete('/:id', ctrl.remove);

module.exports = router;
