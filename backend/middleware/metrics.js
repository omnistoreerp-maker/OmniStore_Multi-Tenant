const metrics = require('../services/metrics.service');

// Middleware: captures per-request counters and latency histograms.
// Excludes the metrics endpoints themselves to avoid self-reporting noise.
function metricsMiddleware(req, res, next) {
  if (req.path.startsWith('/api/v1/metrics')) return next();

  const start = process.hrtime.bigint();
  const method = req.method;
  const route = req.route ? req.route.path : req.path;

  res.on('finish', () => {
    const duration = Number(process.hrtime.bigint() - start) / 1e6;
    metrics.incrementCounter('http_requests_total', { method, status: String(res.statusCode) });
    metrics.observeHistogram('http_request_duration_ms', duration, { method });
    if (res.statusCode >= 400) {
      metrics.incrementCounter('http_errors_total', { method, status: String(res.statusCode) });
    }
  });

  next();
}

module.exports = metricsMiddleware;