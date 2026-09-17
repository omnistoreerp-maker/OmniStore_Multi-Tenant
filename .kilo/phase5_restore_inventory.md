## PHASE5_RESTORE_INVENTORY

CURRENT_HEAD: 105067c9a636ec1c483cc5b6ff5bf16000f57eba
PARENT: c98b2425e89e90c3471987cb7eb24bafb37db3c7

---

## REQUIRED_PHASE5_FILES

Files deleted by commit 105067c that currently exist in the working tree and are required by the Phase 5 Platform MVP contract:

| Path | Why Required | Deleted By 105067c | Currently Present |
|------|-------------|-------------------|-------------------|
| platform.html | Phase 5 platform home entry point | Yes | Yes |
| business.html | Business onboarding / public provisioning | Yes | Yes |
| platform/platform.css | Platform PWA/styling asset | Yes | Yes |
| platform/platform.js | Platform PWA/JS asset | Yes | Yes |
| backend/controllers/platformPublic.controller.js | Public platform API controller | Yes | Yes |
| backend/routes/platformPublic.routes.js | Public platform API routes | Yes | Yes |
| backend/services/platformCatalog.service.js | Platform catalog data service | Yes | Yes |
| backend/data/platformPublic.json | Platform catalog seed/runtime data | Yes | Yes |
| backend/tests/platformMvp.test.js | Phase 5 platform MVP contract test | Yes | Yes |
| backend/tests/platformPublic.test.js | Public API tests | Yes | Yes |
| backend/tests/frontendBackendDefault.test.js | Frontend backend default test | Yes | Yes |
| backend/controllers/platformIntegration.controller.js | Platform integration API controller | Yes | Yes |
| backend/routes/platformIntegration.routes.js | Platform integration API routes | Yes | Yes |
| backend/services/platformIntegration/availabilityIntegration.service.js | Integration service | Yes | Yes |
| backend/services/platformIntegration/companyIntegration.service.js | Integration service | Yes | Yes |
| backend/services/platformIntegration/offerIntegration.service.js | Integration service | Yes | Yes |
| backend/services/platformIntegration/productIntegration.service.js | Integration service | Yes | Yes |
| backend/services/platformIntegration/serviceIntegration.service.js | Integration service | Yes | Yes |

---

## OPTIONAL_FILES

None identified at this time. All Phase 5 platform files are classified as REQUIRED.

---

## EXCLUDED_UNRELATED

Files deleted by 105067c that exist in the working tree but are NOT part of the Phase 5 Platform MVP contract. These should remain excluded:

