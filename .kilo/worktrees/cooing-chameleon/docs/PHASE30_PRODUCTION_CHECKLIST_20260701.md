# Phase 30 Production Checklist

- [ ] HTTPS enforced with HSTS at the production host.
- [ ] CSP delivered as an HTTP header and tested without unsafe wildcard sources.
- [ ] `X-Content-Type-Options`, frame protection, referrer policy, and permissions policy enabled.
- [ ] Compression configured for text assets.
- [ ] Cache policy separates immutable assets, HTML, and sensitive API responses.
- [ ] Service Worker and manifest verified on the production origin.
- [ ] Offline behavior does not expose protected tenant data.
- [ ] Error boundaries and sanitized server logging enabled.
- [ ] Rate limits applied per account, IP, tenant, and privileged action.
- [ ] JWT issuer/audience/expiration verified server-side.
- [ ] RLS and Storage/Realtime policies tested with two real isolated tenants.
- [ ] Service-role and database credentials available only as server environment secrets.
- [ ] Backups verified before release and rollback preview approved.
