'use strict';

// TenantConstants — canonical values for the tenant domain.
//
// THIS MODULE IS INFRASTRUCTURE ONLY AND IS NOT WIRED INTO THE RUNTIME.
// Nothing in the application imports or uses these constants yet; they exist
// so that future tenant work references a single source of truth.

const TENANT_STATUS = Object.freeze({
  ACTIVE: 'active',
  INACTIVE: 'inactive',
  SUSPENDED: 'suspended',
  PENDING: 'pending',
  DELETED: 'deleted'
});

const ISOLATION_MODES = Object.freeze({
  // One tenant per physical store (e.g. data/tenants/<id>/...).
  STORE: 'store',
  // Shared store with tenant_id scoping on every record.
  SHARED: 'shared',
  // A dedicated database per tenant (provider-specific).
  DATABASE: 'database',
  // A dedicated schema per tenant within a shared database.
  SCHEMA: 'schema'
});

const STORAGE_PROVIDERS = Object.freeze({
  JSON: 'json',
  SQLITE: 'sqlite',
  POSTGRES: 'postgres',
  SUPABASE: 'supabase',
  MONGODB: 'mongodb'
});

const DATABASE_PROVIDERS = Object.freeze({
  NONE: 'none',
  SQLITE: 'sqlite',
  POSTGRES: 'postgres',
  SUPABASE: 'supabase',
  MONGODB: 'mongodb'
});

const DEFAULT_FEATURES = Object.freeze({
  SALES: 'sales',
  PURCHASES: 'purchases',
  INVENTORY: 'inventory',
  REPORTS: 'reports',
  DASHBOARD: 'dashboard',
  TREASURY: 'treasury',
  CUSTOMERS: 'customers',
  SUPPLIERS: 'suppliers',
  EMPLOYEES: 'employees',
  PARTNERS: 'partners',
  VOUCHERS: 'vouchers',
  ACCOUNTING: 'accounting'
});

module.exports = {
  TENANT_STATUS,
  ISOLATION_MODES,
  STORAGE_PROVIDERS,
  DATABASE_PROVIDERS,
  DEFAULT_FEATURES
};