const router = require('express').Router();
const ctrl = require('../controllers/oauth.controller');
const { loginRateLimiter } = require('../middleware/security');

/**
 * @openapi
 * /auth/providers:
 *   get:
 *     tags: [OAuth2]
 *     summary: List OAuth providers
 *     description: Returns list of available OAuth providers
 *     responses:
 *       200:
 *         description: Providers retrieved
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
 *                     providers:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           name:
 *                             type: string
 *                           displayName:
 *                             type: string
 */
router.get('/providers', ctrl.getProviders);

/**
 * @openapi
 * /auth/google:
 *   get:
 *     tags: [OAuth2]
 *     summary: Initiate Google OAuth
 *     description: Redirect to Google OAuth consent screen
 *     responses:
 *       302:
 *         description: Redirect to Google
 *       501:
 *         description: Google OAuth not configured
 */
router.get('/google', ctrl.initiateGoogle);

/**
 * @openapi
 * /auth/google/callback:
 *   get:
 *     tags: [OAuth2]
 *     summary: Google OAuth callback
 *     description: Handle Google OAuth callback
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
 *       200:
 *         description: OAuth login successful
 *       401:
 *         description: OAuth authentication failed
 */
router.get('/google/callback', ctrl.callbackGoogle);

/**
 * @openapi
 * /auth/github:
 *   get:
 *     tags: [OAuth2]
 *     summary: Initiate GitHub OAuth
 *     description: Redirect to GitHub OAuth consent screen
 *     responses:
 *       302:
 *         description: Redirect to GitHub
 *       501:
 *         description: GitHub OAuth not configured
 */
router.get('/github', ctrl.initiateGithub);

/**
 * @openapi
 * /auth/github/callback:
 *   get:
 *     tags: [OAuth2]
 *     summary: GitHub OAuth callback
 *     description: Handle GitHub OAuth callback
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
 *       200:
 *         description: OAuth login successful
 *       401:
 *         description: OAuth authentication failed
 */
router.get('/github/callback', ctrl.callbackGithub);

module.exports = router;
