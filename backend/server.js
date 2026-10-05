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
const { attachTeacherActor } = require('./middleware/teacherActor');
const { attachCenterActor } = require('./middleware/centerActor');
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
/**
 * The online-games player frame's origin — OWNER CONFIGURATION, never guessed.
 *
 * Set GAMES_ORIGIN to the bare origin that serves online-games/runtime
 * (https://games.example.com) and it is appended to frame-src. Empty is the
 * default, and empty leaves the directive exactly as it has always been —
 * TikTok only — so deploying this section's static surface without a games
 * origin changes nothing rather than breaking the header.
 *
 * A malformed value is dropped instead of passed through. A source expression
 * with a path or a credential is not "mostly right": the browser denies it
 * outright and the failure surfaces as a game that will not open, which sends
 * somebody hunting in the wrong layer entirely.
 *
 * Must mirror nginx.conf's `$omnistore_games_origin` map — same input, same
 * rule, two places because nginx cannot read an environment variable in a
 * header and Node cannot read a nginx map.
 */
const GAMES_ORIGIN = (() => {
  const raw = String(process.env.GAMES_ORIGIN || '').trim();
  if (!raw) return null;
  let url;
  try { url = new URL(raw); } catch { return null; }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (url.username || url.password || url.search || url.hash) return null;
  if (url.pathname !== '/') return null;
  if (url.origin !== raw.replace(/\/$/, '')) return null;
  return url.origin;
})();

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      // script-src-attr must NOT be pinned to 'none': the app is a legacy
      // single-file build with inline onclick handlers, and the project's own
      // nginx.conf already allows 'unsafe-inline'. Leaving the directive out
      // makes attribute handlers fall back to script-src ('unsafe-inline').
      scriptSrc: ["'self'", "'unsafe-inline'", 'https://cdnjs.cloudflare.com', 'https://cdn.jsdelivr.net', 'https://quge5.com', 'https://auqot.com', 'https://ekhay.com', 'https://b3mny.com'],
      scriptSrcAttr: ["'self'", "'unsafe-inline'"], // overrides helmet's default 'none'
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'data:', 'https://fonts.gstatic.com'],
      // TikTok cover/thumbnail images. The Display API returns cover_image_url on
      // TikTok's CDN (documented example: https://p16-sign.tiktokcdn-us.com/...).
      // TikTok rotates the "pNN-sign" subdomain per region, so the allowlist is
      // pinned to the two TikTok-owned CDN registrable domains rather than a
      // specific host. This is a scoped subdomain match on TikTok-owned domains,
      // NOT a `*` wildcard, and it does not permit any other external image host.
      // tiktokDisplayApi.service also validates the host server-side before the
      // URL ever reaches a browser, so this allowlist is sufficient by design.
      imgSrc: ["'self'", 'data:', 'https://*.tiktokcdn.com', 'https://*.tiktokcdn-us.com'],
      connectSrc: ["'self'", 'https://api.github.com', 'https://cdn.jsdelivr.net', 'https://6opo.com', 'https://auqot.com', 'https://my.rtmark.net', 'https://jmosl.com', 'https://094kk.com'],
      // TikTok embedded playback: the official Embed Player is served from
      // https://www.tiktok.com/player/v1/<video_id> and is built in reels.html
      // from the numeric post id alone. The second entry is the online-games
      // player frame and is null unless GAMES_ORIGIN is configured — see the
      // block above — in which case filter(Boolean) removes it and the
      // directive is TikTok-only exactly as it was before. 'self' is
      // deliberately NOT re-added: same-origin frames stay blocked, and the
      // games are cross-origin by design so they cannot touch this origin's
      // cookies, storage or tenant data.
      frameSrc: ['https://www.tiktok.com', GAMES_ORIGIN].filter(Boolean),
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
// Request-scoped tenant context (AsyncLocalStorage): opens a fresh, empty
// tenant slot for every request so tenantCarry / companyContext / repositories
// read THEIR OWN request's tenant — safe even once async handlers are
// introduced (see middleware/tenantStore.js). Must run before tenantCarry.
app.use(tenantStore.middleware);
app.use(authMiddleware);
// Branch scope (Phase F): resolves the TRUSTED branchId for the authenticated
// user into an ALS slot for this request. No-op unless ENABLE_BRANCH_ISOLATION
// is on. Must run after authMiddleware (needs req.user).
app.use(branchStore.middleware);
app.use(apiKeyMiddleware);

