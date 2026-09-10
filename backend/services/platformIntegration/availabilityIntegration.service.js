'use strict';

// Platform Integration — Availability Contract
//
// Platform MUST NOT calculate stock independently.
// This contract delegates to the authoritative ERP inventory service.
//
// The ERP inventory service stores products as a GLOBAL collection (no tenantId).
// Branch-level stock is not yet modeled in the ERP — this contract exposes
// the global stock as the authoritative availability for now.
// Future branch-level inventory will extend this contract without changing
// the public interface.
//
// COMPANY PARAMETER SEMANTICS:
// - companyId identifies the public company context for the availability lookup.
// - It is NOT a tenant ownership filter.
// - It is NOT a branch stock selector.
// - The only company-side validation is existence/activity, which is performed
//   upstream by the integration controller before calling this contract.
// - This contract does not consult tenant/branch authorization.
// - Availability is based on the ERP's global product stock model (stockQty).

const inventoryService = require('../inventory.service');
const productIntegration = require('./productIntegration.service');

/**
 * Get availability for a product by productId.
 * This is the core availability lookup. It does not perform tenant/branch
 * authorization; that is the caller's responsibility.
 *
 * @param {string} productId - The ERP product identifier.
 * @returns {{ available: boolean, reason: string|null, quantity: number|null, trackInventory: boolean, lowStock: boolean }}
 */
async function getAvailability(productId) {
  if (!productId) {
    return { available: false, reason: 'PRODUCT_NOT_FOUND' };
  }
  const product = await productIntegration.getProductById(productId);
  if (!product) {
    return { available: false, reason: 'PRODUCT_NOT_FOUND' };
  }
  if (product.active) {
    return {
      available: product.stockQty > 0,
      reason: product.stockQty > 0 ? null : 'OUT_OF_STOCK',
      quantity: product.stockQty,
      trackInventory: true,
      lowStock: product.stockQty <= product.lowStockThreshold
    };
  }
  return {
    available: false,
    reason: 'INACTIVE',
    quantity: product.stockQty
  };
}

/**
 * Get availability for a product within a company context.
 *
 * COMPANY PARAMETER SEMANTICS:
 * - companyId is context-only: it identifies which public company catalog is
 *   being requested, but does NOT filter products by ownership.
 * - It is NOT a tenant ownership filter.
 *   It is NOT a branch stock selector.
 * - The caller (integration controller) is responsible for validating that the
 *   company exists and is active before invoking this function.
 * - This function ignores companyId for stock calculation because the ERP
 *   currently models products and stock as global (no per-company ownership).
 *
 * @param {string} companyId - Public company identifier for context validation.
 * @param {string} productId - The ERP product identifier.
 * @returns {{ available: boolean, reason: string|null, quantity: number|null, trackInventory: boolean, lowStock: boolean }}
 */
async function getAvailabilityForCompany(companyId, productId) {
  if (!companyId) {
    return { available: false, reason: 'COMPANY_NOT_FOUND' };
  }
  return getAvailability(productId);
}

module.exports = {
  getAvailability,
  getAvailabilityForCompany
};
