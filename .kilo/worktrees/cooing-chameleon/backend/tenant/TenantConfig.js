'use strict';

// TenantConfig —— configuration surface for the future tenant system.
//
// Provides defaults only. NOT WIRED INTO THE RUNTIME. Values are read from
// environment variables with safe local defaults so the module is inert and
// side-effect free at import time.

const { ISOLATION_MODES, STORAGE_PROVIDERS, DATABASE_PROVIDERS } = require('./TenantConstants');

const DEFAULT_TENANT_ID = process.env.TENANT_DEFAULT_ID || 'default';
const STORAGE_PROVIDER = process.env.TENANT_STORAGE_PROVIDER || STORAGE_PROVIDERS.JSON;
const DATABASE_PROVIDER = process.env.TENANT_DATABASE_PROVIDER || DATABASE_PROVIDERS.NONE;
const ISOLATION_MODE = process.env.TENANT_ISOLATION_MODE || ISOLATION_MODES.STORE;

const tenantConfig = Object.freeze({
  defaultTenantId: DEFAULT_TENANT_ID,
  storageProvider: STORAGE_PROVIDER,
  databaseProvider: DATABASE_PROVIDER,
  isolationMode: ISOLATION_MODE,
  enabled: process.env.TENANT_ENABLED === 'true'
});

module.exports = tenantConfig;