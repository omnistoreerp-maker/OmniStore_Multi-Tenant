'use strict';

// platformOrdersAggregator — PLATFORM-scoped "Orders Today" metric.
//
// Purpose: give Platform Activity a real, safe number to replace the honest
// `ordersToday: null` placeholder. This service is deliberately SEPARATE from
// every tenant-facing repository and service:
//
//   - It reads the RAW sales store (full document, unfiltered) through a
//     dedicated BaseRepository instance with NO tenant accessor. It never
//     enters the AsyncLocalStorage tenant/branch context and never inherits a
//     caller's tenant scope — the result is always the platform-wide count.
//   - It RETURNS A NUMBER ONLY. No invoice details, no order identifiers, no
//     customer fields, no tenant ids, no per-tenant breakdown can leave this
//     module, so it can never leak tenant PII or private data.
//   - It never depends on req.query / req.body / req.headers: there is no way
//     for a caller to scope or un-scope the aggregation. Server-owned data
//     only.
//
// ORDERS TODAY DEFINITION (canonical, matching the existing sales semantics):
//   The count of sales invoices in the platform `sales` store whose business
//   timestamp falls inside the CURRENT DAY, where:
//     - business timestamp = `date` when present and parseable, else
//       `createdAt` (identical to sales.service list filtering:
//       `inv.date || inv.createdAt`), treated as an instant and bucketed by
//       the platform reporting timezone (UTC by default — the canonical
//       semantics used across the codebase, which compares ISO UTC strings
//       and Date instants with no local-timezone conversion anywhere).
//     - the day window is [startOfDay(now), startOfDay(now) + 24h) in that
//       timezone.
//
// EXCLUSIONS (records that do NOT count as orders today):
//   1. TEST invoices — invoiceNumber or id matching /(^|[^A-Z0-9])TEST([^A-Z0-9]|$)/i
//      or starting with the conventional "TEST-" / "TEST " prefix. The baseline
//      store ships with `invoiceNumber: "TEST-001"`, so these must never
//      pollute the metric.
//   2. Cancelled / void / refunded / draft records — status field (when
//      present) matching cancelled/canceled/void/voided/refunded/draft/reversed
//      (case-insensitive). Records with no status field are counted (the sales
//      store has no status field today; absence = a real sale).
//   3. Invalid records — non-object entries, missing/empty id AND
//      invoiceNumber, missing or unparseable date AND createdAt, or negative
//      total. Malformed entries are SKIPPED, never thrown on.
//
// The service never writes. It is read-only against the store.

const BaseRepository = require('../repositories/BaseRepository');

// Dedicated platform-scoped repository: NO tenant accessor on purpose. This
// instance can never be tenant-filtered and never stamps tenant metadata.
const salesRepository = new BaseRepository('sales');

const DAY_MS = 24 * 60 * 60 * 1000;

// Test-invoice marker: a standalone "TEST" token in the invoice number/id
// (TEST-001, INV-TEST, test_0042, ORDER TEST ...). Case-insensitive.
const TEST_MARKER = /(^|[^A-Za-z0-9])TEST([^A-Za-z0-9]|$)/i;

// Non-countable statuses (when a status field exists at all).
const EXCLUDED_STATUSES = new Set([
  'cancelled', 'canceled', 'void', 'voided', 'refunded', 'draft', 'reversed'
]);

function _isTestInvoice(record) {
  const markers = [record.invoiceNumber, record.invoice_number, record.id, record.invoiceId];
  for (const marker of markers) {
    if (typeof marker === 'string' && TEST_MARKER.test(marker)) return true;
  }
  return false;
}

function _isExcludedStatus(record) {
  const status = record.status || record.invoiceStatus || record.orderStatus;
  if (status === undefined || status === null || String(status).trim() === '') return false;
  return EXCLUDED_STATUSES.has(String(status).trim().toLowerCase());
}

function _businessTimestamp(record) {
  // Canonical sales semantics: `date || createdAt` (see sales.service list()).
  const raw = record.date || record.createdAt || record.created_at;
  if (raw === undefined || raw === null || raw === '') return null;
  const t = new Date(raw).getTime();
  return Number.isFinite(t) ? t : null;
}

function _isValidRecord(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return false;
  const hasIdentity =
    (typeof record.id === 'string' && record.id.trim() !== '') ||
    (typeof record.invoiceNumber === 'string' && record.invoiceNumber.trim() !== '') ||
    (typeof record.invoice_number === 'string' && record.invoice_number.trim() !== '');
  if (!hasIdentity) return false;
  if (_businessTimestamp(record) === null) return false;
  // Negative totals are structurally invalid for a sale.
  if (record.total !== undefined && record.total !== null && Number(record.total) < 0) return false;
  return true;
}

function _startOfDayUtc(ms) {
  return Math.floor(ms / DAY_MS) * DAY_MS;
}

function _isSameUtcDay(timestampMs, referenceMs) {
  return _startOfDayUtc(timestampMs) === _startOfDayUtc(referenceMs);
}

// Internal aggregation core — returns the full detail object used by tests.
// `options.referenceNow` exists ONLY for deterministic tests (timezone/date
// boundary); production callers pass nothing.
function _aggregate(invoices, options) {
  const opts = options || {};
  const now = opts.referenceNow !== undefined
    ? new Date(opts.referenceNow).getTime()
    : Date.now();
  const nowMs = Number.isFinite(now) ? now : Date.now();
  const records = Array.isArray(invoices) ? invoices : [];

  let examined = 0;
  let invalid = 0;
  let testInvoices = 0;
  let excludedStatus = 0;
  let otherDays = 0;
  let counted = 0;

  for (const record of records) {
    examined++;
    if (!_isValidRecord(record)) { invalid++; continue; }
    if (_isTestInvoice(record)) { testInvoices++; continue; }
    if (_isExcludedStatus(record)) { excludedStatus++; continue; }
    const ts = _businessTimestamp(record);
    if (!_isSameUtcDay(ts, nowMs)) { otherDays++; continue; }
    counted++;
  }

  return {
    ordersToday: counted,
    dayStartUtc: new Date(_startOfDayUtc(nowMs)).toISOString(),
    // Aggregate-only counters (safe to expose; carry no record data).
    meta: {
      examined,
      invalid,
      testInvoices,
      excludedStatus,
      otherDays
    }
  };
}

// Public metric for Platform Activity. Returns a NUMBER ONLY — the narrow
// contract consumed by platformActivity. No PII, no ids, no tenant data.
function getOrdersToday(options) {
  const db = salesRepository._rawStore(); // full document, tenant-unfiltered by design
  const invoices = db && typeof db === 'object' && Array.isArray(db.invoices) ? db.invoices : [];
  return _aggregate(invoices, options).ordersToday;
}

// Detail form for future platform-admin dashboards and for tests: aggregate
// counters only. Still zero record content by construction.
function getOrdersTodayDetail(options) {
  const db = salesRepository._rawStore();
  const invoices = db && typeof db === 'object' && Array.isArray(db.invoices) ? db.invoices : [];
  const result = _aggregate(invoices, options);
  return {
    ordersToday: result.ordersToday,
    dayStartUtc: result.dayStartUtc,
    meta: result.meta
  };
}

module.exports = {
  getOrdersToday,
  getOrdersTodayDetail
};
