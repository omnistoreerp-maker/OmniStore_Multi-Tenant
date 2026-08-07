# Phase 30 Security Architecture

## Reviewed boundaries

- Authentication, RBAC, JWT, sessions, permissions, API and Edge Function authorization.
- Tenant ID, workspace ownership, cross-tenant blocking, URL tampering, request spoofing, and session rotation.
- RLS, indexes, constraints, foreign keys, triggers, functions, and migration integrity.
- Forms, search, filters, uploads, JSON/config imports, provisioning inputs, and authentication inputs.
- Browser/server secret isolation.

The source scan found no embedded JWT, `sb_secret_` key, PostgreSQL connection string, or hardcoded service-role value in production browser files. Server secret variable names remain only inside protected Edge Function code.

Production hosting must enforce HTTPS, CSP and security headers, compression, rate limiting, and cache policy at the hosting/Edge boundary. The in-app checklist verifies these contracts but does not pretend to configure the web server.

## Central audit

The isolated audit contract covers login, logout, customer provisioning, deployment, configuration changes, license changes, updates, and backups. Phase 30 records immutable preview events in memory only; no existing event producer or database was modified.
