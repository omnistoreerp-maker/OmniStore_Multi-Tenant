'use strict';

// CompanyService — read-only multi-company catalog accessor.
//
// Provides the lightweight company catalog used by the login UI when
// ENABLE_MULTI_COMPANY_LOGIN is on. It is strictly READ-ONLY: no create,
// update, delete, or any mutation API. The catalog lives in
// backend/data/companies.json and is never written at runtime.
//
// The catalog may hold ANY number of companies (a JSON array) — there is no
// hard-coded list and no code changes required to add companies.

const storageAdapter = require('../repositories/storageAdapter');

const STORE = 'companies';

// Normalize whatever shape the catalog file is in (a plain JSON array, or a
// `{ companies: [...] }` object) into an array of companies.
function _toArray(data) {
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.companies)) return data.companies;
  return [];
}

function _sortAlphabetical(list) {
  return list
    .slice()
    .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
}

const CompanyService = {
  listCompanies() {
    return _toArray(storageAdapter.read(STORE));
  },

  getCompany(id) {
    if (id == null || id === '') return null;
    const key = String(id);
    return this.listCompanies().find(c => c && String(c.id) === key) || null;
  },

  getActiveCompanies() {
    return _sortAlphabetical(this.listCompanies().filter(c => c && c.active !== false));
  }
};

module.exports = CompanyService;