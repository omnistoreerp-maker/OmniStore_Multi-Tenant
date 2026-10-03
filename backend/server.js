const path = require('path');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const compression = require('compression');
const session = require('express-session');
const passport = require('passport');
const swaggerUi = require('swagger-ui-express');
const config = require('./config');
const oauthConfig = require('./config/oauth');
const swaggerSpec = require('./config/swagger');
const logger = require('./utils/logger');
const fileStore = require('./utils/fileStore');
const { notFound, serverError, requestPerfLogger } = require('./middleware/errorHandler');
const { authMiddleware, requireAuth } = require('./middleware/auth');
const { scopedWriteRoleGuard } = require('./middleware/authorize');
const { sanitizeBody, jsonParseErrorHandler, apiRateLimiter } = require('./middleware/security');
const { validateResource } = require('./middleware/validate');
const { configurePassport } = require('./middleware/passport');
const { apiKeyMiddleware } = require('./middleware/apiKeyAuth');
const { correlationId, auditCapture } = require('./middleware/audit');
const { etagMiddleware } = require('./middleware/etag');
const requestContext = require('./middleware/requestContext');
const tenantStore = require('./middleware/tenantStore');
const branchStore = require('./middleware/branchStore');
const metricsMiddleware = require('./middleware/metrics');
const { eventBus } = require('./services/eventBus');
const webhookService = require('./services/webhook.service');
const notificationEngine = require('./services/notificationEngine.service');
const jobService = require('./services/job.service');
const schedulerService = require('./services/scheduler.service');

const app = express();

app.set('trust proxy', 'loopback');

// Global middleware. The default helmet CSP would block the frontend's
// inline scripts and CDN modules when the API process also serves the static
// app (single-process mode). The directives below mirror the project's own
// nginx.conf posture ('unsafe-inline' for the app's inline scripts/styles)
// plus the exact external hosts index.html loads. Everything else stays
// locked down (no eval, no frames, no objects).
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      // script-src-attr must NOT be pinned to 'none': the app is a legacy
      // single-file build with inline onclick handlers, and the project's own
      // nginx.conf already allows 'unsafe-inline'. Leaving the directive out
      // makes attribute handlers fall back to script-src ('unsafe-inline').
      // Monetag origins removed: the unsafe Multitag zone (288239) was taken
      // out of platform.html after its OnClick/Popunder runtime sub-zone
      // hijacked Platform→Adobe navigation (reproduced 6× on
      // production, 2026-09-28). The only sanctioned ad surface is the gated
      // inline OmniAdSlot; when the owner later approves a safe inline zone
      // with an official script origin, that exact origin is added back here.
      scriptSrc: ["'self'", "'unsafe-inline'", 'https://cdnjs.cloudflare.com', 'https://cdn.jsdelivr.net'],
      scriptSrcAttr: ["'self'", "'unsafe-inline'"], // overrides helmet's default 'none'
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'data:', 'https://fonts.gstatic.com'],
      imgSrc: ["'self'", 'data:', 'https://*.tiktokcdn.com', 'https://*.tiktokcdn-us.com'],
      connectSrc: ["'self'", 'https://api.github.com', 'https://cdn.jsdelivr.net'],
      frameSrc: ['https://www.tiktok.com'],
      objectSrc: ["'none'"]
    }
  }
}));
// CORS — fail-closed when no allowlist is configured.
// In production (AUTH_REQUIRED=true) an empty CORS_ORIGINS blocks all
// cross-origin browser requests. In dev/test with AUTH_REQUIRED=false the
// explicit localhost defaults below keep local development usable.
const _corsRaw = config.corsOrigins
  || (!config.authRequired ? 'http://localhost:3000,http://localhost:5173,http://localhost:57647' : '');
const _corsOrigins = _corsRaw.split(',').map(s => s.trim()).filter(Boolean);
app.use(cors({
  origin: _corsOrigins.length > 0 ? _corsOrigins : false,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id', 'X-Tenant-Id', 'X-Branch-Id'],
}));
app.use(compression());
// Request logging is development-only (no console.log in production);
// slow-request performance logging stays on in every environment.
if (config.env === 'development') app.use(morgan('dev'));
app.use(requestPerfLogger(config.slowRequestMs));
// express.json with a verify hook that captures the RAW request body for
// every parsed JSON request. The payments webhook (O2) signs the raw bytes,
// so it must verify the HMAC against exactly what the gateway sent — not a
// re-serialization of the parsed object. Main already carried an equivalent
// hook; this keeps the documented form from 518a9f5 without changing behavior.
app.use(express.json({
  limit: config.bodyLimit,
  verify(req, _res, buf) {
    // Only JSON requests reach this hook; keep the capture bounded by bodyLimit.
    req.rawBody = buf;
  }
}));
// Body parser for URL-encoded payloads (forms, older clients).
app.use(express.urlencoded({ extended: true, limit: config.bodyLimit }));
// Request correlation/context (traces, audit, tenant, branch) injected early.
app.use(requestContext.init());
// Audit capture middleware (requests, responses, timing).
app.use(auditCapture());
// ETag middleware (optimistic caching for GET, no-cache for mutations).
app.use(etagMiddleware());
// Tenant resolution middleware (reads X-Tenant-Id from request, falls back
// to config.tenantId in server-side contexts).
app.use(tenantStore.resolve());
// Branch resolution middleware (reads X-Branch-Id from request).
app.use(branchStore.resolve());
app.use(metricsMiddleware.measure());
// Passport init (sessions, strategies) — runs after body parsing so auth
// middleware can inspect parsed payload.
app.use(configurePassport());
// Public API routes (no auth required).
app.use('/api/v1/public', apiKeyMiddleware(), requireAuth(false), requireAuth(true));
// Private API routes (auth required) — mounted after public so explicit
// auth can be bypassed for legacy guests where needed.
app.use('/api/v1/private', authMiddleware(), requireAuth(true), requireAuth(false));
// Swagger UI.
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
  customCss: '.swagger-ui .topbar { display: none; }',
  customSiteTitle: 'OmniStore API Docs',
  operationsSorter: 'alpha',
  docExpansion: 'list'
}));
// Health check (unauthenticated, used by orchestrators).
app.use('/api/v1/health', (req, res) => {
  res.json({
    status: 'ok',
    version: config.version,
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});
// Error handlers (404, 500). Registered last.
app.use(notFound);
app.use(serverError);

module.exports = app;

// Start server (only when run directly, not when required as a module).
if (require.main === module) {
  const port = config.port || 3001;
  const host = config.host || '0.0.0.0';
  const server = app.listen(port, host, () => {
    logger.info(`OmniStore API listening on ${host}:${port}`);
    logger.info(`Environment: ${config.env || 'production'}`);
  });
  // Graceful shutdown.
  const shutdown = (signal) => {
    logger.info(`Received ${signal}, shutting down gracefully...`);
    server.close(() => {
      logger.info('Server closed.');
      process.exit(0);
    });
    setTimeout(() => {
      logger.warn('Forced shutdown after timeout.');
      process.exit(1);
    }, 10000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}
