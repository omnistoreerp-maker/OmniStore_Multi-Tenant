'use strict';

// Loyalty reconciliation utility.
// - Compares local localStorage loyalty state with backend remote state.
// - Does NOT automatically resolve conflicts.
// - Produces a diagnostic report only.

function getLocalTransactions(customerId) {
  const id = String(customerId || '');
  const all = (() => { try { return Array.isArray(DB.loyaltyTransactions) ? DB.loyaltyTransactions : []; } catch (e) { return []; } })();
  return all.filter(t => String(t.customerId) === id);
}

function getLocalPoints(customerId) {
  const id = String(customerId || '');
  const customer = (DB.customers || []).find(c => String(c.id) === id);
  return customer ? Math.max(0, Number(customer.points) || 0) : 0;
}

function sumLocalPoints(transactions) {
  return transactions.reduce((sum, t) => sum + (Number(t.points) || 0), 0);
}

function reconcile(customerId, remoteState) {
  const id = String(customerId || '');
  if (!id) return { status: 'error', error: 'customerId is required' };

  const localTxs = getLocalTransactions(id);
  const localPoints = getLocalPoints(id);
  const localSum = sumLocalPoints(localTxs);

  const remotePoints = remoteState && remoteState.remotePoints != null ? Number(remoteState.remotePoints) : null;
  const remoteTxs = remoteState && Array.isArray(remoteState.remoteTransactions) ? remoteState.remoteTransactions : [];

  const byRef = new Map();
  const remoteByRef = new Map();

  for (const tx of localTxs) {
    const key = String(tx.ref || '') + '|' + String(tx.type || '') + '|' + String(tx.customerId || '');
    if (!byRef.has(key)) byRef.set(key, []);
    byRef.get(key).push(tx);
  }

  for (const tx of remoteTxs) {
    const key = String(tx.ref || '') + '|' + String(tx.type || '') + '|' + String(tx.customerId || '');
    if (!remoteByRef.has(key)) remoteByRef.set(key, []);
    remoteByRef.get(key).push(tx);
  }

  const conflicts = [];
  const localOnly = [];
  const remoteOnly = [];
  const duplicates = [];

  for (const [key, txs] of byRef.entries()) {
    const remote = remoteByRef.get(key);
    if (!remote) {
      if (txs.length > 1) duplicates.push({ key, local: txs.length, remote: 0 });
      localOnly.push({ key, local: txs.length, remote: 0 });
    } else if (txs.length > 1 || remote.length > 1) {
      duplicates.push({ key, local: txs.length, remote: remote.length });
    }
  }

  for (const [key, txs] of remoteByRef.entries()) {
    const local = byRef.get(key);
    if (!local) {
      remoteOnly.push({ key, local: 0, remote: txs.length });
    }
  }

  const balanceMatch = remotePoints === null ? 'unknown' : (localPoints === remotePoints ? 'match' : 'mismatch');
  const txMatch = localTxs.length === remoteTxs.length ? 'match' : 'mismatch';

  return {
    customerId: id,
    localPoints,
    remotePoints,
    balanceMatch,
    localTransactionCount: localTxs.length,
    remoteTransactionCount: remoteTxs.length,
    txMatch,
    localOnly,
    remoteOnly,
    duplicates,
    conflicts,
    summary: {
      MATCH: balanceMatch === 'match' && txMatch === 'match' && localOnly.length === 0 && remoteOnly.length === 0 && duplicates.length === 0,
      LOCAL_ONLY: localOnly.length > 0,
      REMOTE_ONLY: remoteOnly.length > 0,
      BALANCE_MISMATCH: balanceMatch === 'mismatch',
      TRANSACTION_MISMATCH: txMatch === 'mismatch',
      DUPLICATE_REFERENCE: duplicates.length > 0,
      CONFLICT: conflicts.length > 0
    }
  };
}

function formatReport(report) {
  if (!report) return 'No report';
  const lines = [
    'Customer: ' + report.customerId,
    'Local points: ' + report.localPoints,
    'Remote points: ' + (report.remotePoints !== null ? report.remotePoints : 'N/A'),
    'Balance: ' + report.balanceMatch,
    'Local transactions: ' + report.localTransactionCount,
    'Remote transactions: ' + report.remoteTransactionCount,
    'Transactions: ' + report.txMatch,
    ''
  ];
  if (report.localOnly.length) lines.push('Local only: ' + report.localOnly.length);
  if (report.remoteOnly.length) lines.push('Remote only: ' + report.remoteOnly.length);
  if (report.duplicates.length) lines.push('Duplicates: ' + report.duplicates.length);
  if (report.conflicts.length) lines.push('Conflicts: ' + report.conflicts.length);
  lines.push('Summary: ' + JSON.stringify(report.summary));
  return lines.join('\n');
}

const loyaltyReconciler = {
  reconcile,
  formatReport,
  getLocalTransactions,
  getLocalPoints,
  sumLocalPoints
};

window.loyaltyReconciler = loyaltyReconciler;
