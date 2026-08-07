const router = require('express').Router();
const health = require('../services/health.service');
const { success, error } = require('../utils/apiResponse');

/**
 * @openapi
 * /api/v1/health/deep:
 *   get:
 *     tags: [Health]
 *     summary: Deep health check
 *     description: |
 *       Runs component-level health checks across persistence, audit log,
 *       metrics, event bus, job system, and webhook store.
 *     responses:
 *       200:
 *         description: Health checks completed (status ok or degraded)
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
 *                     status:
 *                       type: string
 *                       enum: [ok, degraded]
 *                     checks:
 *                       type: object
 */
router.get('/', (req, res) => {
  const result = health.runAll();
  const code = result.status === 'ok' ? 200 : 503;
  if (result.status === 'ok') {
    return success(res, result, 'Deep health check passed');
  }
  return error(res, 'Deep health check degraded', code, result.checks);
});

/**
 * @openapi
 * /api/v1/health/deep/{component}:
 *   get:
 *     tags: [Health]
 *     summary: Single component health check
 *     parameters:
 *       - name: component
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *           enum: [persistence, audit, metrics, eventbus, jobs, webhooks]
 *     responses:
 *       200:
 *         description: Component healthy
 *       404:
 *         description: Unknown component
 */
router.get('/:component', (req, res) => {
  const result = health.runOne(req.params.component);
  if (!result) return error(res, `Unknown health component: ${req.params.component}`, 404);
  const code = result[req.params.component].status === 'error' ? 503 : 200;
  return success(res, result, 'Component check completed', code);
});

module.exports = router;