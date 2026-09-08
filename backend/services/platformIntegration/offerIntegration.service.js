'use strict';

// Platform Integration — Offer Contract
//
// The ERP does NOT currently have a dedicated offer engine.
// This contract does NOT invent offer calculation logic.
//
// Instead it returns an explicit unavailable state so the Platform never
// fabricates pricing or discount data. When/if the ERP adds an offer engine,
// this contract will be updated to consume it without changing the public
// interface.
//
// Platform MUST NOT implement:
//   price = basePrice - discount
// as an independent business rule. All pricing must come from the ERP.

function getOffers(companyId) {
  return {
    available: false,
    reason: 'ERP_OFFER_ENGINE_UNAVAILABLE',
    offers: [],
    message: 'The ERP does not currently expose an offer engine. This endpoint is a contract boundary for future implementation.'
  };
}

function getOfferById(companyId, offerId) {
  return null;
}

module.exports = {
  getOffers,
  getOfferById
};
