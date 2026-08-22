'use strict';

// Test-only dotenv stub, wired via jest.config.js `moduleNameMapper`.
//
// The Jest suites control every OmniStore feature/isolation flag explicitly
// through `process.env`. Loading the developer's real `backend/.env` inside
// the test process is the proven root cause of contamination: dotenv.config()
// re-injects flag values that a test has just `delete`d, defeating the
// test's explicit OFF state and silently forcing isolation ON.
//
// This stub makes `dotenv.config()` a deterministic no-op so the ONLY source
// of configuration is what the test process sets itself. It affects nothing
// outside Jest — `moduleNameMapper` is a Jest-only resolution rule, so the
// real `dotenv` (and the real `backend/.env`) remains in full effect for
// production and development server boots.
function noopConfig() {
  return { parsed: {}, error: null };
}

module.exports = {
  config: noopConfig,
  load: noopConfig,
  reset: noopConfig,
  parse: function () { return {}; }
};