// Phase 19 — Tenant Carry: reconstruct req.tenantContext from the tenant
// securely bound into the authenticated token (no-op when ENABLE_TENANT_CARRY
// is off, or when the user/request has no bound tenant).
const tenantCarry = require('./middleware/tenantCarry');
app.use(tenantCarry);

// Custom Domain Resolution (O3): resolve tenant from registered custom domains
// AFTER auth so JWT-bound tenants take precedence. No-op when
// ENABLE_CUSTOM_DOMAIN_RESOLUTION is off. Restored from the verified RC
// wiring that was dropped during the main integration.
const customDomainResolver = require('./middleware/customDomainResolver');
app.use(customDomainResolver);

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
const updateRoutes = require('./routes/update.routes');
const platformRoutes = require('./routes/platform.routes');
const platformPublicRoutes = require('./routes/platformPublic.routes');
const tiktokPublicRoutes = require('./routes/tiktokPublic.routes');
const reelsRoutes = require('./routes/reels.routes');
const companyProfileRoutes = require('./routes/companyProfile.routes');
const customerRequestRoutes = require('./routes/customerRequest.routes');
const internalChangeCenterRoutes = require('./routes/internalChangeCenter.routes');
const platformIntegrationRoutes = require('./routes/platformIntegration.routes');
const platformAdminRoutes = require('./routes/platformAdmin.routes');
const platformControlCenterRoutes = require('./routes/platformControlCenter.routes');
const tenantExtensionsRoutes = require('./routes/tenantExtensions.routes');
const tenantOnboardingRoutes = require('./routes/tenantOnboarding.routes');
const tenantPaymentsRoutes = require('./routes/tenantPayments.routes');
const tenantNotificationsRoutes = require('./routes/tenantNotifications.routes');
const studentServicesPackRoutes = require('./routes/studentServicesPack.routes');
// Education module (Device 2), STU-1 to STU-10 plus the P2 booking and
// rating surfaces. Thirteen routers on one additive prefix that no other
// router claims; every one declares only literal paths, so no Education router
// can shadow another or be shadowed.
const educationPackRoutes = require('./routes/educationPack.routes');
const studentRoutes = require('./routes/student.routes');
const teacherRoutes = require('./routes/teacher.routes');
const centerRoutes = require('./routes/center.routes');
const programRoutes = require('./routes/program.routes');
const courseRoutes = require('./routes/course.routes');
const classRoutes = require('./routes/class.routes');
const enrollmentRoutes = require('./routes/enrollment.routes');
const attendanceRoutes = require('./routes/attendance.routes');
const schedulingRoutes = require('./routes/scheduling.routes');
const gradingRoutes = require('./routes/grading.routes');
const bookingRoutes = require('./routes/booking.routes');
const ratingRoutes = require('./routes/rating.routes');
const academicYearRoutes = require('./routes/academicYear.routes');
const termRoutes = require('./routes/term.routes');
const subjectRoutes = require('./routes/subject.routes');
const groupRoutes = require('./routes/group.routes');
const shiftManagementRoutes = require('./routes/shiftManagement.routes');
const onlineStoreRoutes = require('./routes/onlineStore.routes');
const loyaltyRoutes = require('./routes/loyalty.routes');
const marketRoutes = require('./routes/market.routes');
const gameHostingRoutes = require('./routes/gameHosting.routes');
const playstationRoutes = require('./routes/playstation.routes');
const companyContext = require('./middleware/companyContext');
// Phase 33 — seed the server-authoritative platform admin store from
// PLATFORM_ADMINS on boot (no-op once the store has entries).
require('./services/platformAdmin.service').ensureSeeded();
// Market (Phase F) — seed the default tenant Market config so the storefront
// works out of the box. No-op once the config exists.
require('./services/marketConfig.service').ensureSeeded();

