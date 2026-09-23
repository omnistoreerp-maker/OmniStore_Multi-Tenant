# OmniStore Capability Control Center

## Purpose and source of truth

مركز متابعة موثق للقدرات، الفروع، commits، التبعيات، الاختبارات وبوابات الأمان. GitHub repository يبقى **Source of Truth للكود**؛ هذه metadata مساعدة ولا تستبدل repository أو OmniStore backend.

المرجع الحالي المقدم من المستخدم: `main = 5f5aca80c08bb95449309d43b1c04bd193939e8c`. لم يُتحقق remote HEAD في هذه المهمة، ولم يُفحص كود التطبيق. لا يعتبر هذا المجلد audit جديدًا.

## Scope and delivery location

المسار المستهدف داخل repository: `docs/capability-control-center/`.

النسخة المنشأة في بيئة التسليم: `/home/agent/workspace/docs/capability-control-center/`. هذه البيئة ليست checkout للمستودع الحقيقي؛ **لم تُنقل الملفات إلى GitHub أو مستودع Windows**. ZIP يحافظ على نفس المسار النسبي `docs/capability-control-center/` للنقل لاحقًا. لا نسخ فوق ملفات repository قائمة دون مقارنتها أولًا؛ لا commit/push/merge/deploy ضمن هذا التسليم.

Documentation/control metadata فقط. لا application code أو implementation code. لا production credentials/data أو CairoTech data أو tokens أو provider secrets هنا. لا runtime JSON contents؛ ذكر اسم ملف مخزن لا يمنح إذنًا لقراءته.

## Files

- `README.md` — الغرض، الحالات، التحديث والبوابات.
- `capability-matrix.json` — metadata لكل capability؛ النسخة المنظمة المرجعية لهذا المجلد.
- `capability-matrix.md` — نسخة مقروءة متطابقة مع JSON.
- `repository-map.json` — Main → capability → branch → commit → files/tests/dependencies/security gates/missing pieces.
- `gaming-map.md` — السلسلة المطلوبة، blockers ومحدودية خطوة HMAC وحدها.
- `evidence/README.md` — سياسة الأدلة ومواقع حفظها مستقبلًا؛ لا test output مختلق.

## Capability states

| State | Interpretation |
|---|---|
| DONE | النطاق المعرّف مكتمل وفق الدليل أو إفادة الحالة الموسومة؛ لا تعني تلقائيًا صحة production الكاملة. |
| PARTIAL | foundation أو أجزاء موجودة مع نواقص؛ إذا status_basis مؤقت فهي tracking placeholder وليست نتيجة تحقق. |
| MISSING | القدرة المطلوبة غير موجودة وفق المصدر المحدد؛ stub لا يساوي module مكتملًا. |
| BLOCKED | dependency أو security/approval gate يمنع التقدم/التفعيل. |
| READY_FOR_REVIEW | checkpoint جاهز للمراجعة وله evidence؛ لا يعني merge أو production approval. |

لا scores أو تقييمات Best/Worst. لا نستخدم UNKNOWN كحالة capability لأنه خارج القائمة المعتمدة؛ نحفظ `UNKNOWN / NEEDS VERIFICATION` داخل الحقول غير المحسومة و`status_basis` يبيّن التصنيف المؤقت. Platform Activity / Visitors Now، Platform Admin API، Tenant Payments، Student Services لها PARTIAL مؤقتة لأن المستخدم طلب تتبعها دون status صريح؛ لا يُستنتج منها خلل أو اكتمال حالي.

## Updating the matrix

1. ابدأ بالمصدر المصرح بمراجعته عند checkpoint جديد؛ سجّل SHA فعليًا ولا تجعل ref المقدم مساويًا لتحقق مستقل.
2. حدّث capability-matrix.json مع كل الحقول المطلوبة؛ لا تضع basename كأنه path مثبت، ولا commit غير معلوم كأنه merged.
3. احتفظ بنوع الدليل (user-reported / independently verified / expected requirement / unknown) ورابط evidence الحقيقي وحدود التغطية. `Evidence not yet collected` إذا غاب.
4. حدّث Markdown وrepository-map وgaming-map معًا. لا ترقّي UNKNOWN إلى نجاح أو فشل. فرّق implemented-on-branch عن merged-to-main وعن production-ready.
5. عند تغيير main_sha، أعد تقييم صلة الأدلة بالمرجع؛ لا تنقل نتائج قديمة كأنها نتائج SHA الجديد.
6. لا تغيّر Orders Today أو تقترح إعادة بنائه إلا عند اكتشاف عيب. لا تستخدم mocks أو simulated payments لإعلان production completion.

## Current Gaming blocker

Branch `agent/astra-game-hosting-completion-20260922` at `c263a1283e22ebe10580302758124f6709296784`: PARTIAL. No real provider adapter; provider status BLOCKED. معالجة payment-webhook HMAC منفصلة ولم يقدم دليل اكتمالها. HMAC middleware وحده لا يغلق tenantContext:null cross-tenant mutation. Timestamp/nonce anti-replay غير منفذ وفق التقرير المقدم. **Do NOT integrate Gaming branch yet.**

## Current next gates

- Orders Today: DONE حسب الحالة المقدمة؛ أرفق الدليل السابق فقط عند توفره، دون تعديل أو production smoke جديد.
- Gaming: نتائج HMAC/fail-closed/regression على المسارين + explicit tenant binding؛ تتبع real provider بلا credentials أو activation.
- Media / Reels وSupport: تحديد نطاق module مستقل مستقبلًا؛ stub وcustomerRequest لا يحققان المطلوب.
- Custom Domains: إثبات CRUD الحالي وفصل resolver/host trust/quota/cert/edge gaps؛ لا mounting/DNS/SSL أو عمليات تشغيلية هنا.
- Monetag: احتفظ بالboundary المعزولة وBLOCKED؛ لا enable/config changes.
- Visitors Now: افصل المتوقع (in-memory، 5min، 100,000 sessions، limiter، no PII) عن التنفيذ الحالي غير المتحقق؛ لا تعلن تحقق السقف أو التخزين من اختبار Orders Today المجمع.
- Platform Admin API وTenant Payments وStudent Services: جمع دليل الحالة الحالية والاختبارات في checkpoint مصرح به، دون إطلاق audit أو remediation تلقائيًا.

## Safety / completion meaning

CONTROL_CENTER=READY يعني اكتمال ملفات documentation/control فقط. لا يعني أن أي capability غير مكتملة أصبحت جاهزة للإنتاج، ولا أن الأمن أو tests قد اجتازت تحققًا جديدًا.

SOURCE_CODE_CHANGED=NO  
PRODUCTION_CHANGE=NO  
PRODUCTION_DATA_ACCESSED=NO  
CAIROTECH_DATA_USED=NO  
CREDENTIALS_CREATED=NO  
GITHUB_PUSH=NO  
MERGE=NO  
DEPLOY=NO
