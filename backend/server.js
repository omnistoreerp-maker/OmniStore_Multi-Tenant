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
const { writeRoleGuard } = require('./middleware/authorize');
const { sanitizeBody, jsonParseErrorHandler, apiRateLimiter } = require('./middleware/security');
const { validateResource } = require('./middleware/validate');
const { configurePassport } = require('./middleware/passport');
const { apiKeyMiddleware } = require('./middleware/apiKeyAuth');
const { correlationId, auditCapture } = require('./middleware/audit');
const { etagMiddleware } = require('./middleware/etag');
const requestContext = require('./middleware/requestContext');
const metricsMiddleware = require('./middleware/metrics');
const { eventBus } = require('./services/eventBus');
const webhookService = require('./services/webhook.service');
const jobService = require('./services/job.service');
const schedulerService = require('./services/scheduler.service');

const app = express();

// Global middleware
app.use(helmet());
if (config.corsOrigins) {
  // Restricted CORS: comma-separated allowlist via CORS_ORIGINS.
  app.use(cors({ origin: config.corsOrigins.split(',').map(s => s.trim()), credentials: true }));
} else {
  // Default: open CORS (identical to previous behavior).
  app.use(cors());
}
app.use(compression());
// Request logging is development-only (no console.log in production);
// slow-request performance logging stays on in every environment.
if (config.env === 'development') app.use(morgan('dev'));
app.use(requestPerfLogger(config.slowRequestMs));
app.use(express.json({ limit: config.bodyLimit }));
app.use(express.urlencoded({ extended: true }));
app.use(sanitizeBody);

// Request correlation ID (X-Request-Id) — applied to ALL requests
app.use(correlationId);

// Session middleware (required for OAuth)
if (oauthConfig.enabled) {
  app.use(session(oauthConfig.session));
  configurePassport();
  app.use(passport.initialize());
  app.use(passport.session());
}

app.use('/api/v1', apiRateLimiter(config.rateLimitMax));

// Request Context: creates an EMPTY per-request context behind a feature flag.
// No-op when ENABLE_REQUEST_CONTEXT is false (default) — zero behavior change.
if (config.requestContextEnabled) {
  app.use(requestContext);
}
app.use(authMiddleware);
app.use(apiKeyMiddleware);

// Phase 19 — Tenant Carry: reconstruct req.tenantContext from the tenant
// securely bound into the authenticated token (no-op when ENABLE_TENANT_CARRY
// is off, or when the user/request has no bound tenant).
const tenantCarry = require('./middleware/tenantCarry');
app.use(tenantCarry);

// Audit capture: records mutating operations (POST/PUT/DELETE) after response
app.use(auditCapture);

// Observability: request metrics (counters/latency) — enabled via config
if (config.metricsEnabled) {
  app.use(metricsMiddleware);
}

// API v1 routes
const apiRouter = require('./routes/index');
const salesRoutes = require('./routes/sales.routes');
const purchaseRoutes = require('./routes/purchase.routes');
const inventoryRoutes = require('./routes/inventory.routes');
const inventoryTransactionsRoutes = require('./routes/inventoryTransactions.routes');
const customersRoutes = require('./routes/customers.routes');
const suppliersRoutes = require('./routes/suppliers.routes');
const treasuryRoutes = require('./routes/treasury.routes');
const employeesRoutes = require('./routes/employees.routes');
const partnersRoutes = require('./routes/partners.routes');
const voucherRoutes = require('./routes/voucher.routes');
const dashboardRoutes = require('./routes/dashboard.routes');
const reportsRoutes = require('./routes/reports.routes');
const usersRoutes = require('./routes/users.routes');
const authRoutes = require('./routes/auth.routes');
const oauthRoutes = require('./routes/oauth.routes');
const mfaRoutes = require('./routes/mfa.routes');
const apiKeyRoutes = require('./routes/apiKey.routes');
const auditRoutes = require('./routes/audit.routes');
const webhookRoutes = require('./routes/webhook.routes');
const metricsRoutes = require('./routes/metrics.routes');
const healthRoutes = require('./routes/health.routes');
const errorTrackerRoutes = require('./routes/errorTracker.routes');
const companyRoutes = require('./routes/company.routes');
const companyContext = require('./middleware/companyContext');

app.use('/api/v1', apiRouter);
app.use('/api/v1/companies', companyRoutes);
// Company selection is applied BEFORE authentication so the chosen company is
// resolved into RequestContext/TenantContext on the login POST (no-op unless
// ENABLE_MULTI_COMPANY_LOGIN, so the auth flow is unchanged by default).
app.use('/api/v1/auth', companyContext, authRoutes);
app.use('/api/v1/auth/mfa', mfaRoutes);
app.use('/api/v1/api-keys', apiKeyRoutes);
app.use('/api/v1/audit-log', auditRoutes);
app.use('/api/v1/webhooks', webhookRoutes);
app.use('/api/v1/metrics', metricsRoutes);
app.use('/api/v1/health/deep', healthRoutes);
app.use('/api/v1/errors', errorTrackerRoutes);