app.use('/api/v1', apiRouter);
app.use('/api/v1/companies', companyRoutes);
app.use('/api/v1/update', updateRoutes);
// Phase 33 — Master Control Center. Mounted before the optional AUTH_REQUIRED
// guard so platform scope is enforced exclusively by requirePlatformAdmin.
app.use('/api/v1/platform', platformRoutes);
// Platform Control Center — role-aware internal console (dashboard, team,
// diagnostics, content catalog). Every route is server-authorized by the
// granular platform permission middleware; authorization is never taken from
// query/body/headers. Separate from every tenant scope.
app.use('/api/v1/platform/control-center', platformControlCenterRoutes);
// Tenant Onboarding Wizard — guided setup + one-click demo data.
app.use('/api/v1/tenant/onboarding', tenantOnboardingRoutes);
// Public platform homepage — read-only catalog, no auth required.
app.use('/api/v1/platform-public', platformPublicRoutes);
// Reels feed lives in its own router so platformPublic.routes.js stays
// untouched (visitor-counter boundary). Mounted after the public platform
// router: non-/reels paths fall through exactly as before.
app.use('/api/v1/platform-public/reels', reelsRoutes);
// TikTok Display API surface — own router so platformPublic.routes.js keeps
// its zero-reels boundary and the tenant reels route can never be shadowed.
// Namespaced under /tiktok/* (see routes/tiktokPublic.routes.js).
app.use('/api/v1/platform-public', tiktokPublicRoutes);
// Public company profile — read-only profile data, no auth required.
app.use('/api/v1/companies-public', companyProfileRoutes);
// Customer Change & Resolution Foundation — authenticated, company-scoped.
app.use('/api/v1/customer', customerRequestRoutes);
// Internal Change Center & Release Management — platform-admin-only.
app.use('/api/v1/internal', internalChangeCenterRoutes);
// ERP ↔ Platform Integration Contract — read-only public boundary.
app.use('/api/v1/platform-integration', platformIntegrationRoutes);
// Phase F — OmniStore Market (customer-facing storefront). Public catalog,
// customer auth, cart/checkout, and order tracking. Mounted under /api/v1/market.
// Self-contained module; does not alter Core ERP routes.
app.use('/api/v1/market', marketRoutes);
// Platform Admin Management APIs — add-ons, transaction fees, custom domains.
// Enforced exclusively by requireAuth + requirePlatformAdmin (platform scope is
// separate from every tenant scope). Restored from the verified RC wiring that
// was dropped during the main integration.
app.use('/api/v1/platform/admin', platformAdminRoutes);
// Tenant Extensions — tenant-scoped add-ons and custom domain management.
// Tenant id comes only from the trusted server-side context, never the body.
app.use('/api/v1/tenant', tenantExtensionsRoutes);
// Tenant Notifications — Telegram/WhatsApp settings + test connection.
app.use('/api/v1/tenant/notifications', tenantNotificationsRoutes);
// Tenant Payments — tenant-scoped add-on purchase intents, status and list,
// plus the gateway webhook which is HMAC-verified (fail-closed without secret).
app.use('/api/v1/payments', tenantPaymentsRoutes);
// Phase B — Game Hosting. Self-contained module; does not alter Core ERP routes.
// Provider integration is BLOCKED; lifecycle state machine and ownership are enforced.
app.use('/api/v1/game-hosting', gameHostingRoutes);
// Storefront mount: the market API client is hard-wired to BASE=/api/v1/market,
// so the SAME router is also mounted under the market prefix. Routes are
// relative; there is no overlap with marketRoutes (market has no
// /game-hosting/* handlers). Both mounts share the same controllers,
// tenant middleware and services — one implementation, two paths.
app.use('/api/v1/market/game-hosting', gameHostingRoutes);
// Batch 1 — PlayStation Device & Session Foundation. Self-contained module;
// does not alter Core ERP routes. Provider integration is BLOCKED.
app.use('/api/v1/playstation', playstationRoutes);
// resolved into RequestContext/TenantContext on the login POST (no-op unless
// ENABLE_MULTI_COMPANY_LOGIN, so the auth flow is unchanged by default).
app.use('/api/v1/auth', companyContext, authRoutes);
app.use('/api/v1/auth/mfa', mfaRoutes);
app.use('/api/v1/api-keys', apiKeyRoutes);
app.use('/api/v1/audit-log', auditRoutes);
app.use('/api/v1/webhooks', webhookRoutes);
app.use('/api/v1/metrics', metricsRoutes);
// v1.0.1 — AUTH-CONDITIONAL PROTECTED UTILITIES.
// Default (AUTH_REQUIRED=false) keeps the historical open behavior; when the
// hardened posture is on, these surfaces demand an authenticated session.
const authGate = config.authRequired ? requireAuth : (req, res, next) => next();