| Path | Reason for Exclusion |
|------|---------------------|
| marketplace/* (all files) | Owned by Device 2; not Phase 5 Platform MVP |
| gameHosting/* (all files) | Owned by Device 2; not Phase 5 Platform MVP |
| playstation/* (all files) | Not Phase 5 Platform MVP |
| loyalty/* (all files) | Not Phase 5 Platform MVP |
| companyProfile/* (all files) | Not Phase 5 Platform MVP |
| customerRequest/* (all files) | Not Phase 5 Platform MVP |
| internalChangeCenter/* (all files) | Not Phase 5 Platform MVP |
| company/* (all frontend files) | Legacy frontend; replaced by Phase 5 |
| customer/* (all frontend files) | Legacy frontend; replaced by Phase 5 |
| internal/* (all frontend files) | Legacy frontend; replaced by Phase 5 |
| market/* (all frontend files) | Legacy frontend; replaced by Phase 5 |
| backend/services/release.service.js | Not Phase 5 Platform MVP |
| backend/services/buildIdentity.service.js | Not Phase 5 Platform MVP |
| backend/repositories/loyalty.repository.js | Not Phase 5 Platform MVP |
| backend/middleware/marketAuth.js | Not Phase 5 Platform MVP |
| backend/utils/asyncLock.js | Utility for removed features |
| backend/utils/asyncMutex.js | Utility for removed features |
| backend/utils/marketJwt.js | Utility for removed features |
| backend/services/platformIntegration/index.js | Integration index; not strictly required |
| backend/tests/market.test.js | Test for removed feature |
| backend/tests/marketM2.test.js | Test for removed feature |
| backend/tests/marketM4.test.js | Test for removed feature |
| backend/tests/marketM4.test.js | Test for removed feature |
| backend/tests/gameHosting.* (all) | Tests for removed feature |
| backend/tests/playstation.* (all) | Tests for removed feature |
| backend/tests/loyalty.* (all) | Tests for removed feature |
| backend/tests/companyProfile.test.js | Test for removed feature |
| backend/tests/customerRequest.test.js | Test for removed feature |
| backend/tests/internalChangeCenter.test.js | Test for removed feature |
| backend/tests/frontendBackendDefault.test.js | Already in commit as modified |
| backend/tests/platformPublic.test.js | Already in commit as modified |

---

## EXCLUDED_GENERATED

| Path | Reason |
|------|--------|
| .freebuff/ | Generated/temp directory |
| .kilo/ | Generated/temp directory |
| .freebuffpreview-c17e3314-cc80-464f-81cd-e8a0f0eb673c.log.err | Generated log file |
| backend/debug-test.js | Debug scratch file |
| diffnames.txt | Generated artifact |
| diffstat.txt | Generated artifact |
| test-summary.txt | Generated artifact |
| package-lock.json | Generated dependency lock |
| setup-ssh.sh | Unrelated setup script |
| OMNISTORE_CUSTOMER_HOTFIX_REPORT.md | Unrelated documentation |
| PHASE72_DISCOVERY.txt | Unrelated documentation |
| 04_INTEGRATION_WORK/ | Unrelated documentation |
| 07_MARKETPLACE_RELEASE/ | Unrelated documentation |
| 08_TEST_REPORTS/ | Unrelated documentation |
| docs/PHASE35_*.md | Unrelated documentation |
| docs/PHASE36_*.md | Unrelated documentation |

---

## RUNTIME_DATA

| Path | Reason |
|------|--------|
| backend/data/companyProfile.json | Runtime data; regenerated on boot |
| backend/data/marketConfig.json | Runtime data; regenerated on boot |
| backend/data/updateManifest.json | Runtime data |
| backend/data/platformPublic.json | Runtime seed data; required for tests |

Note: `backend/data/platformPublic.json` is classified as REQUIRED because it serves as seed/runtime data needed for the Phase 5 platformPublic API and tests.

---

## CRITICAL_MISSING_FILES

**PRODUCTION-BREAKING ISSUE:** The committed `backend/server.js` (in 105067c) still contains `require()` statements and `app.use()` mounts for modules that were deleted in the same commit. This means the committed code will fail to start with `Cannot find module` errors.

Specifically, server.js requires:
- `backend/controllers/companyProfile.controller.js` (DELETED)
- `backend/controllers/customerRequest.controller.js` (DELETED)
- `backend/controllers/internalChangeCenter.controller.js` (DELETED)
- `backend/controllers/platformIntegration.controller.js` (DELETED)
- `backend/controllers/gameHosting.controller.js` (DELETED)
- `backend/controllers/market.controller.js` (DELETED)
- `backend/controllers/loyalty.controller.js` (DELETED)
- `backend/controllers/playstation.controller.js` (DELETED)
- `backend/routes/companyProfile.routes.js` (DELETED)
- `backend/routes/customerRequest.routes.js` (DELETED)
- `backend/routes/internalChangeCenter.routes.js` (DELETED)
- `backend/routes/platformIntegration.routes.js` (DELETED)
- `backend/routes/gameHosting.routes.js` (DELETED)
- `backend/routes/market.routes.js` (DELETED)
- `backend/routes/loyalty.routes.js` (DELETED)
- `backend/routes/playstation.routes.js` (DELETED)
- `backend/services/companyProfile.service.js` (DELETED)
- `backend/services/customerRequest.service.js` (DELETED)
- `backend/services/internalChangeCenter.service.js` (DELETED - note: this file does NOT exist even in working tree)
- `backend/services/gameHosting.service.js` (DELETED)
- `backend/services/gamesCatalog.service.js` (DELETED)
- `backend/services/loyalty.service.js` (DELETED)
- `backend/services/marketAuth.service.js` (DELETED)
- `backend/services/marketCatalog.service.js` (DELETED)
- `backend/services/marketCheckout.service.js` (DELETED)
- `backend/services/marketConfig.service.js` (DELETED)
- `backend/services/marketOrder.service.js` (DELETED)
- `backend/services/marketOrderStateMachine.service.js` (DELETED)
- `backend/services/platformCatalog.service.js` (DELETED but REQUIRED for Phase 5)
- `backend/services/platformIntegration/index.js` (DELETED)
- `backend/services/playstationDevices.service.js` (DELETED)
- `backend/services/playstationPricing.service.js` (DELETED)
- `backend/services/playstationSessions.service.js` (DELETED)
- `backend/services/ps4Host.service.js` (DELETED)
- `backend/services/release.service.js` (DELETED)
- `backend/services/buildIdentity.service.js` (DELETED)
- `backend/middleware/marketAuth.js` (DELETED)
- `backend/repositories/loyalty.repository.js` (DELETED)
- `backend/utils/asyncLock.js` (DELETED)
- `backend/utils/asyncMutex.js` (DELETED)
- `backend/utils/marketJwt.js` (DELETED)

---

## COMMIT_REPAIR_PLAN

### What must be restored/staged:
1. **Phase 5 Platform MVP files** (18 files listed in REQUIRED_PHASE5_FILES above)
2. **Test files** required by Phase 5 contract:
   - backend/tests/platformMvp.test.js
   - backend/tests/platformPublic.test.js
   - backend/tests/frontendBackendDefault.test.js

### What must remain untouched:
1. Security/tenant hardening modifications already in 105067c (do not revert)
2. Modified core files already in 105067c (apiKey, webhook, employees, etc.)
3. Feature files owned by Device 2 (Marketplace, Game Hosting)
4. All unrelated/generated/temp files

### Whether amend is safe:
**NO.** Amending 105067c is not safe because:
1. The commit contains both Phase 5 fixes AND deletions of unrelated features
2. Amending would mix Phase 5 restoration with unrelated cleanup
3. A new corrective commit is cleaner and preserves the audit trail

### Recommended approach:
Create a **new corrective commit** on top of 105067c that:
1. Restores ONLY the Phase 5 Platform MVP files listed above
2. Does NOT restore unrelated feature files (Marketplace, Game Hosting, etc.)
3. Does NOT modify any existing files

**However**, there is a blocking issue: the committed server.js requires modules that are not in the commit. The corrective commit must ALSO fix server.js to remove requires for deleted features, OR include all required modules.

Given the user's instruction "Only include files explicitly required by the Phase 5 Platform MVP contract", the correct approach is:
1. Create a corrective commit that restores Phase 5 files
2. Also modify server.js to remove requires for deleted features (this is a required change, not a Phase 5 contract file, but it's necessary for the server to start)

---

## RELEASE_RISK: **HIGH**

The current commit 105067c is **NOT releasable** because:
1. It deletes ~119 files that are required for the server to start
2. The committed server.js will crash with "Cannot find module" errors
3. The Phase 5 platform files (platform.html, business.html, etc.) are missing from the commit
4. The working tree contains the required Phase 5 files, but they are not in the commit

---

## RECOMMENDATION:

**DO NOT RELEASE commit 105067c.**

Create a new corrective commit on top of 105067c that:
1. Restores the 18 Phase 5 Platform MVP files listed above
2. Fixes server.js to remove requires for deleted feature modules (Marketplace, Game Hosting, PlayStation, Loyalty, Company Profile, Customer Request, Internal Change Center)
3. Does NOT restore unrelated feature files owned by Device 2

This approach preserves the security/tenant hardening work in 105067c while completing the Phase 5 platform restoration.

STOP. Do not make changes and wait for approval.
