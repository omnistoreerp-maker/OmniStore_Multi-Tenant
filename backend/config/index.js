const dotenv = require('dotenv');
const path = require('path');
dotenv.config();

const env = process.env.NODE_ENV || 'development';
const isProduction = env === 'production';

// Fail-closed security flag resolution (runtime tenant security).
//   - 'true'  -> true (explicit enable wins everywhere)
//   - 'false' -> false (explicit disable wins everywhere — documented
//                bootstrap flows rely on AUTH_REQUIRED=false, so opting out
//                must stay possible, but it can never be the DEFAULT)
//   - unset   -> production defaults to ON (fail-closed); development and
//                test keep the legacy default OFF so local workflows and the
//                existing test-suite assumptions are unchanged.
// This guarantees a production deployment can never run with tenant isolation
// silently disabled just because an env var was forgotten in render.yaml/.env.
function resolveSecurityFlag(value, production) {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return !!production;
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
  authRequired: resolveSecurityFlag(process.env.AUTH_REQUIRED, isProduction),

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
  // Tenant isolation flags — fail-closed in production (see resolveSecurityFlag).
  tenantResolutionEnabled: resolveSecurityFlag(process.env.ENABLE_TENANT_RESOLUTION, isProduction),
  tenantMetadataEnabled: resolveSecurityFlag(process.env.ENABLE_TENANT_METADATA, isProduction),
  tenantFilteringEnabled: resolveSecurityFlag(process.env.ENABLE_TENANT_FILTERING, isProduction),
  multiCompanyLoginEnabled: process.env.ENABLE_MULTI_COMPANY_LOGIN === 'true',
  tenantUserMembershipEnabled: process.env.ENABLE_TENANT_USER_MEMBERSHIP === 'true',
  tenantRolesEnabled: process.env.ENABLE_TENANT_ROLES === 'true',
  tenantCarryEnabled: process.env.ENABLE_TENANT_CARRY === 'true',
  customDomainResolutionEnabled: process.env.ENABLE_CUSTOM_DOMAIN_RESOLUTION === 'true',
  platformDomain: process.env.PLATFORM_DOMAIN || 'app.omnistoreerp.com',
  // Branch-level isolation (Phase F). OPT-IN via ENABLE_BRANCH_ISOLATION.
  // When enabled, branch-scoped users (users with a trusted `branchId`) are
  // confined to their own branch: the trusted branch is taken from the STORED
  // user record (never from client input), list reads are scoped to it, new
  // sales/purchases are server-stamped with it, and any client claim of a
  // different branch is rejected. When off, every guard is a no-op.
  branchIsolationEnabled: process.env.ENABLE_BRANCH_ISOLATION === 'true',
  tenantEntityIsolationEnabled: resolveSecurityFlag(process.env.ENABLE_TENANT_ENTITY_ISOLATION, isProduction),
  tenantSalesIsolationEnabled: resolveSecurityFlag(process.env.ENABLE_TENANT_SALES_ISOLATION, isProduction),
  tenantPurchasesIsolationEnabled: resolveSecurityFlag(process.env.ENABLE_TENANT_PURCHASES_ISOLATION, isProduction),
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
//   - WARN (loud, non-fatal): authentication disabled, open CORS, or any
//     tenant-isolation flag disabled. These are legitimate in two documented
//     flows — the Koyeb bootstrap creates the first Owner with
//     AUTH_REQUIRED=false, and the single-process Windows install serves
//     same-origin with CORS_ORIGINS empty — so they must not block boot, but
//     they must never be silent. Isolation flags now default to ON in
//     production (resolveSecurityFlag), so a warning here means somebody
//     EXPLICITLY opted out and must have done so deliberately.
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
  // Tenant isolation must be ON in production. resolveSecurityFlag already
  // defaults every flag to true there, so reaching these checks with a falsy
  // value means an explicit override (or a non-boolean cfg in tests).
  const isolationOff = [];
  if (!cfg.tenantResolutionEnabled) isolationOff.push('ENABLE_TENANT_RESOLUTION');
  if (!cfg.tenantMetadataEnabled) isolationOff.push('ENABLE_TENANT_METADATA');
  if (!cfg.tenantFilteringEnabled) isolationOff.push('ENABLE_TENANT_FILTERING');
  if (!cfg.tenantEntityIsolationEnabled) isolationOff.push('ENABLE_TENANT_ENTITY_ISOLATION');
  if (!cfg.tenantSalesIsolationEnabled) isolationOff.push('ENABLE_TENANT_SALES_ISOLATION');
  if (!cfg.tenantPurchasesIsolationEnabled) isolationOff.push('ENABLE_TENANT_PURCHASES_ISOLATION');
  if (isolationOff.length) {
    warnings.push('Tenant isolation is disabled in production (' + isolationOff.join(', ') + '): tenants can read/write each other\'s data. Remove these overrides to restore the fail-closed defaults.');
  }
  return { fatal, warnings };
}

module.exports.validateProductionConfig = validateProductionConfig;
module.exports.resolveSecurityFlag = resolveSecurityFlag;
