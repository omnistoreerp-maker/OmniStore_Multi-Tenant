const dotenv = require('dotenv');
const path = require('path');
dotenv.config();

const env = process.env.NODE_ENV || 'development';

// Universal Google Login challenge TTL — the ONE authoritative value for
// both the signed JWT expiration and the SQLite row expiration, so the two
// can never drift apart (P6.66 L-3). Accepts an ms-style duration string
// ("5m", "90s", "1h") exactly like jsonwebtoken does.
const _DURATION_UNITS_MS = {
  ms: 1, s: 1000, m: 60000, h: 3600000, d: 86400000, w: 604800000, y: 31557600000
};

function durationToMs(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const text = String(value == null ? "" : value).trim().toLowerCase();
  if (!text) return null;
  let index = 0;
  while (index < text.length && (text[index] === "." || (text[index] >= "0" && text[index] <= "9"))) index++;
  if (index === 0) return null;
  const amount = Number(text.slice(0, index));
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const unit = text.slice(index) || "ms";
  if (!Object.prototype.hasOwnProperty.call(_DURATION_UNITS_MS, unit)) return null;
  return Math.round(amount * _DURATION_UNITS_MS[unit]);
}

const loginChallengeTtl = process.env.LOGIN_CHALLENGE_TTL || "5m";
const loginChallengeTtlMs = durationToMs(loginChallengeTtl);
if (!loginChallengeTtlMs || loginChallengeTtlMs <= 0) {
  throw new Error(`LOGIN_CHALLENGE_TTL is not a valid duration: ${loginChallengeTtl}`);
}

module.exports = {
  env,
  isProduction: env === 'production',
  port: parseInt(process.env.PORT, 10) || 3001,

  // Authoritative application version (single source of truth — read from the
  // backend package.json). Used by the in-app update rail.
  appVersion: require('../package.json').version,

  // In-app update rail (Phase C).
  update: {
    enabled: process.env.UPDATE_ENABLED !== 'false',
    manifestPath: process.env.UPDATE_MANIFEST_PATH || path.join(__dirname, '..', 'data', 'updateManifest.json'),
    checkIntervalMs: parseInt(process.env.UPDATE_CHECK_INTERVAL_MS, 10) || 21600000, // 6h default
    appRoot: path.resolve(__dirname, '..', '..')
  },

  // Authentication / JWT
  jwtSecret: process.env.JWT_SECRET || 'dev-secret',
  jwtRefreshSecret: process.env.JWT_REFRESH_SECRET || (process.env.JWT_SECRET || 'dev-secret') + ':refresh',
  jwtAccessTtl: process.env.JWT_ACCESS_TTL || '15m',
  jwtRefreshTtl: process.env.JWT_REFRESH_TTL || '7d',
  loginChallengeTtl,
  loginChallengeTtlMs,
  authRequired: process.env.AUTH_REQUIRED === 'true',

  // API security
  corsOrigins: process.env.CORS_ORIGINS || '',
  rateLimitMax: parseInt(process.env.RATE_LIMIT_MAX, 10) || 1000,

  // Tenant payments gateway webhook (O2). When PAYMENTS_WEBHOOK_SECRET is
  // configured, POST /api/v1/payments/webhook is only accepted with a valid
  // hex HMAC-SHA256 signature of the RAW request body in the
  // x-payments-signature header. When it is NOT configured the webhook is
  // disabled entirely (403) — an unsigned payment webhook must never be able
  // to flip a transaction to paid and activate add-ons.
  paymentsWebhookSecret: process.env.PAYMENTS_WEBHOOK_SECRET || '',
  apiKeyRateLimitMax: parseInt(process.env.API_KEY_RATE_LIMIT_MAX, 10) || 500,
  bodyLimit: process.env.BODY_LIMIT || '10mb',

  // Password policy (Phase D). Every flag defaults to false so the minimum
  // length is the only rule enforced out of the box; legacy credentials and
  // existing test data are unaffected unless a site explicitly opts in.
  passwordPolicy: {
    minLength: parseInt(process.env.PASSWORD_POLICY_MIN_LENGTH, 10) || 8,
    uppercase: process.env.PASSWORD_POLICY_UPPERCASE === 'true',
    lowercase: process.env.PASSWORD_POLICY_LOWERCASE === 'true',
    number: process.env.PASSWORD_POLICY_NUMBER === 'true',
    special: process.env.PASSWORD_POLICY_SPECIAL === 'true'
  },

  // Platform / Master Control Center (Phase 33).
  // PLATFORM_ADMINS: comma-separated usernames granted MASTER_OWNER at first
  // boot of the platform store (server-authoritative; the store can be edited
  // directly for additional admins). Never derived from tenant state.
  platformAdmins: (process.env.PLATFORM_ADMINS || '').split(',').map(s => s.trim()).filter(Boolean),
  // Presence online window: a heartbeat within this many ms counts as online.
  platformOnlineTimeoutMs: parseInt(process.env.PLATFORM_ONLINE_TIMEOUT_MS, 10) || 90000,

  // Observability / integration
  metricsEnabled: process.env.METRICS_ENABLED !== 'false',
  etagEnabled: process.env.ETAG_ENABLED !== 'false',
  requestContextEnabled: process.env.ENABLE_REQUEST_CONTEXT === 'true',
  tenantResolutionEnabled: process.env.ENABLE_TENANT_RESOLUTION === 'true',
  tenantMetadataEnabled: process.env.ENABLE_TENANT_METADATA === 'true',
  tenantFilteringEnabled: process.env.ENABLE_TENANT_FILTERING === 'true',
  multiCompanyLoginEnabled: process.env.ENABLE_MULTI_COMPANY_LOGIN === 'true',
  tenantUserMembershipEnabled: process.env.ENABLE_TENANT_USER_MEMBERSHIP === 'true',
  tenantRolesEnabled: process.env.ENABLE_TENANT_ROLES === 'true',
  // P1 (Education completion) — a NORMAL login must establish the trusted
  // tenant claim that every tenant-scoped API (Education above all) requires,
  // or shipped settings answer `400 Tenant context required` forever. The
  // claim is resolved server-side at login (services/loginTenant.service.js)
  // and only ever bound when unambiguous, so the safe posture is ON by
  // default; ENABLE_TENANT_CARRY=false restores the legacy no-tenant behavior
  // explicitly (opt-out, never implicit).
  tenantCarryEnabled: process.env.ENABLE_TENANT_CARRY !== 'false',
  customDomainResolutionEnabled: process.env.ENABLE_CUSTOM_DOMAIN_RESOLUTION === 'true',
  platformDomain: process.env.PLATFORM_DOMAIN || 'app.omnistoreerp.com',
  // Branch-level isolation (Phase F). OPT-IN via ENABLE_BRANCH_ISOLATION.
  // When enabled, branch-scoped users (users with a trusted `branchId`) are
  // confined to their own branch: the trusted branch is taken from the STORED
  // user record (never from client input), list reads are scoped to it, new
  // sales/purchases are server-stamped with it, and any client claim of a
  // different branch is rejected. When off, every guard is a no-op.
  branchIsolationEnabled: process.env.ENABLE_BRANCH_ISOLATION === 'true',
  tenantEntityIsolationEnabled: process.env.ENABLE_TENANT_ENTITY_ISOLATION === 'true',
  tenantSalesIsolationEnabled: process.env.ENABLE_TENANT_SALES_ISOLATION === 'true',
  tenantPurchasesIsolationEnabled: process.env.ENABLE_TENANT_PURCHASES_ISOLATION === 'true',
  defaultTenantId: process.env.DEFAULT_TENANT_ID || 'default',
  webhookTimeout: parseInt(process.env.WEBHOOK_TIMEOUT, 10) || 10000,
  webhookMaxRetries: parseInt(process.env.WEBHOOK_MAX_RETRIES, 10) || 3,

  // Logging
  logFile: process.env.LOG_FILE || '',
  slowRequestMs: parseInt(process.env.SLOW_REQUEST_MS, 10) || 1000,

  supabase: {
    url: process.env.SUPABASE_URL || '',
    key: process.env.SUPABASE_KEY || ''
  }
};

