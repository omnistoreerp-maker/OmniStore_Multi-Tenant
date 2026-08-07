// Environment validation + startup diagnostics for production runs.
// Exits 1 with a clear message when a required setting is missing/unsafe.
// Usage: node scripts/checkEnv.js
const fs = require('fs');
const path = require('path');

const errors = [];
const warnings = [];
const info = [];

const env = process.env.NODE_ENV || 'development';
const isProduction = env === 'production';

// Node version
const major = parseInt(process.versions.node.split('.')[0], 10);
if (major < 18) errors.push(`Node >= 18 required (running ${process.versions.node})`);
else info.push(`node ${process.versions.node}`);

// JWT secrets
const jwtSecret = process.env.JWT_SECRET || '';
if (isProduction) {
  if (!jwtSecret) errors.push('JWT_SECRET is required in production');
  else if (jwtSecret === 'dev-secret') errors.push('JWT_SECRET is still the development default — set a long random value');
  else if (jwtSecret.length < 32) warnings.push('JWT_SECRET is shorter than 32 characters');
}
if (!process.env.JWT_REFRESH_SECRET) info.push('JWT_REFRESH_SECRET not set (derived from JWT_SECRET)');

// Port
const port = parseInt(process.env.PORT, 10) || 3001;
if (port < 1 || port > 65535) errors.push(`PORT out of range: ${process.env.PORT}`);
else info.push(`port ${port}`);

// Data directory (JSON persistence)
const dataDir = process.env.DIGITRONICS_DATA_DIR
  ? path.resolve(process.env.DIGITRONICS_DATA_DIR)
  : path.join(__dirname, '..', 'data');
try {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.accessSync(dataDir, fs.constants.W_OK);
  const stores = fs.readdirSync(dataDir).filter(f => f.endsWith('.json')).length;
  info.push(`data dir ${dataDir} writable (${stores} store files)`);
} catch (e) {
  errors.push(`data dir ${dataDir} not writable: ${e.message}`);
}

// Log file target
if (process.env.LOG_FILE) {
  try {
    fs.mkdirSync(path.dirname(path.resolve(process.env.LOG_FILE)), { recursive: true });
    info.push(`log file ${process.env.LOG_FILE}`);
  } catch (e) {
    errors.push(`LOG_FILE directory not writable: ${e.message}`);
  }
} else {
  info.push('LOG_FILE not set (stdout logging only)');
}

// Auth posture
info.push(`AUTH_REQUIRED=${process.env.AUTH_REQUIRED === 'true' ? 'true (routes protected)' : 'false (legacy open mode)'}`);
info.push(`CORS_ORIGINS=${process.env.CORS_ORIGINS ? 'restricted allowlist' : 'open (legacy default)'}`);
info.push(`RATE_LIMIT_MAX=${process.env.RATE_LIMIT_MAX || '1000'}`);

// Report
console.log('--- DigiTronics environment check ---');
for (const line of info) console.log('info   ' + line);
for (const line of warnings) console.log('warn   ' + line);
for (const line of errors) console.log('ERROR  ' + line);
if (errors.length) {
  console.error(`\n${errors.length} blocking problem(s) — fix before starting.`);
  process.exit(1);
}
console.log('Environment OK' + (warnings.length ? ` (${warnings.length} warning(s))` : ''));
