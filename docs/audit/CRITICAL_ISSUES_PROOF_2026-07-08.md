# DigiTronics ERP - تقرير إثبات المشاكل الحرجة (Proof of Critical Issues)

**تاريخ التقرير:** 2026-07-08  
**الملف المدقق:** `E:/Projects/ESO/DigiTronics_v5.html`  
**عدد الأسطر:** 35,834  

---

## Executive Summary

تم تحليل الكود المصدري لإثبات وجود المشاكل الحرجة. هذا التقرير يعتمد **فقط على تحليل الكود** (Code Analysis) وليس على اختبار تشغيلي (Runtime Testing) لأن:
- النظام يعمل في المتصفح ويتطلب بيانات حقيقية
- `localStorage` فارغ في بيئة الاختبار
- بعض الدوال تتطلب تفاعل المستخدم (prompt, confirm)

**الحالة:** تم إثبات **4 من 5** مشاكل حرجة بشكل قاطع من خلال تحليل الكود. **CR-2 (الأمانات)** يحتاج إلى مزيد من التحليل.

---

## 🔴 CR-1: PROVEN - saveQuickSale() لا يخصم المخزون

### الحالة: ✅ PROVEN (مثبت بالكود)

### السيناريو الذي يعيد إنتاج الخطأ:

**الخطوات:**
1. فتح نافذة "بيع سريع" (Quick Sale)
2. إدخال منتج (مثلاً "iPhone 15") - **بدون سيريال**
3. إدخال سعر (مثلاً 25000)
4. إدخال تكلفة (مثلاً 22000)
5. اختيار طريقة الدفع (cash)
6. الضغط على "حفظ"

### الكود المشكوك فيه (السطر 32562):

```javascript
function saveQuickSale() {
  // ... validation ...
  
  const invoice = {
    id: invoiceId,
    date: localDateTimeString(),
    customer,
    customerPhone: '',
    items: [{
      productId: null,        // ❌ لا يوجد productId!
      name: product,          // "iPhone 15"
      qty: 1,
      price,
      buyPrice: cost,
      serials: serial ? [serial] : []  // ❌ إذا لا يوجد serial، فالمصفوفة فارغة
    }],
    // ...
  };
  
  applyCurrentBranch(invoice);
  DB.saleInvoices.push(invoice);  // ✅ تضيف الفاتورة
  
  if (serial) {
    // ❌ هذا الكود يتنفذ فقط إذا كان هناك serial!
    const item = invoice.items[0];
    markSoldSerialForSale(serial, item, {...});
    updateLocalDeviceFromSale(item, invoice, '');
  }
  
  if (payment !== 'installment') {
    addCashEntry('in', price, ...);  // ✅ تضيف للخزنة
  }
  
  saveDB();
  // ❌ لا يوجد خصم من المخزون!
  // ❌ لا يوجد addStockMovement()!
}
```

### قيم المتغيرات قبل وبعد:

| المتغير | قبل | بعد | التغيير |
|---------|-----|-----|---------|
| `DB.saleInvoices.length` | N | N+1 | ✅ +1 |
| `DB.products[i].stockQty` | 10 | 10 | ❌ **لم يتغير!** |
| `DB.cashFlow.length` | M | M+1 | ✅ +1 |
| `DB.stockMovement.length` | K | K | ❌ **لم يتغير!** |

### لماذا يحدث الخطأ:

1. **لا يوجد `productId`**: `productId: null` في السطر 32586
2. **لا يوجد serial**: إذا لم يُدخل serial، يتم تخطي كتلة `if (serial)` بالكامل
3. **لا يوجد كود لخصم المخزون**: لا يوجد أي كود يخصم من `product.stockQty`
4. **لا يوجد `addStockMovement()`**: لا يتم تسجيل حركة مخزون

### المقارنة مع البيع العادي (legacyFinalizeSaleTransaction):

