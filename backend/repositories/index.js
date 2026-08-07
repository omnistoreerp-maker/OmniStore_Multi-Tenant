'use strict';

// Repository registry. Exposes one Repository instance per storage store,
// each bound to its store name. Services import the repository they need
// instead of reaching into the storage engine.
//
// Store-name constants mirror the JSON store files in backend/data/ and
// the STORE_NAME constants each service previously used. Adding a new
// store (e.g. future tenant registry) only requires a new entry here.

const BaseRepository = require('./BaseRepository');

function repository(storeName) {
  return new BaseRepository(storeName);
}

module.exports = {
  // Business / resource stores
  users: repository('users'),
  sales: repository('sales'),
  purchases: repository('purchases'),
  products: repository('products'),
  inventoryTransactions: repository('inventoryTransactions'),
  customers: repository('customers'),
  suppliers: repository('suppliers'),
  treasury: repository('treasury'),
  employees: repository('employees'),
  partners: repository('partners'),
  vouchers: repository('vouchers'),
  dashboard: repository('dashboard'),
  reports: repository('reports'),

  // Platform / security stores
  apiKeys: repository('apiKeys'),
  auditLog: repository('auditLog'),
  errors: repository('errors'),
  jobs: repository('jobs'),
  webhooks: repository('webhooks')
};

// Storage-level helpers surfaced through the repository layer (used by
// health/readiness probes instead of touching the engine directly).
module.exports.ensureDataDir = BaseRepository.ensureDataDir;
module.exports.resolvePath = BaseRepository.resolvePath;