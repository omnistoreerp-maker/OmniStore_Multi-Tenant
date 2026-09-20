const router = require('express').Router();
const ctrl = require('../controllers/apiKey.controller');
const { requireAuth } = require('../middleware/auth');

/**
 * @openapi
 * /api/v1/api-keys:
 *   get:
 *     tags: [API Keys]
 *     summary: List API keys
 *     description: Returns list of all API keys (hashed, no raw keys exposed)
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - name: userId
 *         in: query
 *         schema:
 *           type: string
 *         description: Filter by owner user ID
 *       - name: enabled
 *         in: query
 *         schema:
 *           type: string
 *           enum: ['true', 'false']
 *         description: Filter by enabled status
 *     responses:
 *       200:
 *         description: API keys retrieved
 *       401:
 *         description: Authentication required
 *   post:
 *     tags: [API Keys]
 *     summary: Generate API key
 *     description: |
 *       Generate a new API key. The raw key is returned ONCE in the response.
 *       Store it securely — it cannot be retrieved later.
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name]
 *             properties:
 *               name:
 *                 type: string
 *                 description: Human-readable key name
 *               scopes:
 *                 type: array
 *                 items:
 *                   type: string
 *                 default: ['read']
 *                 description: Permission scopes (read, write, *, etc.)
 *               rateLimitMax:
 *                 type: integer
 *                 description: Per-key rate limit (requests per 15 min)
 *               expiresAt:
 *                 type: string
 *                 format: date-time
 *                 description: Optional expiration date
 *     responses:
 *       201:
 *         description: API key generated (raw key included)
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     id:
 *                       type: string
 *                     key:
 *                       type: string
 *                       description: Raw API key (shown once)
 *                     name:
 *                       type: string
 *       400:
 *         description: Validation error
 *       401:
 *         description: Authentication required
 */
router.get('/', requireAuth, ctrl.list);
router.post('/', requireAuth, ctrl.generate);

/**
 * @openapi
 * /api/v1/api-keys/stats:
 *   get:
 *     tags: [API Keys]
 *     summary: Get API key statistics
 *     description: Returns total, enabled, revoked, and expired key counts
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Statistics retrieved
 *       401:
 *         description: Authentication required
 */
router.get('/stats', requireAuth, ctrl.getStats);

/**
 * @openapi
 * /api/v1/api-keys/validate:
 *   get:
 *     tags: [API Keys]
 *     summary: Validate API key
 *     description: Diagnostic endpoint to check if an API key is valid
 *     security:
 *       - ApiKeyAuth: []
 *     responses:
 *       200:
 *         description: API key is valid
 *       400:
 *         description: No API key provided
 *       401:
 *         description: Invalid or revoked API key
 */
router.get('/validate', ctrl.validate);

/**
 * @openapi
 * /api/v1/api-keys/{id}:
 *   get:
 *     tags: [API Keys]
 *     summary: Get API key by ID
 *     description: Returns a specific API key record (no raw key)
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
 *         description: API key retrieved
 *       404:
 *         description: API key not found
 *       401:
 *         description: Authentication required
 */
router.get('/:id', requireAuth, ctrl.getById);

/**
 * @openapi
 * /api/v1/api-keys/{id}/revoke:
 *   post:
 *     tags: [API Keys]
 *     summary: Revoke API key
 *     description: Revoke an API key (immediate effect, cannot be undone)
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
 *         description: API key revoked
 *       404:
 *         description: API key not found
 *       401:
 *         description: Authentication required
 */
router.post('/:id/revoke', requireAuth, ctrl.revoke);

/**
 * @openapi
 * /api/v1/api-keys/{id}/enable:
 *   post:
 *     tags: [API Keys]
 *     summary: Enable API key
 *     description: Re-enable a disabled API key
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
 *         description: API key enabled
 *       404:
 *         description: API key not found
 *       401:
 *         description: Authentication required
 */
router.post('/:id/enable', requireAuth, ctrl.enable);

/**
 * @openapi
 * /api/v1/api-keys/{id}/disable:
 *   post:
 *     tags: [API Keys]
 *     summary: Disable API key
 *     description: Disable an API key without revoking it
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
 *         description: API key disabled
 *       404:
 *         description: API key not found
 *       401:
 *         description: Authentication required
 */
router.post('/:id/disable', requireAuth, ctrl.disable);

/**
 * @openapi
 * /api/v1/api-keys/{id}:
 *   delete:
 *     tags: [API Keys]
 *     summary: Delete API key
 *     description: Permanently delete an API key
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
 *         description: API key deleted
 *       404:
 *         description: API key not found
 *       401:
 *         description: Authentication required
 */
router.delete('/:id', requireAuth, ctrl.remove);

module.exports = router;
