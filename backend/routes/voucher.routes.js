const router = require('express').Router();
const ctrl = require('../controllers/voucher.controller');

/**
 * @openapi
 * /api/v1/vouchers:
 *   get:
 *     tags: [Vouchers]
 *     summary: List vouchers
 *     description: Returns paginated list of vouchers
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
 *         description: Vouchers retrieved
 *       401:
 *         description: Authentication required
 *   post:
 *     tags: [Vouchers]
 *     summary: Create voucher
 *     description: Create a new voucher
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
 *         description: Voucher created
 *       400:
 *         description: Validation error
 *       401:
 *         description: Authentication required
 */
router.get('/', ctrl.list);
router.post('/', ctrl.create);

/**
 * @openapi
 * /api/v1/vouchers/stats:
 *   get:
 *     tags: [Vouchers]
 *     summary: Get voucher statistics
 *     description: Returns voucher count and totals
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
 * /api/v1/vouchers/{id}:
 *   get:
 *     tags: [Vouchers]
 *     summary: Get voucher by ID
 *     description: Returns a specific voucher
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
 *         description: Voucher retrieved
 *       404:
 *         description: Voucher not found
 *   put:
 *     tags: [Vouchers]
 *     summary: Update voucher
 *     description: Update a voucher
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
 *         description: Voucher updated
 *       404:
 *         description: Voucher not found
 *   delete:
 *     tags: [Vouchers]
 *     summary: Delete voucher
 *     description: Delete a voucher
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
 *         description: Voucher deleted
 *       404:
 *         description: Voucher not found
 */
router.get('/:id', ctrl.getById);
router.put('/:id', ctrl.update);
router.delete('/:id', ctrl.remove);

module.exports = router;
