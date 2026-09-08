const router = require('express').Router();
const ctrl = require('../controllers/employees.controller');
const { requirePermissionIfAuth } = require('../middleware/authorize');

/**
 * @openapi
 * /api/v1/employees:
 *   get:
 *     tags: [Employees]
 *     summary: List employees
 *     description: Returns paginated list of employees
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - name: search
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
 *         description: Employees retrieved
 *       401:
 *         description: Authentication required
 *   post:
 *     tags: [Employees]
 *     summary: Create employee
 *     description: Create a new employee
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/Employee'
 *     responses:
 *       201:
 *         description: Employee created
 *       400:
 *         description: Validation error
 *       401:
 *         description: Authentication required
 */
router.get('/', requirePermissionIfAuth('employees.view'), ctrl.list);
router.post('/', requirePermissionIfAuth('employees.create'), ctrl.create);

/**
 * @openapi
 * /api/v1/employees/stats:
 *   get:
 *     tags: [Employees]
 *     summary: Get employee statistics
 *     description: Returns employee count and distribution
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Statistics retrieved
 *       401:
 *         description: Authentication required
 */
router.get('/stats', requirePermissionIfAuth('employees.view'), ctrl.getStats);

/**
 * @openapi
 * /api/v1/employees/{id}:
 *   get:
 *     tags: [Employees]
 *     summary: Get employee by ID
 *     description: Returns a specific employee
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
 *         description: Employee retrieved
 *       404:
 *         description: Employee not found
 *   put:
 *     tags: [Employees]
 *     summary: Update employee
 *     description: Update an employee
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
 *             $ref: '#/components/schemas/Employee'
 *     responses:
 *       200:
 *         description: Employee updated
 *       404:
 *         description: Employee not found
 *   delete:
 *     tags: [Employees]
 *     summary: Delete employee
 *     description: Delete an employee
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
 *         description: Employee deleted
 *       404:
 *         description: Employee not found
 */
router.get('/:id', requirePermissionIfAuth('employees.view'), ctrl.getById);
router.put('/:id', requirePermissionIfAuth('employees.edit'), ctrl.update);
router.delete('/:id', requirePermissionIfAuth('employees.delete'), ctrl.remove);

module.exports = router;
