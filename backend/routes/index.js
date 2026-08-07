const fs = require('fs');
const router = require('express').Router();
const { success, error } = require('../utils/apiResponse');
const fileStore = require('../utils/fileStore');

const startedAt = Date.now();

/**
 * @openapi
 * /api/v1/health:
 *   get:
 *     tags: [Health]
 *     summary: Health check
 *     description: Returns service health status
 *     responses:
 *       200:
 *         description: Service is healthy
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/HealthResponse'
 */
router.get('/health', (req, res) => {
  success(res, {
    version: '1.0',
    status: 'ok',
    uptimeSeconds: Math.round((Date.now() - startedAt) / 1000)
  }, 'Service is healthy');
});

/**
 * @openapi
 * /api/v1/liveness:
 *   get:
 *     tags: [Health]
 *     summary: Liveness probe
 *     description: Returns process liveness status
 *     responses:
 *       200:
 *         description: Process is alive
 */
router.get('/liveness', (req, res) => {
  const mem = process.memoryUsage();
  success(res, {
    status: 'alive',
    uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
    pid: process.pid,
    node: process.version,
    memory: {
      rssMb: Math.round(mem.rss / 1024 / 1024 * 10) / 10,
      heapUsedMb: Math.round(mem.heapUsed / 1024 / 1024 * 10) / 10
    }
  }, 'Process is alive');
});

/**
 * @openapi
 * /api/v1/ready:
 *   get:
 *     tags: [Health]
 *     summary: Readiness probe
 *     description: Returns service readiness status
 *     responses:
 *       200:
 *         description: Service is ready
 *       503:
 *         description: Service is not ready
 */
router.get('/ready', (req, res) => {
  try {
    fileStore._ensureDir();
    const probe = fileStore._path('.readiness-probe');
    fs.writeFileSync(probe, 'ok', 'utf-8');
    fs.unlinkSync(probe);
    success(res, { status: 'ready', persistence: 'writable' }, 'Service is ready');
  } catch (err) {
    error(res, 'Service is not ready: persistence check failed', 503);
  }
});

module.exports = router;
