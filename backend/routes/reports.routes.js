const router = require('express').Router();
const ctrl = require('../controllers/reports.controller');
const reportsService = require('../services/reports.service');
const { requirePermission, requirePermissionIfAuth } = require('../middleware/authorize');
const config = require('../config');

// Phase D — Financial reports are protected by an explicit, separate permission
// (reports.financial.view) so that broad `reports.view` (operational reports:
// sales/purchases/inventory) can NEVER be used to reach financial/treasury/
// profit data. This is enforced server-side regardless of the frontend.
//
// When AUTH_REQUIRED is off the legacy open behavior is preserved (no-op).
function reportListGuard(req, res, next) {
  if (!config.authRequired) return next();
  const requested = req.query && req.query.type;
  const permission = requested === 'financial' ? 'reports.financial.view' : 'reports.view';
  return requirePermission(permission)(req, res, next);
}

// Endpoints that target a specific report (GET/PUT/DELETE /:id) must gate on
// the type of the STORED report, resolved server-side from the reports store —
// never from a client-supplied field. A stored financial report requires
// reports.financial.view; anything else keeps the existing reports.view gate.
function reportByIdAuth(req, res, next) {
  if (!config.authRequired) return next();
  const report = reportsService.getById(req.params.id);
  const financial = !!(report && String(report.type || '').toLowerCase() === 'financial');
  const permission = financial ? 'reports.financial.view' : 'reports.view';
  return requirePermission(permission)(req, res, next);
}

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
router.get('/', reportListGuard, ctrl.list);
router.post('/', requirePermissionIfAuth('reports.view'), ctrl.create);

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
router.get('/stats', requirePermissionIfAuth('reports.view'), ctrl.getStats);

// DAY 4 — computed financial readers wired to live posting sources (read-only,
// nothing persisted). Operational summaries keep `reports.view`; money data
// (treasury-backed cash flow, customer/supplier statements) requires the
// financial gate.
const financialReportsController = require('../controllers/financialReports.controller');

router.get('/summary/sales/daily', requirePermissionIfAuth('reports.view'), financialReportsController.dailySales);
router.get('/summary/purchases/daily', requirePermissionIfAuth('reports.view'), financialReportsController.dailyPurchases);
router.get('/summary/inventory', requirePermissionIfAuth('reports.view'), financialReportsController.inventorySummary);
router.get('/statement/customer/:customerId', requirePermissionIfAuth('customerPayments.view'), financialReportsController.customerStatement);
router.get('/statement/supplier/:supplierId', requirePermissionIfAuth('reports.financial.view'), financialReportsController.supplierStatement);
router.get('/cash-flow', requirePermissionIfAuth('reports.financial.view'), financialReportsController.cashFlow);

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
router.get('/:id', reportByIdAuth, ctrl.getById);
router.put('/:id', reportByIdAuth, ctrl.update);
router.delete('/:id', reportByIdAuth, ctrl.remove);

module.exports = router;