app.use('/api/v1/health/deep', authGate, healthRoutes);
app.use('/api/v1/errors', errorTrackerRoutes);

// Route events from the bus to outbound webhooks (additive; no-op if none).
// Tenant context is extracted from the event payload and forwarded to
// dispatch() so tenant-scoped webhooks receive only their own events.
eventBus.subscribe('sale.created', (ev) => webhookService.dispatch('sale.created', ev.data, ev.data && ev.data.tenantId));
eventBus.subscribe('sale.updated', (ev) => webhookService.dispatch('sale.updated', ev.data, ev.data && ev.data.tenantId));
eventBus.subscribe('sale.deleted', (ev) => webhookService.dispatch('sale.deleted', ev.data, ev.data && ev.data.tenantId));
eventBus.subscribe('inventory.updated', (ev) => webhookService.dispatch('inventory.updated', ev.data, ev.data && ev.data.tenantId));
eventBus.subscribe('inventory.low', (ev) => webhookService.dispatch('inventory.low', ev.data, ev.data && ev.data.tenantId));

// Route tenant events to the per-tenant Telegram/WhatsApp notification
// engine (sale alerts, low-stock alerts, subscription alerts). Restored
// from the verified RC build where server.js called
// notificationEngine.bootstrapEventListeners(); the wiring was lost when
// main was reconstructed, silently disabling every outbound notification.
notificationEngine.bootstrapEventListeners();

// OAuth routes (mounted at root for OAuth callbacks)
if (oauthConfig.enabled) {
  app.use('/auth', oauthRoutes);
}

// Swagger API documentation (auth-gated when AUTH_REQUIRED=true)
app.use('/api-docs', authGate, swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
  customCss: '.swagger-ui .topbar { display: none }',
  customSiteTitle: 'DigiTronics V2 API Documentation'
}));

// JSON endpoint for the raw OpenAPI spec (auth-gated when AUTH_REQUIRED=true)
app.get('/api-docs.json', authGate, (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.send(swaggerSpec);
});

// P2 Teacher portal — resolve the linked-teacher identity (if any) for every
// Education request BEFORE authentication and the global write gate, so the
// gate and every ownership rule downstream see the same actor. It never
// rejects: `req.teacherActor` is the resolved teacher record or null (no
// signed-in user, no trusted tenant, no link). Mounted outside the
// AUTH_REQUIRED block on purpose — the controllers must scope a linked
// teacher's writes even in legacy open mode, and for anonymous traffic the
// resolution is a no-op.
app.use('/api/v1/tenant/education', attachTeacherActor);

