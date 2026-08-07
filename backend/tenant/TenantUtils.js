'use strict';

// TenantUtils —— small pure helpers for the tenant domain.
//
// Scaffolded, pure, and side-effect free. NOT WIRED INTO THE RUNTIME.

const { isValidTenantId } = require('./TenantTypes');

// Extremely light normalization of tenant ids for comparisons. Does NOT
// perform any resolution or storage access.
function normalizeTenantId(tenantId) {
  if (tenantId == null) return null;
  return String(tenantId).trim();
}

function safeTenantId(tenantId) {
  const normalized = normalizeTenantId(tenantId);
  return isValidTenantId(normalized) ? normalized : null;
}

module.exports = {
  normalizeTenantId,
  safeTenantId
};