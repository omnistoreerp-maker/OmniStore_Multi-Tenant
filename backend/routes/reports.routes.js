const router = require('express').Router();
const ctrl = require('../controllers/reports.controller');

/**
 * @openapi
 * /api/v1/reports:
 *   get:
 *     tags: [Reports]
 *     summary: List reports
 *     description: Returns paginated list of reports
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - name: type
 *         in: query
 *         required: true
 *         schema:
 *           type: string
 *           enum: [sales, purchases, inventory, financial]
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
 *     responses:
 *       200:
 *         description: Reports retrieved
 *       400:
 *         description: Invalid report type
 *       401:
 *         description: Authentication required
 *   post:
 *     tags: [Reports]
 *     summary: Create report
 *     description: Create a new report
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
 *         description: Report created
 *       400:
 *         description: Validation error
 *       401:
 *         description: Authentication required
 */
router.get('/', ctrl.list);
router.post('/', ctrl.create);

/**
 * @openapi
 * /api/v1/reports/stats:
 *   get:
 *     tags: [Reports]
 *     summary: Get report statistics
 *     description: Returns report count and totals
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
 * /api/v1/reports/{id}:
 *   get:
 *     tags: [Reports]
 *     summary: Get report by ID
 *     description: Returns a specific report
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
 *         description: Report retrieved
 *       404:
 *         description: Report not found
 *   put:
 *     tags: [Reports]
 *     summary: Update report
 *     description: Update a report
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
 *         description: Report updated
 *       404:
 *         description: Report not found
 *   delete:
 *     tags: [Reports]
 *     summary: Delete report
 *     description: Delete a report
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
 *         description: Report deleted
 *       404:
 *         description: Report not found
 */
router.get('/:id', ctrl.getById);
router.put('/:id', ctrl.update);
router.delete('/:id', ctrl.remove);

module.exports = router;
