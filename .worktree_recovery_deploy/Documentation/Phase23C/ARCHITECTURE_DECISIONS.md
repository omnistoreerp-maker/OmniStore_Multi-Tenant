# Phase 23C — Architecture Decision Records

**Repository:** E:\Projects\ESO
**Baseline:** phase23b-stable (tag e66b6fd)
**Date:** 2026-08-05
**Status:** Documentation Only — No Code Changes

---

## ADR-001: Dual HTML Architecture

**Decision ID:** ADR-001

**Title:** Maintain Two HTML Entry Points (index.html + DigiTronics_v5.html)

**Context:**
The DigiTronics ERP system currently has two HTML files serving as entry points:
- `index.html` (37,827 lines) — Primary entry point, served by nginx as default
- `DigiTronics_v5.html` (37,464 lines) — Legacy entry point, referenced by manifest.json

Both files contain identical Phase 23B migration points (93 each) and identical sync engine registrations (13 modules). However, they have 363 lines of drift in non-Phase-23B areas (CSS differences, feature variations).

**Alternatives Considered:**
1. **Merge immediately** — Combine both files into one during Phase 23B
2. **Keep separate permanently** — Maintain both files indefinitely
3. **Defer consolidation** — Keep separate now, consolidate in dedicated phase

**Chosen Decision:** Option 3 — Defer consolidation to Phase 23D

**Reason:**
- Phase 23B migration was the priority; HTML merge would have increased risk
- Consolidation requires careful diff analysis to preserve all features
- Dedicated phase allows proper testing and rollback procedures
- PWA considerations (manifest.json, Service Worker) need coordinated update

**Consequences:**
- Positive: Phase 23B completed faster with lower risk
- Positive: Each file can be validated independently
- Negative: Maintenance burden of two files until Phase 23D
- Negative: Feature drift may continue until consolidation

**Future Impact:**
Phase 23D will consolidate to single HTML entry point (index.html).

---

## ADR-002: USE_BACKEND Runtime Switch

**Decision ID:** ADR-002

**Title:** localStorage-Based Runtime Feature Flag for Backend Routing

**Context:**
The system needs to route data operations between:
- Local localStorage (legacy mode)
- Supabase (cloud database)
- Backend API (self-hosted server)

This requires a runtime switch that:
- Persists across sessions
- Can be toggled by users
- Defaults to safe behavior (local mode)

**Alternatives Considered:**
1. **Build-time flag** — Compile with BACKEND_ENABLED=true/false
2. **URL parameter** — ?use_backend=true
3. **localStorage flag** — Persist in browser storage
4. **Server-side flag** — Backend decides routing

**Chosen Decision:** Option 3 — localStorage flag

**Reason:**
- User-toggleable without redeployment
- Persists across sessions
- No server dependency for flag state
- Defaults to false (safe offline-first behavior)
- Simple implementation in frontend

**Consequences:**
- Positive: Users can switch modes at runtime
- Positive: No deployment required for mode change
- Positive: Defaults to local mode (safe)
- Negative: Flag state is per-browser (not per-user)
- Negative: Requires UI for toggling

**Future Impact:**
All 13 data modules check `USE_BACKEND` before routing to backend API.

---

## ADR-003: Backend Adapter Layer

**Decision ID:** ADR-003

**Title:** Two-Layer Adapter Architecture (backendApi + digitronicsDataAdapter)

**Context:**
After Phase 23B migration, the frontend needs to:
- Call backend REST API for CRUD operations
- Fall back to Supabase or local storage when backend unavailable
- Maintain sync between local and server state
- Handle authentication and error recovery

**Alternatives Considered:**
1. **Direct backendApi calls** — Use backendApi directly in render functions
2. **Single unified adapter** — One adapter handling all data sources
3. **Two-layer adapters** — backendApi (HTTP) + digitronicsDataAdapter (unified)

**Chosen Decision:** Option 3 — Two-layer adapters

**Reason:**
- Separation of concerns: HTTP client vs. data access logic
- backendApi handles HTTP, auth, error responses
- digitronicsDataAdapter handles fallback logic, sync, normalization
- Easier to test each layer independently
- Can add new data sources without changing HTTP layer

**Consequences:**
- Positive: Clear separation of HTTP and data logic
- Positive: Fallback chain is centralized in one place
- Positive: Sync engine integrated at adapter level
- Negative: Extra abstraction layer
- Negative: More code to maintain

**Future Impact:**
All module operations go through digitronicsDataAdapter, which delegates to backendApi when USE_BACKEND=true.

---

## ADR-004: Phase23C Architecture Only

**Decision ID:** ADR-004

**Title:** Phase 23C Restricted to Architecture Documentation Only

**Context:**
After Phase 23B completion, multiple post-migration tasks remain:
- HTML consolidation
- Security hardening
- Legacy cleanup
- Performance optimization

These tasks have different risk profiles and dependencies. Combining them in one phase increases risk and makes rollback difficult.

**Alternatives Considered:**
1. **All-in-one phase** — Complete all post-migration tasks in Phase 23C
2. **Architecture + implementation** — Mix documentation and code changes
3. **Architecture only** — Restrict Phase 23C to documentation and planning

**Chosen Decision:** Option 3 — Architecture only

**Reason:**
- Lower risk: No code changes during architecture phase
- Better planning: Full understanding before implementation
- Cleaner rollback: Documentation can be deleted without code impact
- Follows Project Constitution: "Architecture phases must NOT contain implementation"

