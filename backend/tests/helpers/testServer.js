// Boots the Express app IN-PROCESS for tests. Each call resets the module
// registry, applies the desired environment, and re-requires server.js so
// every instance gets its own config, data directory, rate limiter and
// token store. Coverage instrumentation sees everything because the code
// executes inside the test process.
const { makeTempDataDir } = require('./testData');

const TEST_JWT_SECRET = 'test-jwt-secret-for-jest-suites';

// Keys that must be explicitly set or cleared per instance.
const INSTANCE_ENV_KEYS = [
  'AUTH_REQUIRED', 'RATE_LIMIT_MAX', 'CORS_ORIGINS',
  // OAuth / Master Google sign-in instance configuration: cleared unless a
  // suite passes them explicitly, so an OAuth-enabled suite can never leak
  // its environment into the next one sharing this worker.
  'OAUTH_ENABLED', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET',
  'GOOGLE_CALLBACK_URL', 'GOOGLE_MASTER_CALLBACK_URL', 'OAUTH_MASTER_EMAIL',
  // Binding-cookie domain scoping (P0): cleared unless passed explicitly.
  'PLATFORM_DOMAIN', 'OAUTH_COOKIE_DOMAIN'
];

function startServer(dataDir, extraEnv) {
  const dir = dataDir || makeTempDataDir('app');
  jest.resetModules();
  process.env.DIGITRONICS_DATA_DIR = dir;
  process.env.JWT_SECRET = TEST_JWT_SECRET;
  process.env.NODE_ENV = (extraEnv && extraEnv.NODE_ENV) || 'test';
  process.env.LOG_FILE = '';
  for (const key of INSTANCE_ENV_KEYS) {
    if (extraEnv && extraEnv[key] !== undefined) process.env[key] = extraEnv[key];
    else delete process.env[key];
  }
  const app = require('../../server.js');
  return { app, dataDir: dir };
}

// Kept for registerCleanup() signature compatibility: in-process app
// instances need no teardown beyond temp-dir removal.
async function stopServer() {}

module.exports = { startServer, stopServer, TEST_JWT_SECRET };
