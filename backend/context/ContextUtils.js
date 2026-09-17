'use strict';

// ContextUtils —— small pure helpers for the request context domain.
//
// Scaffolded, pure, side-effect free. NOT WIRED INTO THE RUNTIME.

const { isValidRequestId } = require('./ContextTypes');

// Very light normalization; no I/O, no entropy source of its own.
function normalizeRequestId(id) {
  if (id == null) return null;
  return String(id).trim();
}

function safeRequestId(id) {
  const norm = normalizeRequestId(id);
  return isValidRequestId(norm) ? norm : null;
}

module.exports = {
  normalizeRequestId,
  safeRequestId
};