**Consequences:**
- Positive: Zero risk of breaking changes
- Positive: Complete architecture documentation before any code changes
- Positive: Easier review and approval process
- Negative: Implementation deferred to future phases
- Negative: Longer overall timeline

**Future Impact:**
Phase 23C produces only documentation. Implementation happens in 23D, 23E, 23F.

---

## ADR-005: Move HTML Consolidation to Phase23D

**Decision ID:** ADR-005

**Title:** Defer HTML File Consolidation to Dedicated Phase 23D

**Context:**
HTML consolidation involves:
- Merging DigiTronics_v5.html into index.html
- Updating manifest.json references
- Updating Service Worker cache list
- Updating docker-compose.yml mounts
- Archiving DigiTronics_v5.html

This is a high-risk operation requiring:
- Careful diff analysis
- Feature preservation verification
- PWA cache invalidation testing
- Rollback procedures

**Alternatives Considered:**
1. **Include in Phase 23C** — Consolidate during architecture phase
2. **Dedicated phase** — Create Phase 23D specifically for consolidation
3. **Defer indefinitely** — Keep both files indefinitely

**Chosen Decision:** Option 2 — Dedicated Phase 23D

**Reason:**
- HTML merge is high-risk and requires focused attention
- Dedicated phase allows proper testing and validation
- Can create git tag before merge for easy rollback
- PWA considerations need coordinated updates
- Separates concerns: architecture (23C) vs. implementation (23D)

**Consequences:**
- Positive: Focused attention on HTML consolidation
- Positive: Proper testing and rollback procedures
- Positive: Architecture documented before merge
- Negative: Implementation delayed until Phase 23D
- Negative: Two files maintained longer

**Future Impact:**
Phase 23D will execute HTML consolidation with full validation.

---

## ADR-006: Move Legacy Cleanup to Phase23E

**Decision ID:** ADR-006

**Title:** Defer Legacy Code Cleanup to Dedicated Phase 23E

**Context:**
Legacy cleanup includes:
- Removing ~30 direct Supabase calls
- Archiving backup HTML files
- Removing .bak files from repository
- Adding .gitignore entries
- Cleaning up backups/ directory

This follows the Deprecate → Archive → Delete workflow.

**Alternatives Considered:**
1. **Include in Phase 23C** — Clean up during architecture phase
2. **Include in Phase 23D** — Clean up during HTML consolidation
3. **Dedicated phase** — Create Phase 23E specifically for cleanup

**Chosen Decision:** Option 3 — Dedicated Phase 23E

**Reason:**
- Cleanup is lower priority than HTML consolidation
- Requires HTML consolidation to be complete first (some cleanup depends on single HTML)
- Follows Deprecate → Archive → Delete workflow properly
- Separates concerns: architecture (23C) vs. consolidation (23D) vs. cleanup (23E)

**Consequences:**
- Positive: Proper deprecation workflow followed
- Positive: Cleanup happens after consolidation (cleaner state)
- Positive: Lower risk when done in isolation
- Negative: Legacy code remains until Phase 23E
- Negative: Repository clutter persists longer

**Future Impact:**
Phase 23E will execute legacy cleanup with proper deprecation workflow.

---

## ADR-007: Move Performance Optimization to Phase23F

**Decision ID:** ADR-007

**Title:** Defer Performance Optimization to Dedicated Phase 23F

**Context:**
Performance optimization includes:
- Code splitting for non-critical modules
- Vercel cache header alignment
- Virtual scroll integration
- Lazy loading implementation

This requires:
- Performance baselines (measure first)
- Bottleneck identification
- Targeted optimization
- Before/after verification

**Alternatives Considered:**
1. **Include in Phase 23C** — Optimize during architecture phase
2. **Include in Phase 23D** — Optimize during HTML consolidation
3. **Dedicated phase** — Create Phase 23F specifically for optimization

**Chosen Decision:** Option 3 — Dedicated Phase 23F

**Reason:**
- Performance optimization requires measurements first (Project Constitution Rule 8)
- Cannot optimize without baselines
- HTML consolidation should complete first (code splitting depends on single file)
- Lower priority than consolidation and cleanup
- Follows Measure → Benchmark → Optimize workflow

**Consequences:**
- Positive: Proper measurement-first approach
- Positive: Optimization targets identified before implementation
- Positive: Can measure before/after consolidation
- Negative: Performance improvements delayed until Phase 23F
- Negative: Monolithic HTML persists longer

**Future Impact:**
Phase 23F will establish baselines, identify bottlenecks, then optimize.

---

## Decision Summary

| ADR | Title | Status | Phase |
|-----|-------|--------|-------|
| ADR-001 | Dual HTML Architecture | Accepted | Deferred to 23D |
| ADR-002 | USE_BACKEND Runtime Switch | Accepted | Implemented |
| ADR-003 | Backend Adapter Layer | Accepted | Implemented |
| ADR-004 | Phase23C Architecture Only | Accepted | Current phase |
| ADR-005 | HTML Consolidation → Phase23D | Accepted | Planned |
| ADR-006 | Legacy Cleanup → Phase23E | Accepted | Planned |
| ADR-007 | Performance Optimization → Phase23F | Accepted | Planned |

---

*Architecture decisions generated: 2026-08-05*
*Tag: phase23b-stable*
*Commit: e66b6fd*
