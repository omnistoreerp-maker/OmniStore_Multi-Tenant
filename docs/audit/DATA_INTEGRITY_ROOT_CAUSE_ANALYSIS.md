# DigiTronics ERP - Data Integrity Root Cause Analysis

**Date:** 2026-07-14  
**Scope:** Production-Grade Data Integrity Fixes Only  
**Exclusions:** UI/UX, Performance, Deployment, Git, Vercel, Cache, localStorage Encryption

---

## Issues Requiring Fix (Data Integrity Impact)

### 1. MI-6: Delete Sale Invoice with Returns → DATA CORRUPTION

**Proof of Bug:**

```javascript
// deleteSaleInvoice(id) - Line 32262
function deleteSaleInvoice(id) {
  // ... finds invoice, confirms deletion ...
  
  // Reverse inventory effects (lines 32268-32280)
  (inv.items || []).forEach(item => {
    if (item.serials && item.serials.length > 0) {
      // Returns serials to available status
    } else if (item.productId) {
      // Adds qty back to stock
    }
    addStockMovement(item.productId, 'in', item.qty, `إلغاء فاتورة بيع #${id}`);
  });
  
  // Reverse cash entry (lines 32282-32285)
  if (inv.invoiceType === 'cash' && inv.total > 0) {
    addCashEntry('out', inv.total, ...); // DEDUCTS cash
  }
  
  // Remove invoice (line 32288)
  DB.saleInvoices = DB.saleInvoices.filter(i => i.id !== id);
}
```

**Root Cause:** No check if `DB.returns` contains records linked to this invoice via `invoiceId`.

**Impact on Data Integrity:**

| Module | Impact | Explanation |
|--------|--------|-------------|
| **Inventory** | ❌ CORRUPT | Return already restored stock. Deleting sale adds stock AGAIN = double stock |
| **Stock Movement** | ❌ CORRUPT | Return created 'in' movement. Delete creates another 'in' movement = double record |
| **Cash/Treasury** | ❌ CORRUPT | Return already refunded cash. Delete deducts cash AGAIN = double deduction |
| **Customer Balance** | ❌ CORRUPT | Return already reduced customer debt. Delete removes invoice = customer balance too low |
| **Reports** | ❌ CORRUPT | Sales report missing invoice. Profit report wrong. Return report has orphan return |
| **Serials** | ⚠️ RISK | Serials returned by return are now 'available'. Delete tries to make them 'available' again = harmless but redundant |

**Scenario:**
1. Sale invoice #INV-000001 for 5 items, total = 5000
2. Create return for #INV-000001, 2 items refunded = 2000
3. Inventory: +5 (sale) -2 (return) = +3 net
4. Cash: +5000 (sale) -2000 (return refund) = +3000 net
5. **Delete sale invoice #INV-000001:**
   - Inventory: +5 (delete reverses sale) → now +8 (but should be 0!)
   - Cash: -5000 (delete reverses cash) → now -4000 (but should be -2000!)
   - Return still exists with reference to deleted invoice

**Fix:** Add check `getSaleReturnsForInvoice(id).length > 0` → block deletion with warning.

---

### 2. MI-6b: Delete Purchase Invoice with Returns → DATA CORRUPTION

**Same pattern as sale invoice.** `deletePurchaseInvoice()` at line 32297 has no check for purchase returns.

**Impact:** Same as sale - double stock deduction, double cash refund, orphan returns.

---

### 3. Code-5: nextInvoiceNum++ Not Atomic → DUPLICATE IDs

**Proof:**

```javascript
// saveQuickSale() line 32709
const invoiceId = 'INV-' + String(DB.settings.nextInvoiceNum).padStart(6, '0');
DB.settings.nextInvoiceNum++; // NOT ATOMIC
```

**Root Cause:** Two users/tabs create invoices simultaneously:
- Tab A reads nextInvoiceNum = 100
- Tab B reads nextInvoiceNum = 100 (same time)
- Tab A creates INV-000100, increments to 101
- Tab B creates INV-000100 (DUPLICATE!), increments to 102
- Save: last write wins, one invoice lost

**Impact:**
- Duplicate invoice IDs
- Lost invoices (overwritten in localStorage)
- Broken references (returns point to wrong invoice)
- Cash entries with wrong reference
- Stock movements with wrong reference

**Fix:** Use timestamp-based ID or check for existing ID before increment.

---

### 4. Code-4: Legacy Name-Based Lookups in Reports → WRONG DATA

**Proof:**

```javascript
// normalizeProductNameForLink() line 19046
return (DB.products || []).find(p => normalizeProductNameForLink(p.name) === itemName) || null;

