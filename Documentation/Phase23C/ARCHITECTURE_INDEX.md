# Phase 23C — Architecture Index

**Repository:** E:\Projects\ESO
**Baseline:** phase23b-stable (tag e66b6fd)
**Date:** 2026-08-05
**Status:** Documentation Only — No Code Changes

---

## Architecture Documents

| Document | Purpose | Status | Dependencies | Roadmap Section | Completion |
|----------|---------|--------|--------------|-----------------|------------|
| `PHASE23C_ARCHITECTURE.md` | Runtime architecture (frontend → adapter → backend → DB) | Complete | None | 23C-1.1 | 100% |
| `PHASE23C_ADAPTER_ARCHITECTURE.md` | Adapter architecture (backendApi, digitronicsDataAdapter, sync engine) | Complete | PHASE23C_ARCHITECTURE.md | 23C-1.2 | 100% |
| `PHASE23C_LAYER_SEPARATION.md` | Layer separation (presentation → business → data → persistence) | Complete | PHASE23C_ARCHITECTURE.md | 23C-1.3 | 100% |
| `PHASE23C_DEPENDENCY_GRAPH.md` | Dependency graph (modules, adapters, services, controllers) | Complete | PHASE23C_ARCHITECTURE.md | 23C-1.4 | 100% |
| `PHASE23C_CONFIGURATION_ARCHITECTURE.md` | Configuration (env vars, feature flags, defaults, gaps) | Complete | PHASE23C_ARCHITECTURE.md | 23C-1.5 | 100% |
| `PHASE23C_TECHNICAL_DEBT.md` | Technical debt inventory (11 items, severity, effort, resolution) | Complete | None | 23C-2 | 100% |
| `PHASE23C_SECURITY_ARCHITECTURE.md` | Security controls, gaps, target state, CSRF design | Complete | None | 23C-3 | 100% |
| `ARCHITECTURE_DECISIONS.md` | Architecture Decision Records (ADR-001 through ADR-007) | Complete | None | 23C-4 | 100% |

---

## Document Descriptions

### PHASE23C_ARCHITECTURE.md

**Purpose:** Documents the complete runtime architecture of the DigiTronics ERP system, including:
- Frontend layer (index.html, DigiTronics_v5.html)
- Adapter layer (backendApi, digitronicsDataAdapter)
- Backend layer (Express, routes, controllers, services)
- Persistence layer (fileStore, JSON files)
- Authentication flow
- Configuration architecture
- Data flow diagrams
- Error handling flow
- Security architecture

**Status:** Complete
**Dependencies:** None ( foundational document )
**Roadmap Section:** 23C-1.1 (Runtime Architecture)

---

### PHASE23C_ADAPTER_ARCHITECTURE.md

**Purpose:** Documents the adapter architecture in detail, including:
- backendApi structure (13 modules + auth)
- digitronicsDataAdapter structure (unified API)
- Sync engine pattern (push/pull, conflict resolution)
- USE_BACKEND flag behavior
- Adapter fallback chain (Backend → Supabase → Local)
- Adapter relationship diagram

**Status:** Complete
**Dependencies:** PHASE23C_ARCHITECTURE.md (references runtime architecture)
**Roadmap Section:** 23C-1.2 (Adapter Architecture)

---

### PHASE23C_LAYER_SEPARATION.md

**Purpose:** Documents the layer separation architecture, including:
- Presentation layer (HTML, CSS, UI logic)
- Business layer (validation, rules, calculations)
- Data layer (adapters, sync engine)
- Persistence layer (backend services, JSON files)
- Layer violations analysis
- Layer communication patterns

**Status:** Complete
**Dependencies:** PHASE23C_ARCHITECTURE.md (references runtime architecture)
**Roadmap Section:** 23C-1.3 (Layer Separation)

---

### ARCHITECTURE_DECISIONS.md

**Purpose:** Documents all major architecture decisions using ADR format, including:
- ADR-001: Dual HTML Architecture
- ADR-002: USE_BACKEND Runtime Switch
- ADR-003: Backend Adapter Layer
- ADR-004: Phase23C Architecture Only
- ADR-005: HTML Consolidation → Phase23D
- ADR-006: Legacy Cleanup → Phase23E
- ADR-007: Performance Optimization → Phase23F

