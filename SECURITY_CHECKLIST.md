# SECURITY CHECKLIST — DigiTronics production

## Secrets

- [ ] `JWT_SECRET` set to a long (≥32 chars) random value — `checkEnv.js`
      blocks startup in production otherwise.
- [ ] `JWT_REFRESH_SECRET` set explicitly (recommended) or derived.
- [ ] No `.env` committed (`.gitignore` covers it; verify with
      `git check-ignore backend/.env`).
- [ ] Secrets delivered via environment / secret manager, never in
      images or repo (`backend/Dockerfile` copies no `.env`).

## Transport & headers

- [ ] HTTPS terminated at nginx/ingress in front of the backend
      (HTTP config provided in `nginx.conf`; add TLS for production).
- [ ] Security headers active (helmet on the backend; nginx adds
      X-Content-Type-Options, X-Frame-Options, Referrer-Policy,
      Permissions-Policy, CSP).
- [ ] `server_tokens off` at nginx.

## Access control

- [ ] `AUTH_REQUIRED=true` evaluated per environment — `false` preserves
      the legacy open mode by design; enabling it protects all business
      routes with Bearer tokens and write-role guards (Owner/Admin/Manager).
- [ ] `CORS_ORIGINS` set to the real frontend origin(s) instead of open.
- [ ] Default `admin/admin123` seed credentials changed.

## Input & abuse defenses (built-in, verify enabled)

- [ ] JSON body limit (`BODY_LIMIT`, default 10mb).
- [ ] Rate limiting (`RATE_LIMIT_MAX`, default 1000/15min per IP).
- [ ] Body sanitization middleware (prototype-pollution keys stripped).
- [ ] Central schema validation rejects malformed payloads (400).
- [ ] Malformed JSON rejected by the parse-error handler (400, not 500).

## Data safety

- [ ] `backend/data` writable only by the service user.
- [ ] Atomic writes (tmp + rename) — do not disable.
- [ ] Backups encrypted at rest if the store contains sensitive data.
- [ ] Docker/PM2 run as non-root (`digitronics` user in the image).

## Operational

- [ ] `/api/v1/ready` monitored (503 = persistence failure).
- [ ] Logs contain no secrets (health endpoints assert no leakage in
      `backend/tests/health.test.js`).
- [ ] Dependencies audited periodically: `npm audit` (in `backend/`).
