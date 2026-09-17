'use strict';

// Platform Integration — Service Catalog Contract
//
// The ERP does NOT currently have a dedicated service catalog entity.
// This contract does NOT invent one as an ERP mutation model.
//
// Instead it returns an explicit unavailable state so the Platform never
// fabricates business data. When/if the ERP adds a service catalog, this
// contract will be updated to consume it without changing the public
// interface.

const buildIdentity = require('../buildIdentity.service');

function getServiceCatalog(companyId) {
  return {
    available: false,
    reason: 'ERP_SERVICE_CATALOG_UNAVAILABLE',
    services: [],
    message: 'The ERP does not currently expose a service catalog. This endpoint is a contract boundary for future implementation.'
  };
}

function getServiceById(companyId, serviceId) {
  return null;
}

module.exports = {
  getServiceCatalog,
  getServiceById
};
