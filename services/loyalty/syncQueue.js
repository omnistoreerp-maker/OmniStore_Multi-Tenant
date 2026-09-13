'use strict';

// Loyalty sync retry queue.
// - Stores pending loyalty sync operations in localStorage.
// - Uses exponential backoff with max retries.
// - Processes queue on app load / reconnect.
// - Does NOT block sale/return completion.

const QUEUE_KEY = 'digitronics_loyalty_sync_queue_v1';
const DEAD_LETTER_KEY = 'digitronics_loyalty_dead_letter_v1';
const MAX_RETRIES = 5;
const BASE_DELAY_MS = 1000;
const MAX_DELAY_MS = 30000;

function loadQueue() {
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    return [];
  }
}

function saveQueue(queue) {
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
  } catch (e) {
    // ignore storage errors
  }
}

function loadDeadLetter() {
  try {
    const raw = localStorage.getItem(DEAD_LETTER_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    return [];
  }
}

function saveDeadLetter(entries) {
  try {
    localStorage.setItem(DEAD_LETTER_KEY, JSON.stringify(entries));
  } catch (e) {
    // ignore
  }
}

function createOperation({ operationType, customerId, reference, refType, payload = {} }) {
  return {
    id: 'LOY-Q-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8),
    operationType,
    customerId: String(customerId || ''),
    reference: String(reference || ''),
    refType: String(refType || ''),
    payload,
    createdAt: Date.now(),
    attempts: 0,
    lastAttemptAt: null,
    nextRetryAt: Date.now(),
    status: 'pending',
    lastError: null
  };
}

function findPending(operationType, customerId, reference) {
  const queue = loadQueue();
  return queue.find(op =>
    op.status === 'pending' &&
    op.operationType === operationType &&
    op.customerId === String(customerId || '') &&
    op.reference === String(reference || '')
  );
}

function enqueue(operation) {
  const queue = loadQueue();
  const existing = findPending(operation.operationType, operation.customerId, operation.reference);
  if (existing) {
    existing.payload = { ...existing.payload, ...operation.payload };
    existing.nextRetryAt = Date.now();
    saveQueue(queue);
    return existing;
  }
  queue.push(operation);
  saveQueue(queue);
  return operation;
}

function markConfirmed(id) {
  const queue = loadQueue();
  const op = queue.find(o => o.id === id);
  if (op) {
    op.status = 'confirmed';
    op.lastError = null;
    saveQueue(queue);
  }
}

function markDuplicate(id, existingId) {
  const queue = loadQueue();
  const op = queue.find(o => o.id === id);
  if (op) {
    op.status = 'duplicate';
    op.lastError = 'Duplicate confirmed';
    saveQueue(queue);
  }
}

function markConflict(id, error) {
  const queue = loadQueue();
  const op = queue.find(o => o.id === id);
  if (op) {
    op.status = 'conflict';
    op.lastError = error;
    op.attempts = MAX_RETRIES;
    saveQueue(queue);
    moveToDeadLetter(op);
  }
}

function markDeadLetter(id, error) {
  const queue = loadQueue();
  const op = queue.find(o => o.id === id);
  if (op) {
    op.status = 'dead_letter';
    op.lastError = error;
    saveQueue(queue);
    moveToDeadLetter(op);
  }
}

function moveToDeadLetter(op) {
  const deadLetter = loadDeadLetter();
  deadLetter.push(op);
  saveDeadLetter(deadLetter);
}

function getPendingOperations() {
  const queue = loadQueue();
  const now = Date.now();
  return queue.filter(op => op.status === 'pending' && op.nextRetryAt <= now);
}

function updateRetrySchedule(id, error) {
  const queue = loadQueue();
  const op = queue.find(o => o.id === id);
  if (!op) return null;
  op.attempts += 1;
  op.lastAttemptAt = Date.now();
  op.lastError = error;
  if (op.attempts >= MAX_RETRIES) {
    op.status = 'dead_letter';
    op.nextRetryAt = null;
    saveQueue(queue);
    moveToDeadLetter(op);
    return op;
  }
  const delay = Math.min(BASE_DELAY_MS * Math.pow(2, op.attempts - 1), MAX_DELAY_MS);
  op.nextRetryAt = Date.now() + delay;
  saveQueue(queue);
  return op;
}

function clearConfirmed() {
  const queue = loadQueue().filter(op => op.status !== 'confirmed');
  saveQueue(queue);
}

function getQueueStats() {
  const queue = loadQueue();
  return {
    pending: queue.filter(op => op.status === 'pending').length,
    confirmed: queue.filter(op => op.status === 'confirmed').length,
    conflict: queue.filter(op => op.status === 'conflict').length,
    dead_letter: queue.filter(op => op.status === 'dead_letter').length,
    total: queue.length
  };
}

const loyaltySyncQueue = {
  enqueue,
  markConfirmed,
  markDuplicate,
  markConflict,
  markDeadLetter,
  getPendingOperations,
  updateRetrySchedule,
  clearConfirmed,
  getQueueStats,
  loadQueue,
  saveQueue,
  loadDeadLetter,
  saveDeadLetter,
  findPending,
  createOperation
};

window.loyaltySyncQueue = loyaltySyncQueue;
