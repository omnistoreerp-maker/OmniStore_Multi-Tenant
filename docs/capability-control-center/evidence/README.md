# Evidence index and collection policy

**Evidence not yet collected**

لا تحتوي هذه الحزمة raw test outputs أو GitHub run links أو diffs أو نتائج smoke جديدة. إفادات المستخدم محفوظة كـUSER_REPORTED_NOT_RERUN؛ لا ننتج logs مختلقة أو ننسبها إلى تشغيل محلي.

## Provenance presently available

- تعليمات المستخدم بتاريخ 2026-09-23: main SHA، حالات القدرات الست الصريحة، refs الخاصة بـGaming وMonetag، ونتائج Orders Today المبلّغ عنها.
- تقرير Gaming الأمني الذي قدمه وأكده المستخدم: guards الموجودة، ثغرة webhook، tenantContext:null، وحدود replay وخطة HMAC المنفصلة.
- التدقيق الأقدم سياق تاريخي فقط. لا يثبت الوضع الحالي لـVisitors Now أو Student Services على main الجديد.

الأرقام المبلغ عنها: Orders aggregator 16/16؛ platformActivity + platformPublic 58/58؛ regression/security 132/132؛ smoke public stats أعاد ordersToday=2. لا يوجد artifact خام لهذه النتائج هنا. لا يُعاد تشغيل production smoke لجمع دليل ضمن هذا التكليف.

## Where future evidence belongs

تحت `evidence/` فقط، في مجلد باسم capability مع commit المعني عند توفر دليل مصرح به؛ هذه مجلدات مقترحة وليست ملفات أُنشئت بالفعل. أضف path الفعلي إلى metadata بعد إنشائه، ولا تخترع أسماء run أو روابط.

لكل دليل سجّل:

1. Capability، branch، exact commit وbaseline main SHA وقت التحقق؛ علاقتها بـmain مثبتة بمصدر وليس بالتخمين.
2. تاريخ التحقق، منفذه، نوع البيئة، مصدر evidence أو GitHub run URL الحقيقي.
3. الأمر الحقيقي وexit code والنتيجة الكاملة أو مقتطف واضح غير مضلل؛ اختبارات skipped/failing وحدود التغطية.
4. هل الدليل موجود مسبقًا أم شُغّل في checkpoint جديد مصرح به؛ ما هو reported وما هو independently verified.
5. البيانات synthetic فقط، دون secrets أو tokens أو بيانات أشخاص أو companies أو CairoTech أو runtime dumps.
6. الصلة بالـsecurity gate؛ valid HMAC test وحده لا يثبت tenant binding أو anti-replay أو provider readiness.

## Per-capability evidence backlog

| Capability | Evidence to attach | Current raw evidence |
|---|---|---|
| Orders Today | Existing 16/16, 58/58, 132/132 outputs and redacted prior smoke record | Evidence not yet collected |
| Gaming / Game Hosting | Branch checkpoint; both webhook paths; HMAC/fail-closed/tenant binding; ownership/operator; non-production provider gate | Evidence not yet collected |
| Media / Reels | Current scope/inventory substantiating stub-only state | Evidence not yet collected |
| Support | Dedicated-module inventory; separation from customerRequest/supportTier | Evidence not yet collected |
| Custom Domains | CRUD tests; resolver mounting status; quotas/host trust/certificate gates | Evidence not yet collected |
| Monetag | Existing boundary checkpoint and disabled-state/security evidence | Evidence not yet collected |
| Platform Activity / Visitors Now | Current storage mode, five-minute TTL, 100,000 cap, limiter and no-PII tests | Evidence not yet collected |
| Platform Admin API | Current route/mount inventory and tenant Owner/platform-admin denial tests | Evidence not yet collected |
| Tenant Payments | Existing main HMAC/rawBody/timing-safe/fail-closed tests tied to current SHA | Evidence not yet collected |
| Student Services | Current implementation and tenant/branch isolation/remediation evidence | Evidence not yet collected |

No production access, code inspection, test execution, credential creation or operational change is authorized merely by this backlog. Missing evidence remains UNKNOWN / NEEDS VERIFICATION; it is not proof of presence or absence.