**Status:** Complete
**Dependencies:** None (standalone decision document)
**Roadmap Section:** 23C-4 (Design Decision Records)

---

## Roadmap Reference

From `PHASE23C_ROADMAP.md`:

### 23C-1: Current Architecture Documentation

| # | Task | Status |
|---|------|--------|
| 1 | Document runtime architecture (frontend → adapter → backend → DB) | Complete |
| 2 | Document adapter architecture (backendApi vs digitronicsDataAdapter) | Complete |
| 3 | Document layer separation (presentation → business → data → persistence) | Complete |
| 4 | Create dependency graph (modules, adapters, services, controllers) | Complete |
| 5 | Document configuration architecture (env vars, flags, defaults) | Complete |

### 23C-2: Technical Debt Inventory

| # | Task | Status |
|---|------|--------|
| 1 | Classify debt items (Critical/Medium/Low) | Complete |
| 2 | Document critical debt items | Complete |
| 3 | Document medium debt items | Complete |
| 4 | Document low debt items | Complete |

### 23C-3: Security Architecture

| # | Task | Status |
|---|------|--------|
| 1 | Document current security controls | Complete |
| 2 | Document security gaps | Complete |
| 3 | Design target security architecture | Complete |
| 4 | Create security hardening plan | Complete |
| 5 | Design CSRF protection | Complete |

### 23C-4: Design Decision Records

| # | Task | Status |
|---|------|--------|
| 1 | ADR-001: Dual HTML Architecture | Complete |
| 2 | ADR-002: USE_BACKEND Runtime Switch | Complete |
| 3 | ADR-003: Backend Adapter Layer | Complete |
| 4 | ADR-004: Phase23C Architecture Only | Complete |
| 5 | ADR-005: HTML Consolidation → Phase23D | Complete |
| 6 | ADR-006: Legacy Cleanup → Phase23E | Complete |
| 7 | ADR-007: Performance Optimization → Phase23F | Complete |

---

## Checklist Reference

From `PHASE23C_CHECKLIST.md`:

### 23C-1.1: Runtime Architecture

- [x] Document frontend layer (index.html, DigiTronics_v5.html)
- [x] Document adapter layer (backendApi, digitronicsDataAdapter)
- [x] Document backend layer (controllers, services, routes)
- [x] Document persistence layer (JSON files, database)
- [x] Create architecture diagram (text-based)
- [x] Document data flow (frontend → adapter → backend → DB)
- [x] Document error handling flow
- [x] Document authentication flow

### 23C-1.2: Adapter Architecture

- [x] Document backendApi structure (13 modules)
- [x] Document digitronicsDataAdapter structure (13 modules)
- [x] Document sync engine pattern
- [x] Document USE_BACKEND flag behavior
- [x] Document adapter fallback (Supabase → backend)
- [x] Create adapter relationship diagram

### 23C-1.3: Layer Separation

- [x] Document presentation layer (HTML, CSS, UI logic)
- [x] Document business layer (validation, rules, calculations)
- [x] Document data layer (adapters, sync engine)
- [x] Document persistence layer (backend services, JSON files)
- [x] Identify layer violations (if any)
- [x] Document layer communication patterns

### 23C-1.4: Dependency Graph

- [x] List all modules (13 data modules)
- [x] List all adapters (backendApi, digitronicsDataAdapter)
- [x] List all backend services (13 services)
- [x] List all backend controllers (13 controllers)
- [x] Map module dependencies
- [x] Create dependency graph (text-based)
- [x] Identify circular dependencies (if any)
- [x] Identify tight coupling (if any)

### 23C-1.5: Configuration Architecture

- [x] Document environment variables (backend/config.js)
- [x] Document feature flags (USE_BACKEND)
- [x] Document default values (AUTH_REQUIRED, JWT_SECRET)
- [x] Document configuration sources (env, localStorage, hardcoded)
- [x] Create configuration matrix
- [x] Identify configuration gaps

### 23C-2.1: Debt Classification

- [x] Review Investigation Report Section 3 (Architectural Debt)
- [x] Classify each debt item as Critical/Medium/Low
- [x] Map debt to affected files
- [x] Map debt to line ranges (if applicable)
- [x] Estimate effort for each debt item
- [x] Identify dependencies between debt items
- [x] Create debt tracking spreadsheet

