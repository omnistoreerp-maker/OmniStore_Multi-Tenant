# Phase 24 Gate C6 — API Changelog Plan

**Date:** 2026-08-05  
**Gate:** C6 — Webhooks, Event Bus, ETag, Observability Foundation  
**Status:** PLANNING

---

## 1. New Endpoints

| Method | Path | Description | Auth | Breaking |
|--------|------|-------------|------|----------|
| POST | `/api/v1/webhooks` | Register webhook | Bearer JWT | No |
| GET | `/api/v1/webhooks` | List webhooks | Bearer JWT | No |
| GET | `/api/v1/webhooks/:id` | Get webhook | Bearer JWT | No |
| DELETE | `/api/v1/webhooks/:id` | Remove webhook | Bearer JWT | No |
| POST | `/api/v1/webhooks/:id/test` | Send test event | Bearer JWT | No |
| GET | `/api/v1/metrics` | Prometheus metrics | Bearer JWT | No |
| GET | `/api/v1/metrics/json` | JSON metrics | Bearer JWT | No |

**Total new endpoints: 7**

---

## 2. Modified Endpoints

| Method | Path | Change | Breaking |
|--------|------|--------|----------|
| GET | `*` (all GET routes) | ETag header added; 304 responses possible | No |

---

## 3. New Response Headers

| Header | Applied To | Description |
|--------|-----------|-------------|
| `ETag` | All GET responses | SHA-256 hash of response body |
| `X-Request-Id` | All responses | Already exists (C5) |

---

## 4. New HTTP Status Codes

| Status | When | Description |
|--------|------|-------------|
| 304 | GET with matching `If-Not-Match` | Not Modified (cached response) |

---

## 5. New Request Headers

| Header | Applied To | Description |
|--------|-----------|-------------|
| `If-None-Match` | GET requests | ETag value for conditional fetch |

---

## 6. Webhook Payload Format

```json
{
  "event": "sale.created",
  "data": { ... },
  "timestamp": "2026-08-05T12:00:00.000Z"
}
```

**Webhook Headers:**
| Header | Description |
|--------|-------------|
| `X-Webhook-Signature` | `sha256=<hmac>` HMAC-SHA256 signature |
| `X-Webhook-Event` | Event type |
| `X-Webhook-Delivery` | Unique delivery ID |

---

## 7. Breaking Changes

**NONE** — all changes are additive. Existing endpoints unaffected.

---

## 8. Swagger Update

New tags added to OpenAPI spec:
- `Webhooks` — 5 endpoints
- `Metrics` — 2 endpoints

Existing endpoint documentation unchanged.
