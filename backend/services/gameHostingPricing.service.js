'use strict';

// gameHostingPricing.service — server-authoritative pricing catalog.
//
// The client NEVER sets the final price. Plans define pricePerMonth;
// this service resolves the authoritative price + billing period from
// the tenant-scoped plan record (after checking the plan exists and is
// active). The storefront only chooses WHICH plan and HOW MANY periods
// — never the amount.

const gameHostingService = require('./gameHosting.service');

const BILLING_PERIODS = Object.freeze(['1m', '3m', '6m', '12m']);

const PERIOD_MONTHS = Object.freeze({
  '1m': 1,
  '3m': 3,
  '6m': 6,
  '12m': 12
});

// Multi-period discounts applied server-side (customer buys N months
// upfront). Keys are periods; values are multipliers on monthly price.
const PERIOD_DISCOUNT = Object.freeze({
  '1m': 1,
  '3m': 0.97,
  '6m': 0.95,
  '12m': 0.9
});

function round2(n) {
  return Math.round(n * 100) / 100;
}

// Resolve the authoritative quote for a plan + billing period.
// Returns { error } or { quote }.
async function quote({ planId, billingPeriod, tenantContext } = {}) {
  if (planId == null || String(planId).trim() === '') return { error: 'planId is required' };
  const period = billingPeriod == null || billingPeriod === '' ? '1m' : String(billingPeriod);
  if (BILLING_PERIODS.indexOf(period) === -1) {
    return { error: 'billingPeriod must be one of ' + BILLING_PERIODS.join(', ') };
  }
  const plan = await gameHostingService.getPlanById({ id: String(planId).trim(), tenantContext });
  if (!plan) return { error: 'Plan not found' };
  if (plan.status && plan.status !== 'active') return { error: 'Plan is not available for ordering' };
  if (typeof plan.pricePerMonth !== 'number' || plan.pricePerMonth < 0) {
    return { error: 'Plan has no valid price configured' };
  }

  const months = PERIOD_MONTHS[period];
  const multiplier = PERIOD_DISCOUNT[period];
  const monthly = round2(plan.pricePerMonth);
  // Total = monthly price × months × period discount (server-side only).
  const total = round2(monthly * months * multiplier);

  return {
    quote: {
      planId: plan.id,
      planName: plan.name,
      currency: 'EGP',
      billingPeriod: period,
      months,
      monthlyPrice: monthly,
      discountMultiplier: multiplier,
      total,
      quotedAt: new Date().toISOString()
    }
  };
}

// Recompute a quote from a stored order (used on renewal and by tests
// to assert the price cannot drift from the catalog).
async function quoteFromPlan(plan, billingPeriod) {
  if (!plan) return { error: 'Plan not found' };
  const period = billingPeriod == null || billingPeriod === '' ? '1m' : String(billingPeriod);
  if (BILLING_PERIODS.indexOf(period) === -1) return { error: 'billingPeriod must be one of ' + BILLING_PERIODS.join(', ') };
  const months = PERIOD_MONTHS[period];
  const multiplier = PERIOD_DISCOUNT[period];
  const monthly = round2(Number(plan.pricePerMonth) || 0);
  return {
    quote: {
      planId: plan.id,
      planName: plan.name,
      currency: 'EGP',
      billingPeriod: period,
      months,
      monthlyPrice: monthly,
      discountMultiplier: multiplier,
      total: round2(monthly * months * multiplier),
      quotedAt: new Date().toISOString()
    }
  };
}

module.exports = {
  BILLING_PERIODS,
  PERIOD_MONTHS,
  PERIOD_DISCOUNT,
  quote,
  quoteFromPlan,
  round2
};
