const router = require('express').Router();
const metrics = require('../services/metrics.service');
const { requireAuth } = require('../middleware/auth');
const { success, error } = require('../utils/apiResponse');

/**
 * @openapi
 * /api/v1/metrics:
 *   get:
 *     tags: [Metrics]
 *     summary: Get metrics in Prometheus text format
 *     description: Returns runtime metrics (counters, gauges, histograms) as Prometheus text
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Metrics in Prometheus text format
 *         content:
 *           text/plain:
 *             schema:
 *               type: string
 *       401:
 *         description: Authentication required
 */
router.get('/', requireAuth, (req, res) => {
  res.setHeader('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
  res.send(metrics.toPrometheus());
});

/**
 * @openapi
 * /api/v1/metrics/json:
 *   get:
 *     tags: [Metrics]
 *     summary: Get metrics as JSON
 *     description: Returns runtime metrics as structured JSON for dashboard consumption
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Metrics as JSON
 *       401:
 *         description: Authentication required
 */
router.get('/json', requireAuth, (req, res) => {
  return success(res, metrics.getMetrics(), 'Metrics retrieved');
});

module.exports = router;