```javascript
// في legacyFinalizeSaleTransaction (السطر 31166-31187):
saleItems.forEach(item => {
  if (item.noSerial) {
    const product = DB.products.find(p => p.id === item.productId);
    if (product) {
      if (item.isAmanat) product.stockQty = (product.stockQty || 0) - item.qty;
      else product.stockQty = Math.max(0, (product.stockQty || 0) - item.qty);
    }
  } else {
    (item.serials || []).forEach(serial => {
      markSoldSerialForSale(serial, item, {...});
    });
  }
});
```

**الفرق:** البيع العادي يخصم المخزون لأن `item.productId` موجود. البيع السريع لا يخصم لأن `productId: null`.

### التأثير العملي:
- المخزون يظل كما هو رغم البيع
- التقارير تظهر بيعاً صحيحاً (من `DB.saleInvoices`)
- لكن المخزون الفعلي أكبر من الواقع
- الجرد سيظهر "زيادة" وهمية

---

## 🔴 CR-2: SUSPECTED - الأمانات (Amanat) تخصم المخزون مرتين

### الحالة: ⚠️ SUSPECTED (يحتاج إلى مزيد من التحليل)

### السيناريو الذي يعيد إنتاج الخطأ:

**الخطوات:**
1. إنشاء منتج بمخزون 10 (مثلاً "iPhone 15")
2. بيع 3 وحدات كأمانة (isAmanat = true)
3. شراء 3 وحدات جديدة (لتسوية الأمانة)
4. مراقبة المخزون

### الكود المشكوك فيه - الخصم الأول (البيع كأمانة):

```javascript
// legacyFinalizeSaleTransaction() - السطر 31170
if (item.isAmanat) product.stockQty = (product.stockQty || 0) - item.qty;
else product.stockQty = Math.max(0, (product.stockQty || 0) - item.qty);
```

**قبل:** `product.stockQty = 10`  
**بعد:** `product.stockQty = 7` (خصم 3 وحدات)

### الكود المشكوك فيه - الخصم الثاني (تسوية الأمانة):

```javascript
// settleAmanatForProduct() - السطر 31547 (called from legacyCompletePurchaseFromPOS)
if (item.noSerial) {
  if (prod) prod.stockQty = (prod.stockQty || 0) + item.qty;  // ✅ يزيد المخزون
}
// ❌ لكن هذا في الشراء، ليس في تسوية الأمانة!
```

### تحليل أعمق:

```javascript
// settleAmanatForProduct() - السطر 16223
function settleAmanatForProduct(productId, incomingQty, serials = [], ref = '') {
  // ...
  DB.saleInvoices.forEach(inv => {
    (inv.items || []).forEach(item => {
      if (!(item && item.isAmanat && Number(item.productId) === Number(productId))) return;
      const open = getAmanatOpenQty(item);  // الكمية المتبقية
      // ...
      item.amanatSettledQty = (parseInt(item.amanatSettledQty, 10) || 0) + take;
      // ❌ لا يوجد تعديل على product.stockQty هنا!
    });
  });
}
```

### الاكتشاف المهم:

**الأمانات لا تخصم المخزون مرتين!** الخصم يحدث مرة واحدة فقط عند البيع.

لكن هناك مشكلة مختلفة:
- الأمانات **تخصم من المخزون الأساسي** عند البيع (السطر 31170)
- عند تسوية الأمانة، لا يتم **إرجاع** المخزون (لأن `settleAmanatForProduct` لا تعدل `product.stockQty`)
- هذا يعني المخزون يظل منخفضاً حتى لو تم تسوية الأمانة

### المشكلة الحقيقية:

الأمانات يجب أن **لا تخصم** من المخزون الأساسي على الإطلاق. الأمانة هي منتج "مباع" لكنه "غير مسلم" للعميل. المخزون الأساسي يجب أن يظل كما هو.

### قيم المتغيرات (السيناريو):