// Production safety validation (Phase 37). Pure and side-effect free so it can
// be unit-tested without booting the server. Returns { fatal, warnings }.
// Development / test environments always pass (no-op).
//
// Policy:
//   - FATAL (refuse to boot): the weak development JWT secret in production.
//     No documented production flow ever uses 'dev-secret'; an attacker who
//     knows it can forge any access token.
//   - WARN (loud, non-fatal): authentication disabled or open CORS. These are
//     legitimate in two documented flows — the Koyeb bootstrap creates the
//     first Owner with AUTH_REQUIRED=false, and the single-process Windows
//     install serves same-origin with CORS_ORIGINS empty — so they must not
//     block boot, but they must never be silent.
function validateProductionConfig(cfg = module.exports) {
  const fatal = [];
  const warnings = [];
  if (!cfg.isProduction) return { fatal, warnings };
  if (!cfg.jwtSecret || cfg.jwtSecret === 'dev-secret') {
    fatal.push('JWT_SECRET is not set to a strong value in production (the development default is unsafe). Set JWT_SECRET before boot.');
  }
  if (!cfg.authRequired) {
    warnings.push('AUTH_REQUIRED is false in production: all /api/v1 business routes are open. Enable it after the first Owner bootstrap.');
  }
  if (!cfg.corsOrigins) {
    warnings.push('CORS_ORIGINS is empty in production: CORS is open. Set a comma-separated allowlist unless the API is served same-origin.');
  }
  return { fatal, warnings };
}

module.exports.validateProductionConfig = validateProductionConfig;
module.exports.durationToMs = durationToMs;