// Route events from the bus to outbound webhooks (additive; no-op if none)
eventBus.subscribe('sale.created', (ev) => webhookService.dispatch('sale.created', ev.data));
eventBus.subscribe('sale.updated', (ev) => webhookService.dispatch('sale.updated', ev.data));
eventBus.subscribe('sale.deleted', (ev) => webhookService.dispatch('sale.deleted', ev.data));
eventBus.subscribe('inventory.updated', (ev) => webhookService.dispatch('inventory.updated', ev.data));
eventBus.subscribe('inventory.low', (ev) => webhookService.dispatch('inventory.low', ev.data));

// OAuth routes (mounted at root for OAuth callbacks)
if (oauthConfig.enabled) {
  app.use('/auth', oauthRoutes);
}

// Swagger API documentation
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
  customCss: '.swagger-ui .topbar { display: none }',
  customSiteTitle: 'DigiTronics V2 API Documentation'
}));

// JSON endpoint for the raw OpenAPI spec
app.get('/api-docs.json', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.send(swaggerSpec);
});

// Optional route protection (AUTH_REQUIRED=true).
// Default is OFF: every route stays open exactly as before (legacy behavior).
if (config.authRequired) {
  app.use('/api/v1', requireAuth);
  app.use('/api/v1', writeRoleGuard('Owner', 'Admin', 'Manager'));
}

// Conditional requests: ETag on GET responses (behavior: no-op if disabled)
if (config.etagEnabled) {
  app.use(etagMiddleware);
}

app.use('/api/v1/sales', validateResource('sales'), salesRoutes);
app.use('/api/v1/purchases', validateResource('purchases'), purchaseRoutes);
app.use('/api/v1/inventory', validateResource('inventory'), inventoryRoutes);
app.use('/api/v1/inventory-transactions', validateResource('inventory-transactions'), inventoryTransactionsRoutes);
app.use('/api/v1/customers', validateResource('customers'), customersRoutes);
app.use('/api/v1/suppliers', validateResource('suppliers'), suppliersRoutes);
app.use('/api/v1/treasury', validateResource('treasury'), treasuryRoutes);
app.use('/api/v1/employees', validateResource('employees'), employeesRoutes);
app.use('/api/v1/partners', validateResource('partners'), partnersRoutes);
app.use('/api/v1/vouchers', validateResource('vouchers'), voucherRoutes);
app.use('/api/v1/dashboard', validateResource('dashboard'), dashboardRoutes);
app.use('/api/v1/reports', validateResource('reports'), reportsRoutes);
app.use('/api/v1/users', validateResource('users'), usersRoutes);

// Error handling
app.use(notFound);
app.use(jsonParseErrorHandler);
app.use(serverError);

// Graceful shutdown: stop accepting connections, flush persistence, close
// the logger, then exit. Writes are synchronous write-through, so there
// is never pending data; flushAll is the stable hook regardless.
function gracefulShutdown(server, exitCode) {
  logger.info('Shutdown signal received — closing gracefully');
  // Stop background workers so no timers keep the process alive.
  try { schedulerService.stop(); } catch (_) {}
  try { jobService.stopWorker(); } catch (_) {}
  // finish must run exactly once: the server.close callback and the
  // 3s fallback timer can both fire, and process.exit is not idempotent.
  let finished = false;
  let fallbackTimer = null;
  const finish = () => {
    if (finished) return;
    finished = true;
    if (fallbackTimer) clearTimeout(fallbackTimer);
    try { fileStore.flushAll(); } catch (_) {}
    logger.close();
    process.exit(exitCode || 0);
  };
  if (server && server.close) {
    server.close(() => finish());
    // Never hang on keep-alive connections.
    fallbackTimer = setTimeout(finish, 3000);
    if (fallbackTimer.unref) fallbackTimer.unref();
  } else {
    finish();
  }
}

// Start server only when run directly (`node server.js`). When the app is
// required as a module (tests), the caller controls listening and these
// process-level handlers stay out of the host process.
if (require.main === module) {
  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled promise rejection:', reason && reason.message ? reason.message : reason);
  });
  process.on('uncaughtException', (err) => {
    logger.error('Uncaught exception:', err.message, err.stack);
    process.exit(1);
  });

  // Start background job worker and scheduler (recoverable, in-process).
  jobService.startWorker({ concurrency: 1 });
  schedulerService.start();

  const server = app.listen(config.port, () => {
    if (config.isProduction && config.jwtSecret === 'dev-secret') {
      logger.warn('JWT_SECRET is not set — using the development default. Set JWT_SECRET in production.');
    }
    logger.info(`DigiTronics API v1.0 running on port ${config.port}`);
    logger.info(`Health check: http://localhost:${config.port}/api/v1/health`);
  });

  process.on('SIGINT', () => gracefulShutdown(server, 0));
  process.on('SIGTERM', () => gracefulShutdown(server, 0));
}

module.exports = app;
module.exports.gracefulShutdown = gracefulShutdown;
