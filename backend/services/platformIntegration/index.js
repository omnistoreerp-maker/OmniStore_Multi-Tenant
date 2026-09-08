'use strict';

// Platform Integration Boundary — single entry point for all ERP consumption.
//
// ARCHITECTURE:
//
//   Browser
//     ↓
//   Platform API (/api/v1/platform-integration/*)
//     ↓
//   This boundary (services/platformIntegration/*)
//     ↓
//   ERP services (read-only)
//
// Platform MUST NOT:
//   - duplicate ERP business logic
//   - calculate pricing independently
//   - calculate stock independently
//   - invent offer rules
//   - write to ERP stores
//
// All contracts return safe defaults when ERP data is unavailable
// (e.g., empty arrays, explicit unavailable flags) — never fabricated values.

const company = require('./companyIntegration.service');
const product = require('./productIntegration.service');
const service = require('./serviceIntegration.service');
const offer = require('./offerIntegration.service');
const availability = require('./availabilityIntegration.service');

module.exports = {
  company,
  product,
  service,
  offer,
  availability
};
