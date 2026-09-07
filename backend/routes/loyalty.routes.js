'use strict';

const router = require('express').Router();
const ctrl = require('../controllers/loyalty.controller');
const asyncHandler = require('../utils/asyncHandler');
const { requirePermissionIfAuth } = require('../middleware/authorize');

/**
 * @openapi
 * /api/v1/loyalty/balance/{customerId}:
 *   get:
 *     tags: [Loyalty]
 *     summary: Get customer loyalty balance
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
 *         description: Balance retrieved
 *       404:
 *         description: Customer not found
 *       401:
 *         description: Authentication required
 */
router.get('/balance/:customerId', requirePermissionIfAuth('loyalty.view'), asyncHandler(ctrl.getBalance));

/**
 * @openapi
 * /api/v1/loyalty/transactions/{customerId}:
 *   get:
 *     tags: [Loyalty]
 *     summary: Get customer loyalty transactions
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - name: customerId
 *         in: path
 *         required: true
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
 *       404:
 *         description: Customer not found
 *       401:
 *         description: Authentication required
 */
router.get('/transactions/:customerId', requirePermissionIfAuth('loyalty.view'), asyncHandler(ctrl.getTransactions));

/**
 * @openapi
 * /api/v1/loyalty/earn:
 *   post:
 *     tags: [Loyalty]
 *     summary: Earn loyalty points
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - customerId
 *               - points
 *               - amount
 *               - ref
 *             properties:
 *               customerId:
 *                 type: string
 *               points:
 *                 type: integer
 *               amount:
 *                 type: number
 *               ref:
 *                 type: string
 *               refType:
 *                 type: string
 *               note:
 *                 type: string
 *               branchId:
 *                 type: string
 *     responses:
 *       201:
 *         description: Points earned
 *       400:
 *         description: Validation error or duplicate
 *       401:
 *         description: Authentication required
 */
router.post('/earn', requirePermissionIfAuth('loyalty.earn'), asyncHandler(ctrl.earn));

/**
 * @openapi
 * /api/v1/loyalty/redeem:
 *   post:
 *     tags: [Loyalty]
 *     summary: Redeem loyalty points
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - customerId
 *               - points
 *               - amount
 *               - ref
 *             properties:
 *               customerId:
 *                 type: string
 *               points:
 *                 type: integer
 *               amount:
 *                 type: number
 *               ref:
 *                 type: string
 *               refType:
 *                 type: string
 *               note:
 *                 type: string
 *               branchId:
 *                 type: string
 *     responses:
 *       200:
 *         description: Points redeemed
 *       400:
 *         description: Validation error, insufficient points, or duplicate
 *       401:
 *         description: Authentication required
 */
router.post('/redeem', requirePermissionIfAuth('loyalty.redeem'), asyncHandler(ctrl.redeem));

/**
 * @openapi
 * /api/v1/loyalty/reverse:
 *   post:
 *     tags: [Loyalty]
 *     summary: Reverse loyalty points for a return
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - customerId
 *               - originalSaleId
 *               - returnId
 *               - refundAmount
 *             properties:
 *               customerId:
 *                 type: string
 *               originalSaleId:
 *                 type: string
 *               returnId:
 *                 type: string
 *               refundAmount:
 *                 type: number
 *               note:
 *                 type: string
 *               branchId:
 *                 type: string
 *     responses:
 *       200:
 *         description: Points reversed
 *       400:
 *         description: Validation error, already reversed, or duplicate
 *       401:
 *         description: Authentication required
 */
router.post('/reverse', requirePermissionIfAuth('loyalty.reverse'), asyncHandler(ctrl.reverse));

/**
 * @openapi
 * /api/v1/loyalty/config:
 *   get:
 *     tags: [Loyalty]
 *     summary: Get loyalty configuration
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Config retrieved
 *       401:
 *         description: Authentication required
 *   put:
 *     tags: [Loyalty]
 *     summary: Update loyalty configuration
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *     responses:
 *       200:
 *         description: Config updated
 *       400:
 *         description: Validation error
 *       401:
 *         description: Authentication required
 */
router.get('/config', requirePermissionIfAuth('loyalty.view'), asyncHandler(ctrl.getConfig));
router.put('/config', requirePermissionIfAuth('loyalty.manage'), asyncHandler(ctrl.updateConfig));

/**
 * @openapi
 * /api/v1/loyalty/metrics:
 *   get:
 *     tags: [Loyalty]
 *     summary: Get loyalty metrics
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Metrics retrieved
 *       401:
 *         description: Authentication required
 */
router.get('/metrics', requirePermissionIfAuth('loyalty.view'), asyncHandler(ctrl.getMetrics));

module.exports = router;
