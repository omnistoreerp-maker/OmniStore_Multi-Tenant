'use strict';

// Storage adapter — the ONLY place the low-level fileStore engine is used.
// Keeps the storage engine behind a minimal interface so a different
// provider (SQLite, PostgreSQL, Supabase, MongoDB) can be swapped later
// without touching business logic. The fileStore engine itself is never
// modified; this adapter merely delegates to its existing public API.

const storageEngine = require('../utils/fileStore');

const storageAdapter = {
  read(name) {
    return storageEngine.read(name);
  },

  write(name, data) {
    return storageEngine.write(name, data);
  },

  // Storage-level primitives used by infrastructure checks (readiness /
  // health probes). Delegated to the engine; behaviour unchanged.
  ensureDir() {
    return storageEngine._ensureDir();
  },

  path(name) {
    return storageEngine._path(name);
  }
};

module.exports = storageAdapter;