const logger = require('../utils/logger');
const { error: errorResponse } = require('../utils/apiResponse');
const errorTracker = require('../services/errorTracker.service');

const isProd = (process.env.NODE_ENV || 'development') === 'production';

function notFound(req, res, next) {
  errorResponse(res, `Route ${req.originalUrl} not found`, 404);
}

function serverError(err, req, res, next) {
  logger.error('Unhandled error:', err.message, err.stack);
  // Additive: persist a deduplicated error issue for the error tracker.
  try {
    errorTracker.capture(err, {
      route: req.originalUrl,
      method: req.method,
      userId: req.user ? req.user.id : null,
      level: 'error'
    });
  } catch (_) {
    // Never let error tracking itself break error handling.
  }
  // Never leak internals in production; full message only in development.
  errorResponse(res, isProd ? 'Internal Server Error' : (err.message || 'Internal Server Error'), 500);
}

// Request performance logging: logs slow requests (and all requests
// in development via morgan, which stays dev-only).
function requestPerfLogger(slowMs) {
  const threshold = slowMs || 1000;
  return function (req, res, next) {
    const start = process.hrtime.bigint();
    res.on('finish', () => {
      const ms = Number(process.hrtime.bigint() - start) / 1e6;
      if (ms >= threshold) {
        logger.perf(`${req.method} ${req.originalUrl} ${res.statusCode} ${ms.toFixed(1)}ms (slow)`);
      }
    });
    next();
  };
}

module.exports = { notFound, serverError, requestPerfLogger };
