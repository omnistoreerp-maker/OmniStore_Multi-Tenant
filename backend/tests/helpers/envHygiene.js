'use strict';

// ENV HYGIENE — makes every test file hermetic regardless of execution order.
//
// Several suites enable feature flags (ENABLE_BRANCH_ISOLATION,
// ENABLE_TENANT_* , AUTH_REQUIRED, ...) in beforeAll. When jest reuses one
// worker process for many suites (--runInBand or worker reuse), any env left
// dirty by one file silently changes the behaviour of every file that runs
// after it in the same process (observed as cross-suite 404/permission
// regressions that never reproduce when suites run alone).
//
// The snapshot below is taken once per test file (setupFilesAfterEnv runs
// before the file body), and the registered afterAll restores the exact
// snapshot after the file finishes. Files that manage their own env keep
// working: their own beforeAll/afterAll run inside this envelope, and the
// restore only fires after the file's own teardown.

const SNAPSHOT = {};
for (const key of Object.keys(process.env)) SNAPSHOT[key] = process.env[key];

afterAll(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in SNAPSHOT)) delete process.env[key];
  }
  for (const key of Object.keys(SNAPSHOT)) {
    if (process.env[key] !== SNAPSHOT[key]) process.env[key] = SNAPSHOT[key];
  }
});