### 23C-2.2: Critical Debt Items

- [x] Document: manifest.json references DigiTronics_v5.html
- [x] Document: AUTH_REQUIRED defaults to false
- [x] Document: Two HTML files maintained simultaneously
- [x] Estimate effort for each
- [x] Identify resolution strategy for each

### 23C-2.3: Medium Debt Items

- [x] Document: ~30 direct Supabase calls remain
- [x] Document: No CSRF protection
- [x] Document: SW cache name mismatch
- [x] Document: 363-line drift between HTML files
- [x] Estimate effort for each
- [x] Identify resolution strategy for each

### 23C-2.4: Low Debt Items

- [x] Document: Backup files in repository
- [x] Document: .bak files in root
- [x] Document: Vercel no-cache headers
- [x] Document: Monolithic HTML (37K lines)
- [x] Estimate effort for each
- [x] Identify resolution strategy for each

### 23C-3.1: Current Security Controls

- [x] Document JWT access + refresh tokens
- [x] Document token revocation blacklist
- [x] Document rate limiting (global + login)
- [x] Document Helmet.js security headers
- [x] Document body sanitization
- [x] Document production error masking
- [x] Create security controls matrix

### 23C-3.2: Security Gaps

- [x] Document: AUTH_REQUIRED defaults to false
- [x] Document: No CSRF protection
- [x] Document: Supabase anon key exposed in HTML
- [x] Document: Open CORS when not configured
- [x] Estimate risk for each gap
- [x] Identify mitigation for each gap

### 23C-3.3: Target Security Architecture

- [x] Design: AUTH_REQUIRED defaults to true
- [x] Design: CSRF protection for cookie-based flows
- [x] Design: CORS_ORIGINS defaults to localhost
- [x] Design: Input length validation per field
- [x] Create target security architecture diagram

### 23C-3.4: Security Hardening Plan

- [x] Phase 1: Document AUTH_REQUIRED requirement
- [x] Phase 2: Add CSRF protection
- [x] Phase 3: Default CORS_ORIGINS to localhost
- [x] Phase 4: Remove Supabase keys from HTML
- [x] Phase 5: Add input length validation
- [x] Estimate effort for each phase
- [x] Identify dependencies between phases

### 23C-3.5: CSRF Protection Design

- [x] Design CSRF token generation
- [x] Design CSRF token validation
- [x] Design Bearer token bypass
- [x] Design cookie storage (httpOnly)
- [x] Design frontend integration (X-CSRF-Token header)
- [x] Create CSRF protection flow diagram

### 23C-4.1: ADR — Single HTML File Entry Point

- [x] Document context (two HTML files)
- [x] Document decision (single entry point)
- [x] Document consequences (PWA update, cache invalidation)
- [x] Document alternatives considered

### 23C-4.2: ADR — Backend Adapter Pattern

- [x] Document context (14 modules migrated)
- [x] Document decision (adapter pattern)
- [x] Document consequences (sync engine, USE_BACKEND flag)
- [x] Document alternatives considered

### 23C-4.3: ADR — Feature Flag Architecture

- [x] Document context (USE_BACKEND flag)
- [x] Document decision (localStorage-based flag)
- [x] Document consequences (default false, user opt-in)
- [x] Document alternatives considered

### 23C-4.4: ADR — Security Defaults

- [x] Document context (AUTH_REQUIRED defaults to false)
- [x] Document decision (document requirement, plan change)
- [x] Document consequences (breaking change for deployments)
- [x] Document alternatives considered

### 23C-4.5: ADR — Deprecation Strategy

- [x] Document context (legacy code removal)
- [x] Document decision (Deprecate → Archive → Delete)
- [x] Document consequences (safe removal, recovery point)
- [x] Document alternatives considered

---

## Future Architecture Documents

When creating new architecture documents, add them to this index with:

| Column | Description |
|--------|-------------|
| Document | Filename (e.g., `PHASE23C_LAYER_SEPARATION.md`) |
| Purpose | Brief description of what the document covers |
| Status | Complete / In Progress / Pending |
| Dependencies | Other documents that must be completed first |
| Roadmap Section | Which roadmap task this fulfills |
| Completion | Percentage complete |

---

*Index generated: 2026-08-05*
*Tag: phase23b-stable*
*Commit: e66b6fd*