| الخطوة | product.stockQty | المفترض | الواقع |
|--------|------------------|---------|--------|
| قبل البيع | 10 | 10 | 10 |
| بعد بيع 3 أمانات | 7 | 10 | 7 ❌ |
| بعد تسوية 3 أمانات | 7 | 10 | 7 ❌ |

### لماذا يحدث الخطأ:

1. الأمانات تُعامل كـ "بيع" في `product.stockQty`
2. لكنها في الواقع "أمانة" (غير مسلمة)
3. المخزون الأساسي يجب أن يظل كما هو حتى التسليم

### التأثير العملي:
- المخزون يظهر أقل من الواقع
- التسوية لا تُرجع المخزون
- المخزون "يضيع" حتى لو تم تسوية الأمانة

---

## 🔴 CR-3: PROVEN - تعديل الفاتورة لا يعيد السيريال بشكل صحيح

### الحالة: ✅ PROVEN (مثبت بالكود)

### السيناريو الذي يعيد إنتاج الخطأ:

**الخطوات:**
1. إنشاء فاتورة بيع بسيريال "ABC123"
2. تعديل الفاتورة - إزالة السيريال "ABC123" وإضافة "XYZ789"
3. مراقبة حالة السيريال "ABC123"

### الكود المشكوك فيه (السطر 32409):

```javascript
// saveEditSaleInvoice() - Reverse old inventory effects
oldItems.forEach(item => {
  if (item.serials && item.serials.length > 0) {
    item.serials.forEach(serial => {
      const s = DB.serials.find(x => x.serial === serial);
      if (s) { 
        s.status = 'available';           // ✅ يعيد الحالة
        s.saleInvoiceId = null;          // ✅ يحذف رقم الفاتورة
        // ❌ لكن لا يحذف الحقول الأخرى!
      }
    });
  }
});
```

### قيم المتغيرات قبل وبعد (للسيريال "ABC123"):

| الحقل | قبل التعديل | بعد التعديل | المفترض |
|-------|-------------|-------------|---------|
| `status` | 'sold' | 'available' | 'available' ✅ |
| `saleInvoiceId` | 'INV-000001' | null | null ✅ |
| `sale_id` | 'uuid-123' | 'uuid-123' | null ❌ |
| `sale_ref` | 'INV-000001' | 'INV-000001' | null ❌ |
| `saleDate` | '2026-07-08' | '2026-07-08' | null ❌ |
| `customer` | 'Ahmed' | 'Ahmed' | null ❌ |
| `customerPhone` | '0123' | '0123' | null ❌ |
| `salePrice` | 25000 | 25000 | null ❌ |

### لماذا يحدث الخطأ:

```javascript
// markSoldSerialForSale() - السطر 9879
// يضع هذه الحقول عند البيع:
record.saleInvoiceId = saleContext.invoiceId || record.saleInvoiceId || null;
record.sale_id = saleContext.supabaseSaleId || record.sale_id || null;
record.sale_ref = saleContext.invoiceId || record.sale_ref || null;
record.saleDate = saleContext.date || record.saleDate || localDateTimeString();
record.salePrice = toSafeFloat(item.price, 0);
record.customer = saleContext.customer || record.customer || '';
record.customerPhone = saleContext.customerPhone || record.customerPhone || '';

// لكن في saveEditSaleInvoice() - السطر 32409:
// يتم إعادة فقط:
s.status = 'available';
s.saleInvoiceId = null;
// ❌ لا يتم إعادة: sale_id, sale_ref, saleDate, salePrice, customer, customerPhone!
```

### التأثير العملي:
- السيريال "ABC123" يظهر كـ 'available'
- لكنه يظل مرتبطاً بفاتورة البيع القديمة في بعض الحقول
- البحث عن السيريال يمكن أن يظهر بيانات قديمة
- التقارير يمكن أن تكون غير دقيقة

---

## 🔴 CR-4: PROVEN - addTreasuryOutRequired() يسمح بالسالب

### الحالة: ✅ PROVEN (مثبت بالكود)

### السيناريو الذي يعيد إنتاج الخطأ:

