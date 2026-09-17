'use strict';

// Minimal in-process async mutex. Serializes critical sections (e.g. invoice
// ID allocation + persistence) so concurrent creates cannot both read the same
// max sequence and allocate a duplicate ID. This is single-process safe; the
// OmniStore backend runs as a single Node process per tenant/file store.
class AsyncMutex {
  constructor() {
    this._chain = Promise.resolve();
  }

  // Run `fn` exclusively. Resolves with fn's result; rejections propagate to
  // the caller while the lock is always released so the queue keeps moving.
  runExclusive(fn) {
    const result = this._chain.then(() => fn());
    // Keep the chain alive even if fn rejects, so later callers are not blocked.
    this._chain = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  }
}

module.exports = AsyncMutex;
