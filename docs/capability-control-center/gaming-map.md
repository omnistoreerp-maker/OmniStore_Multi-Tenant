# Gaming dependency map

Reference main: `5f5aca80c08bb95449309d43b1c04bd193939e8c`  
Existing branch: `agent/astra-game-hosting-completion-20260922`  
Existing commit: `c263a1283e22ebe10580302758124f6709296784`

هذه refs من المستخدم ولم تُتحقق عبر GitHub في هذه المهمة. لا تعني وجود عمل branch على main. العقد PARTIAL تعني implementation مُبلّغًا عنه يحتاج دليل مراجعة؛ لا تدّعي أن كل node معيب. لا دمج للفرع.

## Required chain

Gaming
→ Catalog
→ Storefront
→ Quote
→ Order
→ Payment
→ Payment HMAC Security
→ Entitlement
→ Provisioning
→ State Machine
→ Provider Abstraction
→ Real Provider
→ Market Mount
→ Production Gate

هذا ترتيب dependency المطلوب للتوثيق، وليس ادعاءً بأن كل request يمر تسلسليًا عبر جميع العقد.

| Node | Status | Evidence / gate |
|---|---|---|
| Gaming | PARTIAL | Branch foundation reported; security remediation and real provider unresolved. |
| Catalog | PARTIAL | Enhanced catalog reported in branch; completeness and current-main inclusion unknown. |
| Storefront | PARTIAL | Enhanced storefront reported in branch; no independent test evidence. |
| Quote | PARTIAL | Quote flow reported in branch; verification pending. |
| Order | PARTIAL | Order/billing flow reported; prior audit reports customer ownership guards. |
| Payment | PARTIAL | Flow reported; simulatedGateway is non-production. Forged paid risk reported on unsigned webhook. |
| Payment HMAC Security | BLOCKED | Separate main-pattern remediation in progress per requester; completion not evidenced. Tenant binding also required. |
| Entitlement | PARTIAL | Entitlements reported; prior audit reports requireOperator on mutations; current commit evidence pending. |
| Provisioning | PARTIAL | Orchestrator and paid/owned-order prerequisites reported; real provider not available. |
| State Machine | PARTIAL | Reported implemented in branch; transition/test outputs not attached. |
| Provider Abstraction | PARTIAL | Abstraction reported; MockProvider must remain non-production. |
| Real Provider | MISSING | Explicitly no real provider adapter. Provider readiness is BLOCKED. |
| Market Mount | PARTIAL | Mount reported in branch; public dual webhook paths reported; remediation coverage must include both. |
| Production Gate | BLOCKED | Safety gate reported but release blocked by real provider and unresolved payment security. No production activation. |

## Separate payment-security checkpoint

وفق التقرير المقدم سابقًا، المساران العامان هما:

- `POST /api/v1/game-hosting/payment-webhook`
- `POST /api/v1/market/game-hosting/payment-webhook`

التقرير وصف غياب customer JWT/signature، مع requireMarketTenant وlimiter، ثم paymentWebhook → applyPaymentResult مع tenantContext:null. فحص وجود tenant وحده لا يربط الطلب بذلك tenant. هذه نتائج منقولة؛ ليست مراجعة مصدر جديدة لهذا SHA.

الخطوة المتفق عليها: reuse `verifyPaymentsWebhookSignature` + existing rawBody + `PAYMENTS_WEBHOOK_SECRET` + `x-payments-signature`؛ لا آلية HMAC ثانية ولا JSON parser إضافي. secret absent يجب أن يغلق المسار 403؛ لا ضبط secret أو تغيير إعداداته في هذه المهمة.

**Residual gate:** mounting middleware وحده لا يصلح tenantContext:null. يلزم إثبات tenant-bound order lookup/payment mutation ورفض tenant آخر بلا writes. لا يعتبر HMAC صالحًا تفويضًا لعابر tenants.

**Replay limitation:** paymentRef idempotency/paid-terminal لا يساوي nonce/timestamp anti-replay. التقرير يقول إن الأخير غير منفذ؛ لا نفترض معالجته بتوقيع HMAC.

الأدلة المطلوبة: unsigned/missing/tampered/forged-payment denial، valid raw-body signature، no-secret fail-closed، signed idempotency regression، cross-tenant rejection، وعدم إضعاف tenantPayments HMAC tests. يجب تغطية المسارين العامين. Evidence not yet collected.

## Real-provider and production gate

No real provider adapter yet. MockProvider وسداد simulatedGateway ليسا تنفيذًا production. لا provider credentials ولا calls ولا activation. Provider status = BLOCKED. production gate لا يُغلق بمجرد وجود abstraction أو safety flag.

Do NOT integrate the Gaming branch yet. `SAFE_TO_INTEGRATE_AFTER_REMEDIATION` يبقى conditional report claim only حتى ظهور الأدلة وإغلاق البوابات؛ لا يمثل إذنًا للدمج.
