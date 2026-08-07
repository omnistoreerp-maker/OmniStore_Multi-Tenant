const router = require('express').Router();
const ctrl = require('../controllers/webhook.controller');
const { requireAuth } = require('../middleware/auth');

/**
 * @openapi
 * /api/v1/webhooks:
 *   get:
 *     tags: [Webhooks]
 *     summary: List webhooks
 *     description: Returns all registered webhook endpoints (secrets never exposed)
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Webhooks retrieved
 *       401:
 *         description: Authentication required
 *   post:
 *     tags: [Webhooks]
 *     summary: Register webhook
 *     description: |
 *       Register an HTTP endpoint to receive events. The system signs each
 *       delivery with HMAC-SHA256 using the endpoint's secret.
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [url]
 *             properties:
 *               url:
 *                 type: string
 *                 description: Destination URL (http/https)
 *               events:
 *                 type: array
 *                 items:
 *                   type: string
 *                 description: Event types to receive (default: sale/inventory events)
 *               secret:
 *                 type: string
 *                 description: Optional custom signing secret (auto-generated if omitted)
 *               description:
 *                 type: string
 *     responses:
 *       201:
 *         description: Webhook registered
 *       400:
 *         description: Invalid request
 *       401:
 *         description: Authentication required
 */
router.get('/', requireAuth, ctrl.list);
router.post('/', requireAuth, ctrl.register);

/**
 * @openapi
 * /api/v1/webhooks/{id}:
 *   get:
 *     tags: [Webhooks]
 *     summary: Get webhook by ID
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
 *         description: Webhook retrieved
 *       404:
 *         description: Webhook not found
 *   put:
 *     tags: [Webhooks]
 *     summary: Update webhook
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               url:
 *                 type: string
 *               events:
 *                 type: array
 *                 items:
 *                   type: string
 *               active:
 *                 type: boolean
 *               description:
 *                 type: string
 *     responses:
 *       200:
 *         description: Webhook updated
 *       404:
 *         description: Webhook not found
 *   delete:
 *     tags: [Webhooks]
 *     summary: Remove webhook
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
 *         description: Webhook removed
 *       404:
 *         description: Webhook not found
 */
router.get('/:id', requireAuth, ctrl.getById);
router.put('/:id', requireAuth, ctrl.update);
router.delete('/:id', requireAuth, ctrl.remove);

/**
 * @openapi
 * /api/v1/webhooks/{id}/test:
 *   post:
 *     tags: [Webhooks]
 *     summary: Send test webhook
 *     description: Deliver a test event to the webhook endpoint to verify connectivity
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               event:
 *                 type: string
 *                 default: sale.created
 *     responses:
 *       200:
 *         description: Test webhook delivered
 *       502:
 *         description: Test webhook failed
 *       404:
 *         description: Webhook not found
 */
router.post('/:id/test', requireAuth, ctrl.sendTest);

module.exports = router;
