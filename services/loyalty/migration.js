'use strict';

// Loyalty legacy migration dry-run utility.
// - Inspects local DB.loyaltyTransactions.
// - Normalizes legacy fields.
// - Produces a migration report.
// - Does NOT post anything to backend.

const MIGRATION_REPORT_KEY = 'digitronics_loyalty_migration_report_v1';

function normalizeLegacyTransaction(tx, index) {
  const out = {
    index,
    original: tx,
    valid: true,
    errors: [],
    warnings: [],
    normalized: null
  };

  if (!tx || typeof tx !== 'object') {
    out.valid = false;
    out.errors.push('Transaction is not an object');
    return out;
  }

  const customerId = String(tx.customerId || '').trim();
  if (!customerId) {
    out.valid = false;
    out.errors.push('Missing customerId');
  }

  const type = String(tx.type || '').trim().toLowerCase();
  const allowed = ['earn', 'redeem', 'return_deduct', 'adjustment', 'bonus'];
  if (!allowed.includes(type)) {
    out.valid = false;
    out.errors.push('Unknown type: ' + type);
  }

  const points = Number(tx.points || 0);
  if (!Number.isFinite(points)) {
    out.valid = false;
    out.errors.push('Invalid points');
  }

  const amount = Number(tx.amount || 0);
  if (!Number.isFinite(amount) || amount < 0) {
    out.warnings.push('Amount is missing or invalid');
  }

  const ref = String(tx.ref || '').trim();
  if (!ref) {
    out.warnings.push('Missing ref');
  }

  const refType = String(tx.refType || '').trim().toLowerCase();
  if (!refType) {
    out.warnings.push('Missing refType');
  }

  const note = String(tx.note || '').trim();
  const date = String(tx.date || tx.createdAt || '').trim();

  out.normalized = {
    customerId: customerId || null,
    type: type || null,
    points: Number.isFinite(points) ? points : 0,
    amount: Number.isFinite(amount) ? amount : 0,
    ref: ref || null,
    refType: refType || null,
    note: note || null,
    date: date || null,
    user: tx.user || null,
    source: tx.source || 'legacy'
  };

  return out;
}

function buildMigrationReport() {
  const all = (() => { try { return Array.isArray(DB.loyaltyTransactions) ? DB.loyaltyTransactions : []; } catch (e) { return []; } })();
  const customers = (() => { try { return Array.isArray(DB.customers) ? DB.customers : []; } catch (e) { return []; } })();

  const customerMap = new Map();
  for (const c of customers) {
    customerMap.set(String(c.id), c);
  }

  const normalized = all.map((tx, i) => normalizeLegacyTransaction(tx, i));
  const valid = normalized.filter(n => n.valid);
  const invalid = normalized.filter(n => !n.valid);
  const withWarnings = normalized.filter(n => n.warnings.length > 0);

  const missingCustomerRefs = valid.filter(n => n.normalized.customerId && !customerMap.has(n.normalized.customerId));
  const missingRef = valid.filter(n => !n.normalized.ref);
  const missingRefType = valid.filter(n => !n.normalized.refType);
  const duplicates = [];
  const byRef = new Map();
  for (const n of valid) {
    const key = (n.normalized.ref || '') + '|' + (n.normalized.refType || '') + '|' + (n.normalized.customerId || '');
    if (!byRef.has(key)) byRef.set(key, []);
    byRef.get(key).push(n);
  }
  for (const [key, items] of byRef.entries()) {
    if (items.length > 1) duplicates.push({ key, count: items.length });
  }

  const balanceByCustomer = new Map();
  for (const n of valid) {
    const cid = n.normalized.customerId;
    if (!cid) continue;
    const cur = balanceByCustomer.get(cid) || 0;
    balanceByCustomer.set(cid, cur + n.normalized.points);
  }

  const mismatches = [];
  const matches = [];
  for (const [cid, expected] of balanceByCustomer.entries()) {
    const customer = customerMap.get(cid);
    const actual = customer ? Math.max(0, Number(customer.points) || 0) : null;
    if (actual === null) {
      mismatches.push({ customerId: cid, expected, actual: 'missing' });
    } else if (expected !== actual) {
      mismatches.push({ customerId: cid, expected, actual });
    } else {
      matches.push({ customerId: cid, points: expected });
    }
  }

  const report = {
    generatedAt: new Date().toISOString(),
    totalTransactions: all.length,
    validTransactions: valid.length,
    invalidTransactions: invalid.length,
    transactionsWithWarnings: withWarnings.length,
    missingCustomerReferences: missingCustomerRefs.length,
    missingRef: missingRef.length,
    missingRefType: missingRefType.length,
    duplicateLogicalTransactions: duplicates.length,
    customersWithBalanceMismatch: mismatches.length,
    customersWithMatchingBalance: matches.length,
    mismatches,
    matches,
    duplicates,
    invalidDetails: invalid.map(n => ({ index: n.index, errors: n.errors })),
    warnings: withWarnings.map(n => ({ index: n.index, warnings: n.warnings }))
  };

  try {
    localStorage.setItem(MIGRATION_REPORT_KEY, JSON.stringify(report));
  } catch (e) {
    // ignore
  }

  return report;
}

function getLastMigrationReport() {
  try {
    const raw = localStorage.getItem(MIGRATION_REPORT_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

function clearMigrationReport() {
  try {
    localStorage.removeItem(MIGRATION_REPORT_KEY);
  } catch (e) {
    // ignore
  }
}

const loyaltyMigration = {
  buildMigrationReport,
  getLastMigrationReport,
  clearMigrationReport,
  normalizeLegacyTransaction
};

window.loyaltyMigration = loyaltyMigration;
