const router = require('express').Router();
const ctrl = require('../controllers/mfa.controller');
const { requireAuth } = require('../middleware/auth');
const { loginRateLimiter } = require('../middleware/security');

/**
 * @openapi
 * /api/v1/auth/mfa/enable:
 *   post:
 *     tags: [MFA]
 *     summary: Enable MFA
 *     description: Enable Multi-Factor Authentication for the authenticated user
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [secret, token]
 *             properties:
 *               secret:
 *                 type: string
 *                 description: MFA secret from /mfa/secret endpoint
 *               token:
 *                 type: string
 *                 description: 6-digit TOTP code
 *     responses:
 *       200:
 *         description: MFA enabled successfully
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
 *                     backupCodes:
 *                       type: array
 *                       items:
 *                         type: string
 *                     message:
 *                       type: string
 *       400:
 *         description: Invalid MFA code
 *       401:
 *         description: Authentication required
 */
router.post('/enable', requireAuth, ctrl.enable);

/**
 * @openapi
 * /api/v1/auth/mfa/disable:
 *   post:
 *     tags: [MFA]
 *     summary: Disable MFA
 *     description: Disable Multi-Factor Authentication for the authenticated user
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [token]
 *             properties:
 *               token:
 *                 type: string
 *                 description: 6-digit TOTP code
 *     responses:
 *       200:
 *         description: MFA disabled successfully
 *       400:
 *         description: Invalid MFA code or MFA not enabled
 *       401:
 *         description: Authentication required
 */
router.post('/disable', requireAuth, ctrl.disable);

/**
 * @openapi
 * /api/v1/auth/mfa/verify:
 *   post:
 *     tags: [MFA]
 *     summary: Verify MFA code
 *     description: Verify a TOTP code for the authenticated user
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [token]
 *             properties:
 *               token:
 *                 type: string
 *                 description: 6-digit TOTP code or backup code
 *     responses:
 *       200:
 *         description: MFA verification result
 *       401:
 *         description: Invalid MFA code
 */
router.post('/verify', requireAuth, ctrl.verify);

/**
 * @openapi
 * /api/v1/auth/mfa/secret:
 *   get:
 *     tags: [MFA]
 *     summary: Get MFA secret
 *     description: Generate and return a new MFA secret with QR code
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: MFA secret generated
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
 *                     secret:
 *                       type: string
 *                       description: Base32 encoded secret
 *                     qrCode:
 *                       type: string
 *                       description: QR code data URL
 *       401:
 *         description: Authentication required
 */
router.get('/secret', requireAuth, ctrl.getSecret);

/**
 * @openapi
 * /api/v1/auth/mfa/status:
 *   get:
 *     tags: [MFA]
 *     summary: Get MFA status
 *     description: Returns MFA status for the authenticated user
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: MFA status retrieved
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
 *                     enabled:
 *                       type: boolean
 *                     enabledAt:
 *                       type: string
 *                       format: date-time
 *                     backupCodesCount:
 *                       type: integer
 *       401:
 *         description: Authentication required
 */
router.get('/status', requireAuth, ctrl.getStatus);

/**
 * @openapi
 * /api/v1/auth/mfa/backup-codes:
 *   post:
 *     tags: [MFA]
 *     summary: Generate new backup codes
 *     description: Generate new backup codes for MFA recovery
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [token]
 *             properties:
 *               token:
 *                 type: string
 *                 description: 6-digit TOTP code
 *     responses:
 *       200:
 *         description: Backup codes generated
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
 *                     backupCodes:
 *                       type: array
 *                       items:
 *                         type: string
 *       401:
 *         description: Invalid MFA code
 */
router.post('/backup-codes', requireAuth, ctrl.generateBackupCodes);

module.exports = router;