// viewPurchaseInvoice() line 20235
: [{ name: DB.products.find(p => p.id === inv.productId)?.name || '-', ... }]
```

**Root Cause:** When two products have the same name, report links to wrong product.

**Impact:**
- Stock report shows wrong product stock
- Product history links to wrong invoices
- Profit calculations use wrong cost price
- Inventory valuation incorrect

**Fix:** Always use `productId` for lookups, never `name`.

---

### 5. Feat-3: Quick Sale Installment Missing Customer Balance → MISSING DATA

**Proof:**

```javascript
// saveQuickSale() line 32737
if (payment !== 'installment') {
  addCashEntry('in', price, ...); // ONLY for non-installment
}
// No customer balance entry for installment!
```

**Root Cause:** Installment sales don't create customer balance tracking.

**Impact:**
- Customer statement missing installment sales
- Accounts receivable understated
- Installment collection reports incomplete
- Customer balance = 0 when they actually owe money

**Fix:** Add customer balance entry for installment payment.

---

### 6. Data-5: No Referential Integrity on Product Delete → ORPHAN DATA

**Proof:** No `deleteProduct()` function found, but if product is deleted manually or via code:
- Invoices still reference `productId` that no longer exists
- Stock movements reference missing product
- Serials reference missing product
- Reports try to find product by ID → null → display '-'

**Impact:**
- Historical invoices show '-' instead of product name
- Stock calculations fail silently
- Profit reports inaccurate (can't find buyPrice)
- Serial tracking broken

**Fix:** Add referential integrity check or soft-delete (mark as inactive, don't remove).

---

### 7. Code-3: Mixed Naming Conventions → DATA INCONSISTENCY

**Proof:**

```javascript
// Invoice item uses:
productId: Number(productId),        // CR-1 fix
product_id: resolveSupabaseProductUuid(...),  // Supabase UUID
legacy_product_id: String(productId),  // String version

// Different functions use different fields:
getProductStock(productId)           // uses Number(p.id) === Number(productId)
findSerialRecordByIdentifier()      // uses String comparison
getProductPurchaseLinks(productId)   // uses Number comparison
```

**Impact:**
- Type mismatches cause lookup failures
- Some functions find product, others don't
- Inconsistent behavior across modules
- Data corruption when types don't match

**Fix:** Standardize on `Number(productId)` for all comparisons.

---

## Issues NOT Requiring Fix (Out of Scope)

| Issue | Reason | Category |
|-------|--------|----------|
| HI-1 | localStorage encryption | Security, not data integrity |
| MI-1 | O(n) product search | Performance, not data integrity |
| MI-2 | Full DB serialization | Performance, not data integrity |
| MI-3 | No CSRF tokens | Security architecture, not data integrity |
| MI-4 | No rate limiting | Abuse prevention, not data integrity |
| MI-5 | Branch isolation | Feature, not data integrity bug |
| LI-1 | Report pagination | Performance, not data integrity |
| LI-2 | Stock calculation O(n×m) | Performance, not data integrity |
| Code-6 | File size | Maintainability, not data integrity |
| Code-7 | Duplicate lookup patterns | Code style, not data integrity |
| Code-8 | Stock movement duplication | Pattern consistency, not bug |
| Code-9 | Cash entry duplication | Pattern consistency, not bug |
| Sec-1 | XSS in other places | Security, not data integrity |
| Sec-2 | Service Worker cache | Security standard, not bug |
| Data-3 | JS number precision | Language limitation, not bug |
| Data-4 | Concurrent access | Architecture, requires backend |
| UI-1 | Skeleton loading | UX, not data integrity |
| UI-2 | Mobile rendering | UX, not data integrity |
| Dep-1 | Vercel cache | Deployment, not data integrity |
| Dep-2 | Manual deployment | Deployment, not data integrity |
| Perf-1 | Dashboard load | Performance, not data integrity |
| Perf-2 | Statement generation | Performance, not data integrity |
| Feat-1 | Quick Sale qty=1 | Design decision, not bug |
| Feat-2 | Quick Sale no discount | Design decision, not bug |
| Compat-1 | Old browsers | Compatibility, not data integrity |
| Compat-2 | Backdrop-filter | CSS, not data integrity |
| Audit-1 | Audit trail gaps | Logging, not data integrity |
| Audit-2 | No data versioning | Feature, not bug |
| Backup-1 | Manual backup | Feature, not bug |
| Backup-2 | No backup verification | Feature, not bug |
| Sync-1 | Supabase silent failure | Network, not data integrity |
| Sync-2 | Conflict resolution | Architecture, requires backend |

---

## Fix Priority Order

| Priority | Issue | Impact | Effort |
|----------|-------|--------|--------|
| 1 | MI-6: Delete sale with returns | Critical | Low |
| 2 | MI-6b: Delete purchase with returns | Critical | Low |
| 3 | Code-5: nextInvoiceNum atomic | High | Low |
| 4 | Code-4: Name-based lookups | High | Medium |
| 5 | Feat-3: Installment customer balance | High | Low |
| 6 | Code-3: Mixed naming conventions | Medium | Medium |
| 7 | Data-5: Referential integrity | Medium | Medium |

---

## Next Steps

1. Fix MI-6 (delete sale with returns)
2. Fix MI-6b (delete purchase with returns)
3. Fix Code-5 (atomic invoice IDs)
4. Fix Code-4 (name-based lookups)
5. Fix Feat-3 (installment customer balance)
6. Full Regression Test
7. End-to-End Audit
8. Final Report

---

*No code changes made yet. Analysis complete.*
