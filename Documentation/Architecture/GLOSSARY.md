# GLOSSARY.md
## DigiTronics V2 Enterprise Architecture Glossary

**Date:** 2026-08-05
**Status:** APPROVED
**Authority:** ADR-001, ADR-002

---

## 1. CORE CONCEPTS

### Tenant
**Definition:** A company or organization that uses the DigiTronics V2 platform.
**Context:** ADR-002 (Tenant Model)
**Examples:** Acme Corp, TechStart Inc, Global Retail LLC
**Properties:** id, name, slug, settings, plan, status

### Branch
**Definition:** A physical location or office within a tenant.
**Context:** ADR-002 (Tenant Model)
**Examples:** Main Office, Downtown Store, Warehouse District
**Properties:** id, tenant_id, name, address, phone, status

### Warehouse
**Definition:** A storage facility within a branch.
**Context:** ADR-002 (Tenant Model)
**Examples:** Main Warehouse, Distribution Center, Cold Storage
**Properties:** id, branch_id, tenant_id, name, location, status

### Hierarchy
**Definition:** The organizational structure: Tenant → Branch → Warehouse.
**Context:** ADR-002 (Tenant Model)
**Relationship:** Each tenant has one or more branches; each branch has one or more warehouses.

---

## 2. AUTHORIZATION

### Role
**Definition:** A named set of permissions assigned to users.
**Context:** ADR-001 (Role Model)
**Examples:** Super Admin, Tenant Admin, Manager, Sales, Warehouse, Accountant, Support, Viewer
**Properties:** id, name, display_name, permissions, description

### Permission
**Definition:** A specific access right granted to a role.
**Context:** ADR-001 (Role Model)
**Format:** resource:action (e.g., products:read, invoices:write)
**Properties:** id, name, resource, action, description

### RBAC
**Definition:** Role-Based Access Control. Authorization model where permissions are assigned to roles, and roles are assigned to users.
**Context:** Phase 24 Authorization Design
**Implementation:** backend/middleware/authorize.js

### Role Hierarchy
**Definition:** The inheritance structure of roles from highest to lowest privilege.
**Context:** ADR-001 (Role Model)
**Hierarchy:**
```
Super Admin
  └── Tenant Admin
        ├── Manager
        │     ├── Sales
        │     ├── Warehouse
        │     └── Accountant
        └── Support
              └── Viewer
```

### Permission Inheritance
**Definition:** The mechanism by which child roles inherit permissions from parent roles.
**Context:** ADR-001 (Role Model)
**Rule:** Child roles inherit all parent permissions but cannot exceed parent privileges.

### Role Alias
**Definition:** A backward-compatible mapping from old role names to new role names.
**Context:** ADR-001 (Role Model)
**Examples:** Owner → Super Admin, Admin → Tenant Admin

---

## 3. AUTHENTICATION

### JWT
**Definition:** JSON Web Token. A compact, URL-safe means of representing claims to be transferred between two parties.
**Context:** Phase 24 Authentication Design
**Implementation:** backend/utils/jwt.js
**Components:** Header, Payload, Signature

### OAuth2
**Definition:** An open standard for access delegation. Allows third-party applications to obtain limited access to user accounts.
**Context:** Phase 24 (New Feature)
**Providers:** Google, GitHub
**Flow:** Authorization Code Grant

### MFA
**Definition:** Multi-Factor Authentication. A security system that requires more than one method of authentication.
**Context:** Phase 24 (New Feature)
**Methods:** TOTP (Time-based One-Time Password), SMS

### API Key
**Definition:** A unique identifier used to authenticate a user, developer, or calling program.
**Context:** Phase 24 (New Feature)
**Format:** digi_live_abc123def456ghi789
**Storage:** SHA-256 hashed

### Webhook
**Definition:** A user-defined HTTP callback triggered by specific events.
**Context:** Phase 24 (New Feature)
**Events:** user.created, tenant.updated, role.changed

### Service Account
**Definition:** A special type of account used by applications or services to interact with the API.
**Context:** Phase 24 (New Feature)
**Use Case:** Automated integrations, CI/CD pipelines

---

## 4. TOKENS

### Session
**Definition:** A temporary interaction between a user and the system.
**Context:** Phase 24 Authentication Design
**Storage:** In-memory (current), Redis (future)

### Refresh Token
**Definition:** A long-lived token used to obtain new access tokens without re-authentication.
**Context:** Phase 24 Authentication Design
**TTL:** 7 days
**Storage:** HttpOnly cookie

