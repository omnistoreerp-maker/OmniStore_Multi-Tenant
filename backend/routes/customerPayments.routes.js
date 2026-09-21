const router = require('express').Router();
const ctrl = require('../controllers/customerPayments.controller');
const asyncHandler = require('../utils/asyncHandler');
const { requirePermissionIfAuth } = require('../middleware/authorize');

// DAY 3 — Customer Ledger Workflow (payments on account, treasury-backed).

/**
 * @openapi
 * /api/v1/customer-payments/stats:
 *   get:
 *     tags: [CustomerPayments]
 *     summary: Customer payment stats
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Stats retrieved
 */
router.get('/stats', requirePermissionIfAuth('customerPayments.view'), asyncHandler(ctrl.getStats));

/**
 * @openapi
 * /api/v1/customer-payments/ledger/{customerId}:
 *   get:
 *     tags: [CustomerPayments]
 *     summary: Derived customer ledger (opening + credit sales - payments)
 *     description: Reports-ready ledger rows with debit/credit, references, tenant/branch stamps and outstanding balance.
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - name: customerId
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Ledger retrieved
 *       404:
 *         description: Customer not found
 */
router.get('/ledger/:customerId', requirePermissionIfAuth('customerPayments.view'), asyncHandler(ctrl.ledger));

/**
 * @openapi
 * /api/v1/customer-payments:
 *   get:
 *     tags: [CustomerPayments]
 *     summary: List customer payments
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Payments retrieved
 *   post:
 *     tags: [CustomerPayments]
 *     summary: Record a customer payment (posts a treasury in receipt)
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       201:
 *         description: Payment recorded
 *       400:
 *         description: Validation error
 *       404:
 *         description: Customer not found
 */
router.get('/', requirePermissionIfAuth('customerPayments.view'), asyncHandler(ctrl.list));
router.post('/', requirePermissionIfAuth('customerPayments.create'), asyncHandler(ctrl.create));

/**
 * @openapi
 * /api/v1/customer-payments/{id}:
 *   get:
 *     tags: [CustomerPayments]
 *     summary: Get a customer payment
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
 *         description: Payment retrieved
 *       404:
 *         description: Payment not found
 *   put:
 *     tags: [CustomerPayments]
 *     summary: Update a customer payment (repost-safe)
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
 *         description: Payment updated
 *   delete:
 *     tags: [CustomerPayments]
 *     summary: Delete a customer payment (reverses its treasury receipt)
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
 *         description: Payment deleted
 */
router.get('/:id', requirePermissionIfAuth('customerPayments.view'), asyncHandler(ctrl.getById));
router.put('/:id', requirePermissionIfAuth('customerPayments.edit'), asyncHandler(ctrl.update));
router.delete('/:id', requirePermissionIfAuth('customerPayments.delete'), asyncHandler(ctrl.remove));

module.exports = router;