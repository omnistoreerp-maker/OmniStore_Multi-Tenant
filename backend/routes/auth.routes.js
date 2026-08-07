const router = require('express').Router();
const ctrl = require('../controllers/auth.controller');
const { loginRateLimiter } = require('../middleware/security');

/**
 * @openapi
 * /api/v1/auth/login:
 *   post:
 *     tags: [Authentication]
 *     summary: User login
 *     description: |
 *       Authenticate user with username and password.
 *       If MFA is enabled, returns mfaRequired with tempToken.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/LoginRequest'
 *     responses:
 *       200:
 *         description: Login successful
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/LoginResponse'
 *       401:
 *         description: Invalid credentials
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.post('/login', loginRateLimiter(), ctrl.login);

/**
 * @openapi
 * /api/v1/auth/refresh:
 *   post:
 *     tags: [Authentication]
 *     summary: Refresh access token
 *     description: Refresh an expired access token using refresh token
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [refreshToken]
 *             properties:
 *               refreshToken:
 *                 type: string
 *     responses:
 *       200:
 *         description: Token refreshed
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
 *                     accessToken:
 *                       type: string
 *       401:
 *         description: Invalid refresh token
 */
router.post('/refresh', ctrl.refresh);

/**
 * @openapi
 * /api/v1/auth/logout:
 *   post:
 *     tags: [Authentication]
 *     summary: User logout
 *     description: Revoke tokens and clear session
 *     responses:
 *       200:
 *         description: Logout successful
 */
router.post('/logout', ctrl.logout);

/**
 * @openapi
 * /api/v1/auth/me:
 *   get:
 *     tags: [Authentication]
 *     summary: Get current user
 *     description: Returns the authenticated user's profile
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: User profile retrieved
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
 *                     user:
 *                       $ref: '#/components/schemas/User'
 *       401:
 *         description: Authentication required
 */
router.get('/me', ctrl.me);

/**
 * @openapi
 * /api/v1/auth/roles:
 *   get:
 *     tags: [Authentication]
 *     summary: Get available roles
 *     description: Returns list of available user roles
 *     responses:
 *       200:
 *         description: Roles retrieved
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
 *                     roles:
 *                       type: array
 *                       items:
 *                         type: string
 */
router.get('/roles', ctrl.roles);

/**
 * @openapi
 * /api/v1/auth/permissions:
 *   get:
 *     tags: [Authentication]
 *     summary: Get user permissions
 *     description: Returns permissions for a specific user
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - name: username
 *         in: query
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Permissions retrieved
 *       401:
 *         description: Authentication required
 *       403:
 *         description: Insufficient permission
 */
router.get('/permissions', ctrl.permissions);

module.exports = router;