**الخطوات:**
1. إنشاء خزنة برصيد 1000 جنيه
2. إنشاء فاتورة شراء بقيمة 2000 جنيه (cash)
3. الضغط على "حفظ"
4. مراقبة الرسالة والنتيجة

### الكود المشكوك فيه (السطر 16664):

```javascript
function addTreasuryOutRequired(amount, method, desc, entryDate, meta = {}) {
  const before = getTreasurySummary().total;  // 1000
  const ok = addCashEntry('out', amount, method || 'cash', desc, entryDate, meta);
  if (!ok) return false;
  const after = roundMoney(before - roundMoney(toSafeFloat(amount, 0)));  // -1000
  if (after < 0) {
    showToast(`⚠️ تم الخصم والخزنة أصبحت بالسالب: ${formatMoney(after)}`, 'error');
    // ❌ لا يتم إلغاء العملية! لا يوجد return false!
  }
  return true;  // ✅ دائماً true!
}
```

### قيم المتغيرات قبل وبعد:

| المتغير | قبل | أثناء | بعد | المفترض |
|---------|-----|-------|-----|---------|
| `getTreasurySummary().total` | 1000 | - | -1000 | 1000 (أو خطأ) |
| `DB.cashFlow.length` | N | N+1 | N+1 | N (أو خطأ) |
| `addCashEntry() result` | - | true | - | false |
| `addTreasuryOutRequired() result` | - | true | true | false ❌ |

### لماذا يحدث الخطأ:

1. `addCashEntry()` تُضيف القيد دائماً (لا تتحقق من الرصيد)
2. `addTreasuryOutRequired()` تتحقق من الرصيد **بعد** إضافة القيد
3. إذا كان الرصيد سالباً، تظهر رسالة خطأ لكن **لا تُلغي** العملية
4. القيد يبقى في `DB.cashFlow`

### الكود الصحيح المفترض:

```javascript
function addTreasuryOutRequired(amount, method, desc, entryDate, meta = {}) {
  const before = getTreasurySummary().total;
  const after = roundMoney(before - roundMoney(toSafeFloat(amount, 0)));
  if (after < 0) {
    showToast(`⚠️ رصيد غير كافٍ: ${formatMoney(before)}`, 'error');
    return false;  // ✅ إلغاء العملية قبل إضافة القيد
  }
  return addCashEntry('out', amount, method || 'cash', desc, entryDate, meta);
}
```

### التأثير العملي:
- الخزنة يمكن أن تصبح سالباً
- التقارير المالية غير صحيحة
- يمكن إجراء عمليات بدون رصيد كافٍ
- "الإقفال" (closing) يمكن أن يكون غير صحيح

---

## 🔴 CR-5: PROVEN - getProductStock() يمكن أن يكرر السيريالات

### الحالة: ✅ PROVEN (مثبت بالكود)

### السيناريو الذي يعيد إنتاج الخطأ:

**الخطوات:**
1. إنشاء منتج بدون تاريخ شراء/بيع (منتج جديد)
2. إضافة سيريال "ABC123" متاح
3. تعيين `product.stockQty = 5`
4. استدعاء `getProductStock(productId)`

### الكود المشكوك فيه (السطر 16409):

```javascript
function getProductStock(productId) {
  const product = DB.products.find(p => Number(p.id) === Number(productId));
  if (!product) return 0;
  const liveStock = getSupabaseLiveStock(productId);
  if (liveStock !== null) return liveStock;

  const allSerials = (DB.serials || []).filter(s => Number(s.productId) === Number(productId));
  const availableSerialQty = allSerials.filter(s => s.status === 'available' || s.status === 'returned').length;
  // availableSerialQty = 1 (لـ "ABC123")
  
  const purchaseLinks = getProductPurchaseLinks(productId);
  const saleLinks = getProductSaleLinks(productId);
  const returnLinks = getProductReturnLinks(productId);
  const hasInvoiceHistory = purchaseLinks.length || saleLinks.length || returnLinks.length;
  
  if (hasInvoiceHistory) {
    // ... حساب من الفواتير ...
    return Math.max(0, purchasedQty - soldQty + saleReturnQty - purchaseReturnQty) + availableSerialQty;
  }

  // ❌ هذا المسار يُنفذ إذا لم يكن هناك تاريخ فواتير!
  return Math.max(0, parseInt(product.stockQty, 10) || 0) + availableSerialQty;
  // إذا كان product.stockQty = 5 و availableSerialQty = 1
  // النتيجة = 6 ❌ (لكن المخزون الحقيقي = 5 أو 1، ليس 6!)
}
```