// P0 Center isolation — resolve the linked-center identity (if any) for every
// Education request at the same mount point and with the same contract as the
// teacher actor above: `req.centerActor` is the resolved center record or null
// (no signed-in user, no trusted tenant, no link), never a rejection. Center
// scoping only ever NARROWS what the permission gate already allowed: there is
// deliberately no center bypass in scopedWriteRoleGuard (least privilege).
app.use('/api/v1/tenant/education', attachCenterActor);

// Optional route protection (AUTH_REQUIRED=true).
// Default is OFF: every route stays open exactly as before (legacy behavior).
if (config.authRequired) {
  app.use('/api/v1', requireAuth);
  app.use('/api/v1', scopedWriteRoleGuard('Owner', 'Admin', 'Manager'));
  // Branch isolation enforcement (no-op unless ENABLE_BRANCH_ISOLATION).
  app.use('/api/v1', branchStore.branchScope);
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
app.use('/api/v1/loyalty', validateResource('loyalty'), loyaltyRoutes);
app.use('/api/v1/tenant/student-services', studentServicesPackRoutes);
// Education module. Additive and live: the 26 education.* permissions are
// registered in backend/permissions/registry.js and the section is published in
// the Platform catalog, navigation and section lockdown policy. Access is still
// enforced per route by requirePermission, so mounting here grants nothing on
// its own — an operator without an education.* grant gets 403 from the route.
// P2 Teacher portal — attachTeacherActor is mounted EARLIER (just above the
// auth block) so the resolved teacher identity exists before requireAuth and
// the global write gate read it; see middleware/teacherActor.js.
app.use('/api/v1/tenant/education', educationPackRoutes);
app.use('/api/v1/tenant/education', studentRoutes);
app.use('/api/v1/tenant/education', teacherRoutes);
app.use('/api/v1/tenant/education', centerRoutes);
app.use('/api/v1/tenant/education', programRoutes);
app.use('/api/v1/tenant/education', courseRoutes);
app.use('/api/v1/tenant/education', classRoutes);
app.use('/api/v1/tenant/education', enrollmentRoutes);
app.use('/api/v1/tenant/education', attendanceRoutes);
app.use('/api/v1/tenant/education', schedulingRoutes);
app.use('/api/v1/tenant/education', gradingRoutes);
app.use('/api/v1/tenant/education', bookingRoutes);
app.use('/api/v1/tenant/education', ratingRoutes);
app.use('/api/v1/tenant/education', academicYearRoutes);
app.use('/api/v1/tenant/education', termRoutes);
app.use('/api/v1/tenant/education', subjectRoutes);
app.use('/api/v1/tenant/education', groupRoutes);
app.use('/api/v1/tenant/shifts', shiftManagementRoutes);
app.use('/api/v1/tenant/online-store', onlineStoreRoutes);

app.get('/store/:slug', (req, res) => {
  res.sendFile(path.join(FRONTEND_ROOT, 'store.html'));
});

// ===== Static frontend (single-process production serving) =====
// The frontend is a plain static tree at the repository root (index.html,
// services/, plugins/, icons/, manifest.json, sw.js). Serving it from the
// API process makes ONE command run the entire application:
//   npm start   (repo root)  ->  node backend/server.js
// This mount runs last, so /api/* and /api-docs keep priority. Only the
// frontend-visible tree is exposed: backend internals, dotfiles, VCS
// metadata and runtime stores are denied outright (never served).
const FRONTEND_ROOT = path.resolve(__dirname, '..');
const PRIVATE_PREFIXES = [
  'backend', '.git', '.github', '.freebuff', '.vercel', '.vscode',
  'node_modules', 'releases', 'release', 'backups', 'archive', 'database',
  'deploy', 'docs', 'documentation', 'tests', 'test-results',
  'customerrollout', 'supabase', 'coverage', 'dist', 'build',
  // Root-level manifests/dotfiles are server internals, never frontend assets.
  '.env', 'package.json', 'package-lock.json'
];
// Scratch/dev files at the repo root that must never be served.
const PRIVATE_FILE_PATTERNS = ['diffnames.txt', 'diffstat.txt', 'PHASE72_DISCOVERY.txt', '.bak', '.log', '.tmp'];
// Deny EVERY path whose decoded+normalized form lands in the private tree,
// and run this BEFORE express.static. The guard used to inspect only the raw
// first path segment, so plain (/x/../backend/server.js), dot-segment
// (/./backend/server.js) and percent-encoded (/foo%2f..%2fbackend%2fserver.js)
// traversals passed the check and were served by static path resolution.
// Resolution order here mirrors serve-static: decode once, collapse '.'/'..',
// then evaluate the private prefixes, private file patterns and — as defence
// in depth — require the resolved target to stay inside the frontend root.
//
// The prefix test is deliberately scoped to the FIRST segment, because these
// names are root-level directories. Matching any later segment would collide
// with legitimate nested application routes whose own path segment happens to
// be one of them (e.g. /api/v1/tenant/education/attendance/:id/archive, whose
// 'archive' is a route action, not the root archive/ directory).
function frontendPrivateGuard(req, res, next) {
  let decoded;
  try {
    decoded = decodeURIComponent(req.path || '/');
  } catch (e) {
    // Malformed percent-encoding: fail closed rather than guess.
    return res.status(403).end();
  }
  const normalized = path.posix.normalize(decoded.replace(/\\/g, '/'));
  if (!normalized.startsWith('/')) return res.status(403).end();
  const rel = normalized.replace(/^\/+/, '');
  const segments = rel.split('/').filter((s) => s !== '' && s !== '.');
  // A surviving '..' would escape the frontend root — never serve it.
  if (segments.some((s) => s === '..')) return res.status(403).end();
  const first = (segments[0] || '').toLowerCase();
  if (first && PRIVATE_PREFIXES.includes(first)) {
    return res.status(403).end();
  }
  const lower = rel.toLowerCase();
  if (PRIVATE_FILE_PATTERNS.some((p) => lower.includes(p.toLowerCase()))) {
    return res.status(403).end();
  }
  const target = path.resolve(FRONTEND_ROOT, rel);
  if (target !== FRONTEND_ROOT && !target.startsWith(FRONTEND_ROOT + path.sep)) {
    return res.status(403).end();
  }
  next();
}
function platformHomeIndex(req, res, next) {
  if (req.path === '/') req.url = '/platform.html';
  next();
}
app.use('/', frontendPrivateGuard, platformHomeIndex, express.static(FRONTEND_ROOT, {
  dotfiles: 'deny',
  index: 'index.html',
  fallthrough: true
}));

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

  // Phase 37 — production startup safety: refuse to boot with the weak
  // development JWT secret, and loudly warn about disabled auth / open CORS
  // (both are legitimately used during bootstrap / same-origin installs).
  const prodChecks = config.validateProductionConfig();
  if (prodChecks.fatal.length > 0) {
    logger.error('Refusing to start: unsafe production configuration.');
    prodChecks.fatal.forEach(msg => logger.error('  - ' + msg));
    process.exit(1);
  }
  prodChecks.warnings.forEach(msg => logger.warn('Production warning: ' + msg));

  // Start background job worker and scheduler (recoverable, in-process).
  jobService.startWorker({ concurrency: 1 });
  schedulerService.start();

  const server = app.listen(config.port, () => {
    logger.info(`DigiTronics API v1.0 running on port ${config.port}`);
    logger.info(`Health check: http://localhost:${config.port}/api/v1/health`);
  });

  process.on('SIGINT', () => gracefulShutdown(server, 0));
  process.on('SIGTERM', () => gracefulShutdown(server, 0));
}

module.exports = app;
module.exports.gracefulShutdown = gracefulShutdown;