### Access Token
**Definition:** A short-lived token used to access protected resources.
**Context:** Phase 24 Authentication Design
**TTL:** 15 minutes
**Storage:** Memory only

### Token Revocation
**Definition:** The process of invalidating a token before its expiration.
**Context:** Phase 24 Security Model
**Implementation:** backend/utils/tokenStore.js (in-memory Set)

---

## 5. USER TYPES

### Application User
**Definition:** A human user who accesses the system through the web interface.
**Context:** Phase 24 Authentication Design
**Authentication:** Email/password + optional MFA

### System User
**Definition:** An automated user (service account) that accesses the system through the API.
**Context:** Phase 24 (New Feature)
**Authentication:** API key

### Support User
**Definition:** A user with limited permissions designed for customer support staff.
**Context:** ADR-001 (Role Model)
**Permissions:** Read-only access to most resources

### Legacy User
**Definition:** A user with one of the original 5 roles (Owner, Admin, Manager, Sales, Viewer).
**Context:** ADR-001 (Role Model)
**Migration:** Automatic alias mapping to new roles

---

## 6. MIGRATION

### Migration
**Definition:** The process of transitioning from one system state to another.
**Context:** ADR-001, ADR-002
**Types:** Role migration, tenant migration, data migration

### Backward Compatibility
**Definition:** The ability of a system to accept inputs or data that were valid for an older version.
**Context:** ADR-001 (Role Model)
**Requirement:** Existing users and integrations must continue to work

### Rollback
**Definition:** The process of reverting to a previous system state.
**Context:** All ADRs
**Trigger:** Issues detected, data corruption, user complaints

### Alias Mapping
**Definition:** A translation table that maps old values to new values.
**Context:** ADR-001 (Role Model)
**Example:** Owner → Super Admin

---

## 7. INFRASTRUCTURE

### Container
**Definition:** A lightweight, standalone, executable package of software.
**Context:** Phase 24 Deployment Strategy
**Technology:** Docker

### Reverse Proxy
**Definition:** A server that sits between clients and backend servers.
**Context:** Phase 24 Deployment Strategy
**Technology:** Nginx

### CI/CD
**Definition:** Continuous Integration / Continuous Deployment.
**Context:** Phase 24 Deployment Strategy
**Technology:** GitHub Actions

### Health Check
**Definition:** A periodic test to verify system availability.
**Context:** Phase 24 Deployment Strategy
**Endpoints:** /api/v1/health, /api/v1/liveness, /api/v1/ready

---

## 8. DATA

### JSON Persistence
**Definition:** Storing data in JSON files on disk.
**Context:** Phase 24 Architecture Baseline
**Implementation:** backend/utils/fileStore.js
**Pattern:** Atomic writes with temp-file-then-rename

### Atomic Write
**Definition:** A write operation that either completes entirely or not at all.
**Context:** Phase 24 Security Model
**Implementation:** Write to temp file, then rename

### mtime Cache
**Definition:** A cache validation strategy using file modification time.
**Context:** Phase 24 Architecture Baseline
**Implementation:** In-memory cache with mtime check

---

## 9. SECURITY

### Rate Limiting
**Definition:** Controlling the number of requests a client can make.
**Context:** Phase 24 Security Model
**Implementation:** express-rate-limit

### CORS
**Definition:** Cross-Origin Resource Sharing. A mechanism that allows restricted resources to be requested from another domain.
**Context:** Phase 24 Security Model
**Implementation:** cors middleware

### Helmet
**Definition:** A middleware that sets various HTTP headers for security.
**Context:** Phase 24 Security Model
**Headers:** X-Content-Type-Options, X-Frame-Options, etc.

### Input Validation
**Definition:** The process of verifying that user input meets expected format and constraints.
**Context:** Phase 24 Security Model
**Implementation:** Joi schemas

### Brute Force Protection
**Definition:** Security measures to prevent automated attacks trying many passwords.
**Context:** Phase 24 Security Model
**Implementation:** Rate limiting + account lockout

---

## 10. TERMINOLOGY MAPPING

| Old Term | New Term | Context |
|----------|----------|---------|
| Owner | Super Admin | ADR-001 |
| Admin | Tenant Admin | ADR-001 |
| Single-tenant | Multi-tenant | ADR-002 |
| localStorage | HttpOnly cookie | Phase 24 |
| Plaintext password | bcrypt hash | Verified |
| No backend | Express.js backend | Verified |
| No API | REST API | Verified |
| No PWA | PWA | Verified |

---

**Document Generated:** 2026-08-05
**Status:** APPROVED
**Authority:** ADR-001, ADR-002
