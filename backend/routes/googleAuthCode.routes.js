const router = require('express').Router();
const ctrl = require('../controllers/googleAuthCode.controller');
const { googleLoginRateLimiter, googleLoginChallengeRateLimiter } = require('../middleware/security');

/**
 * @openapi
 * /auth/google-login-code:
 *   get:
 *     tags: [Authentication]
 *     summary: Initiate Google Authorization Code flow
 *     description: Redirect to Google OAuth consent screen with PKCE
 *     parameters:
 *       - name: returnTo
 *         in: query
 *         schema:
 *           type: string
 *     responses:
 *       302:
 *         description: Redirect to Google
 *       501:
 *         description: Google login not configured
 */
router.get('/google-login-code', googleLoginRateLimiter(), ctrl.initiate);

/**
 * @openapi
 * /auth/google-login-code/callback:
 *   get:
 *     tags: [Authentication]
 *     summary: Google Authorization Code callback
 *     description: Handle Google OAuth callback with PKCE verification
 *     parameters:
 *       - name: code
 *         in: query
 *         schema:
 *           type: string
 *       - name: state
 *         in: query
 *         schema:
 *           type: string
 *     responses:
 *       302:
 *         description: Redirect to application with result
 *       401:
 *         description: Authentication failed
 */
router.get('/google-login-code/callback', googleLoginRateLimiter(), ctrl.callback);

/**
 * @openapi
 * /auth/google-login-code/mfa-verify:
 *   post:
 *     tags: [Authentication]
 *     summary: Complete MFA after Google login
 *     description: Verify MFA code against challenge token
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [tempToken, mfaToken]
 *             properties:
 *               tempToken:
 *                 type: string
 *               mfaToken:
 *                 type: string
 *     responses:
 *       200:
 *         description: MFA completed, tokens issued
 *       400:
 *         description: Missing tempToken or mfaToken
 *       401:
 *         description: Invalid or expired challenge, or invalid MFA code
 */
router.post('/google-login-code/mfa-verify', googleLoginChallengeRateLimiter(), ctrl.mfaVerify);

/**
 * @openapi
 * /auth/google-login-code/select-tenant:
 *   post:
 *     tags: [Authentication]
 *     summary: Select tenant after Google login
 *     description: Select authorized active tenant when user has multiple memberships
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [tempToken, tenantId]
 *             properties:
 *               tempToken:
 *                 type: string
 *               tenantId:
 *                 type: string
 *     responses:
 *       200:
 *         description: Tenant selected, tokens issued
 *       400:
 *         description: Missing tempToken or tenantId
 *       401:
 *         description: Invalid or expired challenge
 *       403:
 *         description: Unauthorized tenant or suspended company
 */
router.post('/google-login-code/select-tenant', googleLoginChallengeRateLimiter(), ctrl.selectTenant);

module.exports = router;