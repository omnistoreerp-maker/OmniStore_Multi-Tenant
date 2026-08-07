'use strict';

// ContextStore —— storage interface for request contexts (interface only).
//
// This is an ABSTRACT INTERFACE with NO implementation. Future strategies
// (e.g. AsyncLocalStorage-backed, request-scoped) may implement these
// contracts. It is NOT wired into the runtime and holds no state.

const { ContextError } = require('./ContextErrors');

class ContextStore {
  // Store a context under a key.
  // eslint-disable-next-line no-unused-vars
  set(_key, _context) {
    throw new ContextError('CONTEXT_STORE_NOT_IMPLEMENTED', 'ContextStore.set not implemented');
  }

  // Retrieve a stored context, or null when absent.
  // eslint-disable-next-line no-unused-vars
  get(_key) {
    throw new ContextError('CONTEXT_STORE_NOT_IMPLEMENTED', 'ContextStore.get not implemented');
  }

  // Remove a stored context.
  // eslint-disable-next-line no-unused-vars
  clear(_key) {
    throw new ContextError('CONTEXT_STORE_NOT_IMPLEMENTED', 'ContextStore.clear not implemented');
  }
}

module.exports = ContextStore;