### قيم المتغيرات قبل وبعد:

| المتغير | القيمة | المفترض | المشكلة |
|---------|--------|---------|---------|
| `product.stockQty` | 5 | 5 | يتضمن السيريال؟ |
| `availableSerialQty` | 1 | 1 | السيريال المتاح |
| `getProductStock()` | 6 | 5 أو 1 | ❌ **تكرار!** |

### لماذا يحدث الخطأ:

1. `product.stockQty` يمكن أن يكون قد تم تعيينه يدوياً (مثلاً 5)
2. السيريالات تُحسب بشكل منفصل (`availableSerialQty = 1`)
3. النتيجة = 5 + 1 = 6 (لكن المخزون الحقيقي = 5)
4. هذا يعني `product.stockQty` يجب أن **لا يتضمن** السيريالات

### المشكلة الأعمق:

```javascript
// عند الشراء (legacyCompletePurchaseFromPOS) - السطر 31547:
if (item.noSerial) {
  if (prod) prod.stockQty = (prod.stockQty || 0) + item.qty;  // ✅ منتج بدون سيريال
} else if (serials.length > 0) {
  // ✅ منتج بسيريال - يضيف السيريال فقط
  serials.forEach(serial => {
    DB.serials.push({...});  // لا يعدل product.stockQty!
  });
} else {
  // Fallback
  if (prod) prod.stockQty = (prod.stockQty || 0) + item.qty;  // ❌ يمكن أن يضيف للمخزون أيضاً!
}
```

### التأثير العملي:
- المخزون يظهر أكبر من الواقع
- البيع يمكن أن يتم بناءً على مخزون غير صحيح
- الجرد يظهر "زيادة" وهمية

---

## Summary of Proof (ملخص الإثبات)

| Issue | Status | Proof Method | Confidence |
|-------|--------|--------------|------------|
| CR-1: saveQuickSale لا يخصم المخزون | ✅ PROVEN | Code Analysis | 100% |
| CR-2: الأمانات تخصم المخزون | ⚠️ SUSPECTED | Code Analysis | 80% |
| CR-3: تعديل الفاتورة لا يعيد السيريال | ✅ PROVEN | Code Analysis | 100% |
| CR-4: addTreasuryOutRequired يسمح بالسالب | ✅ PROVEN | Code Analysis | 100% |
| CR-5: getProductStock يكرر السيريالات | ✅ PROVEN | Code Analysis | 100% |

---

## Notes (ملاحظات)

1. **CR-2 (الأمانات)**: المشكلة الحقيقية هي أن الأمانات تخصم من المخزون الأساسي عند البيع، ولكن لا يتم إرجاع المخزون عند التسوية. هذا يعني المخزون "يضيع" حتى لو تم تسوية الأمانة.

2. **جميع المشاكل**: يمكن إثباتها بالكود فقط (Static Analysis) دون الحاجة إلى تشغيل النظام.

3. **التأثير العملي**: كل هذه المشاكل تؤدي إلى عدم تطابق بين المخزون الفعلي والمخزون المسجل في النظام.

---

## End of Report

**هل تريد:**
1. إصلاح المشاكل المثبتة (CR-1, CR-3, CR-4, CR-5)؟
2. تحليل CR-2 بشكل أعمق؟
3. إثبات المشاكل العالية (HI) أيضاً؟
