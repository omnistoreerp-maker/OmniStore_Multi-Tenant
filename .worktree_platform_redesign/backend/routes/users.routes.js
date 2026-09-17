const router = require('express').Router();
const ctrl = require('../controllers/users.controller');
const { requireAuth } = require('../middleware/auth');
const { requirePermission, requirePermissionIfAuth } = require('../middleware/authorize');

/**
 * @openapi
 * /api/v1/users:
 *   get:
 *     tags: [Users]
 *     summary: List users
 *     description: Returns paginated list of users
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - name: search
 *         in: query
 *         schema:
 *           type: string
 *       - name: role
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
 *         description: Users retrieved
 *       401:
 *         description: Authentication required
 *   post:
 *     tags: [Users]
 *     summary: Create user
 *     description: Create a new user
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [username, password]
 *             properties:
 *               username:
 *                 type: string
 *               password:
 *                 type: string
 *                 format: password
 *               fullName:
 *                 type: string
 *               email:
 *                 type: string
 *                 format: email
 *               role:
 *                 type: string
 *               phone:
 *                 type: string
 *     responses:
 *       201:
 *         description: User created
 *       400:
 *         description: Validation error
 *       401:
 *         description: Authentication required
 */
router.get('/', requirePermissionIfAuth('users.view'), ctrl.list);
router.post('/', requirePermissionIfAuth('users.create'), ctrl.create);

/**
 * @openapi
 * /api/v1/users/stats:
 *   get:
 *     tags: [Users]
 *     summary: Get user statistics
 *     description: Returns user count and role distribution
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Statistics retrieved
 *       401:
 *         description: Authentication required
 */
router.get('/stats', requirePermissionIfAuth('users.view'), ctrl.getStats);

/**
 * @openapi
 * /api/v1/users/{id}:
 *   get:
 *     tags: [Users]
 *     summary: Get user by ID
 *     description: Returns a specific user
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
 *         description: User retrieved
 *       404:
 *         description: User not found
 *   put:
 *     tags: [Users]
 *     summary: Update user
 *     description: Update an existing user
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
 *         description: User updated
 *       404:
 *         description: User not found
 *   delete:
 *     tags: [Users]
 *     summary: Delete user
 *     description: Delete a user
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
 *         description: User deleted
 *       404:
 *         description: User not found
 */
router.get('/:id', requirePermissionIfAuth('users.view'), ctrl.getById);
router.put('/:id', requirePermissionIfAuth('users.edit'), ctrl.update);
router.delete('/:id', requirePermissionIfAuth('users.delete'), ctrl.remove);

/**
 * @openapi
 * /api/v1/users/{id}/reset-password:
 *   post:
 *     tags: [Users]
 *     summary: Reset a user's password (admin)
 *     description: Sets a new password for another user, invalidates their
 *       outstanding tokens, and records an audit event. Requires the
 *       users.password.reset permission. Self-reset is refused (use
 *       /auth/change-password instead). Cross-tenant targets are rejected.
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
 *             required: [newPassword]
 *             properties:
 *               newPassword:
 *                 type: string
 *                 format: password
 *     responses:
 *       200:
 *         description: Password reset successfully
 *       400:
 *         description: Validation error or self-reset
 *       401:
 *         description: Authentication required
 *       403:
 *         description: Insufficient permission or cross-tenant target
 *       404:
 *         description: User not found
 */
router.post('/:id/reset-password', requireAuth, requirePermission('users.password.reset'), ctrl.resetPassword);

/**
 * @openapi
 * /api/v1/users/{id}/permissions:
 *   get:
 *     tags: [Users]
 *     summary: Get user permissions for a tenant
 *     description: Returns the effective permissions, baseline, and overrides for a user in the current tenant context.
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
 *         description: Permissions retrieved
 *       401:
 *         description: Authentication required
 *       403:
 *         description: Insufficient permission or cross-tenant target
 *       404:
 *         description: User not found
 *   put:
 *     tags: [Users]
 *     summary: Update user permission overrides for a tenant
 *     description: Sets additive permission overrides (boolean map) for a user in the current tenant. Requires users.permissions.edit and canGrantPermission for each granted permission. Self-modification is forbidden. Last-Owner protection applies.
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
 *             required: [overrides]
 *             properties:
 *               overrides:
 *                 type: object
 *                 additionalProperties:
 *                   type: boolean
 *                 description: Permission name to boolean (true=grant, false=revoke). Only known permissions allowed.
 *     responses:
 *       200:
 *         description: Permissions updated
 *       400:
 *         description: Validation error
 *       401:
 *         description: Authentication required
 *       403:
 *         description: Insufficient permission, self-modification, or cross-tenant
 *       404:
 *         description: User not found
 *       409:
 *         description: Last-Owner protection triggered
 */
router.get('/:id/permissions', requireAuth, requirePermission('users.permissions.view'), ctrl.getPermissions);
router.put('/:id/permissions', requireAuth, requirePermission('users.permissions.edit'), ctrl.updatePermissions);

/**
 * @openapi
 * /api/v1/users/{id}/disable:
 *   post:
 *     tags: [Users]
 *     summary: Disable a user
 *     description: Sets user status to disabled and invalidates all outstanding tokens by bumping tokenVersion. Requires users.disable. Self-disable forbidden. Last-Owner protection applies.
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
 *         description: User disabled
 *       401:
 *         description: Authentication required
 *       403:
 *         description: Insufficient permission, self-disable, or cross-tenant
 *       404:
 *         description: User not found
 *       409:
 *         description: Last-Owner protection triggered
 */
/**
 * @openapi
 * /api/v1/users/{id}/enable:
 *   post:
 *     tags: [Users]
 *     summary: Enable a user
 *     description: Sets user status to active. Requires users.enable. Cross-tenant targets rejected.
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
 *         description: User enabled
 *       401:
 *         description: Authentication required
 *       403:
 *         description: Insufficient permission or cross-tenant
 *       404:
 *         description: User not found
 */
router.post('/:id/disable', requireAuth, requirePermission('users.disable'), ctrl.disableUser);
router.post('/:id/enable', requireAuth, requirePermission('users.enable'), ctrl.enableUser);

module.exports = router;
