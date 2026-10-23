# Deploy health gate

Standalone health gate for the production deploy script.

## Root cause of `DEPLOY_RESULT=FAILED`

The on-host script `/home/omnistore/omni_deploy_20260920.sh` ends with:

```bash
HEALTH=$(grep -E '^(HEALTH|HEALTH_PATH)=' "$P/backend/.env" ...)
if [ -n "$HEALTH" ]; then HPATH="$HEALTH"; else HPATH=/health; fi
code=$(curl -s -o /dev/null -w '%{http_code}' ... "http://127.0.0.1:${PORT}${HPATH}")
ok="NO"; [ "$ACT" = "active" ] && [ "$code" = "200" ] && ok="YES"
```

`backend/.env` sets `PORT` but no `HEALTH`/`HEALTH_PATH`, so the script probes
`/health`. That route does not exist (404). The documented contract is:

- `GET /api/v1/health` -> `200` with `data.status === "ok"` (`DEPLOYMENT.md`, `GO_LIVE.md`)
- `GET /api/v1/ready` -> `200` with `data.status === "ready"` and `data.persistence === "writable"` (`DEPLOYMENT.md`)

The deploy therefore succeeded while the script reported failure.

## What this change provides

- `health-check.js` — dependency-free Node gate that requires **both** documented
  endpoints to be HTTP 200 with the expected payload. Any non-200, invalid JSON,
  wrong status/persistence, timeout, or connection error fails the gate.
- `health-check.test.cjs` — regression tests, including the exact production
  scenario (`/health` 404 while `/api/v1/health` + `/api/v1/ready` are healthy),
  and asserts that `/health` is never requested.

Run locally:

```bash
npm run test:deploy
# or
node --test scripts/deploy/health-check.test.cjs
```

## Proposed adoption (NOT applied)

The on-host script is outside this repository and must not be edited without a
separate approval. To adopt:

1. Install the gate next to the deploy script, **outside** the application
   checkout, so it remains valid for any candidate SHA:

   ```bash
   install -m 0755 scripts/deploy/health-check.js /home/omnistore/deploy-health-check.js
   ```

2. Replace the health probe block in step 6 with:

   ```bash
   HC=FAIL
   if node /home/omnistore/deploy-health-check.js \
       --base "http://127.0.0.1:${PORT}" --timeout-ms 10000; then
     HC=PASS
   fi
   ok="NO"; [ "$ACT" = "active" ] && [ "$HC" = "PASS" ] && ok="YES"
   ```

3. Report `HEALTH_CHECK=$HC` instead of the old single-URL result.

Do not make the check unconditional, ignore HTTP errors, or treat any response
as healthy: the gate must stay fail-closed.

## Out of scope observation

The on-host script computes `H0d` and `H1d` **both after** `git checkout`
(step 4), so `BACKEND_DATA_PRESERVED` can never detect a data change. This PR
does not change that behavior; it should be fixed separately (capture `H0d`
before step 3) and reviewed on its own.

## Guarantees

- `PRODUCTION_SCRIPT_CHANGED=NO`
- `DEPLOY=NO`
- `SERVICE_RESTART=NO`
