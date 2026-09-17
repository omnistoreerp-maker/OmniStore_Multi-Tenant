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

  // 3B.2-A — ASYNC CONTRACT.
  //
  // Promise-based counterparts of the synchronous API above. In this phase
  // they delegate to the still-synchronous JSON engine (wrapped in resolved
  // promises), so behavior is byte-for-byte identical. The INTERFACE is what
  // a future PostgreSQL adapter implements: same signatures, real
  // asynchronous I/O, no caller changes.
  async readAsync(name) {
    return storageEngine.read(name);
  },

  async writeAsync(name, data) {
    return storageEngine.write(name, data);
  },

  // Fresh durable-state read bypassing the read cache (whole-document diff
  // baseline). In PostgreSQL this is a plain SELECT of the full table — no
  // caller-visible difference.
  async readRawAsync(name) {
    return storageEngine.readRaw(name);
  },

  async ensureDirAsync() {
    return storageEngine._ensureDir();
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