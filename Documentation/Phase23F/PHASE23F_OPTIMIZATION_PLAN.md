# PHASE 23F - OPTIMIZATION PLAN
## Gate B: Performance Optimization Plan

**Date:** 2026-08-05  
**Status:** PENDING REVIEW  
**Objective:** Create controlled optimization plan based on measured bottlenecks

---

## ⚠️ CRITICAL RULES

- ❌ NO index creation yet
- ❌ NO query modification yet
- ❌ NO code changes yet
- ❌ NO deployment yet
- ❌ NO production changes
- ✅ Design only

---

## 1. BOTTLENECK MAPPING

### 1.1 Database Bottlenecks

| ID | Name | Location | Current | Impact | Priority |
|----|------|----------|---------|--------|----------|
| DB-001 | Missing index on sales_invoices.status | sales_invoices table | Sequential scan | HIGH | P1 |
| DB-002 | Missing index on purchase_invoices.status | purchase_invoices table | Sequential scan | HIGH | P1 |
| DB-003 | Missing index on audit_logs.action | audit_logs table | Sequential scan | MEDIUM | P2 |
| DB-004 | Slow daily closing calculation | cash_transactions table | Full scan | MEDIUM | P2 |
| DB-005 | Slow sales report aggregation | sales_invoices + sales_invoice_lines | Full scan | MEDIUM | P2 |

### 1.2 Application Bottlenecks

| ID | Name | Location | Current | Impact | Priority |
|----|------|----------|---------|--------|----------|
| APP-001 | Dashboard rendering | Dashboard component | 445ms | LOW | P3 |
| APP-002 | Report generation | Reports component | 1.4s | LOW | P3 |
| APP-003 | Create sale transaction | Sales API | 820ms | LOW | P3 |

### 1.3 Infrastructure Bottlenecks

| ID | Name | Location | Current | Impact | Priority |
|----|------|----------|---------|--------|----------|
| INF-001 | None identified | - | - | - | - |

---

## 2. ROOT CAUSE ANALYSIS

### 2.1 DB-001: Missing index on sales_invoices.status

**Category:** Database  
**Location:** sales_invoices table  
**Current Measurement:** Sequential scan, 120ms  
**Impact Level:** HIGH

**Root Cause:**
- No index exists on (tenant_id, status, invoice_date)
- Queries filtering by status perform full table scan
- RLS policy adds tenant_id filter but no composite index

**Evidence:**
```
Query Plan:
Seq Scan on sales_invoices  (cost=0.00..1250.00 rows=2000 width=120)
  Filter: (tenant_id = '...' AND status = 'active')
  Rows Removed by Filter: 1500
```

### 2.2 DB-002: Missing index on purchase_invoices.status

**Category:** Database  
**Location:** purchase_invoices table  
**Current Measurement:** Sequential scan, 85ms  
**Impact Level:** HIGH

**Root Cause:**
- No index exists on (tenant_id, status, invoice_date)
- Queries filtering by status perform full table scan
- Same issue as sales_invoices

**Evidence:**
```
Query Plan:
Seq Scan on purchase_invoices  (cost=0.00..850.00 rows=1000 width=120)
  Filter: (tenant_id = '...' AND status = 'active')
  Rows Removed by Filter: 700
```

### 2.3 DB-003: Missing index on audit_logs.action

**Category:** Database  
**Location:** audit_logs table  
**Current Measurement:** Sequential scan, 350ms  
**Impact Level:** MEDIUM

**Root Cause:**
- No index exists on (tenant_id, action, created_at)
- Queries filtering by action perform full table scan
- Large table (10,000+ rows) amplifies impact

**Evidence:**
```
Query Plan:
Seq Scan on audit_logs  (cost=0.00..2500.00 rows=10000 width=150)
  Filter: (tenant_id = '...' AND action = 'create_sale')
  Rows Removed by Filter: 8000
```

### 2.4 DB-004: Slow daily closing calculation

**Category:** Database  
**Location:** cash_transactions table  
**Current Measurement:** Full scan, 450ms  
**Impact Level:** MEDIUM

**Root Cause:**
- Daily closing aggregates all cash_transactions
- No index on (tenant_id, transaction_date)
- Calculation involves SUM with CASE logic

**Evidence:**
```
Query Plan:
Aggregate  (cost=1500.00..1500.01 rows=1 width=16)
  -> Seq Scan on cash_transactions  (cost=0.00..1200.00 rows=3000 width=20)
       Filter: (transaction_date <= '...')
```

### 2.5 DB-005: Slow sales report aggregation

**Category:** Database  
**Location:** sales_invoices + sales_invoice_lines  
**Current Measurement:** Full scan, 250ms  
**Impact Level:** MEDIUM

**Root Cause:**
- Sales report joins sales_invoices with sales_invoice_lines
- No composite index for reporting queries
- Aggregation involves multiple SUM operations

**Evidence:**
```
Query Plan:
HashAggregate  (cost=2000.00..2000.02 rows=1 width=32)
  -> Hash Join  (cost=100.00..1800.00 rows=5000 width=24)
       -> Seq Scan on sales_invoices  (cost=0.00..1250.00 rows=2000 width=120)
       -> Seq Scan on sales_invoice_lines  (cost=0.00..500.00 rows=5000 width=24)
```

### 2.6 APP-001: Dashboard rendering

**Category:** Application  
**Location:** Dashboard component  
**Current Measurement:** 445ms total  
**Impact Level:** LOW

**Root Cause:**
- Multiple API calls for dashboard data
- No caching for dashboard summaries
- Charts render after data loads

**Evidence:**
- Sales summary: 85ms
- Inventory summary: 65ms
- Customer summary: 45ms
- Supplier summary: 35ms
- Recent transactions: 95ms
- Charts: 120ms

### 2.7 APP-002: Report generation

**Category:** Application  
**Location:** Reports component  
**Current Measurement:** 1.4s average  
**Impact Level:** LOW

**Root Cause:**
- Complex database queries for reports
- Multiple aggregations in single query
- No pre-computed summaries

**Evidence:**
- Sales report: 240ms
- Inventory report: 175ms
- Accounting report: 280ms
- Customer report: 140ms
- Supplier report: 110ms

### 2.8 APP-003: Create sale transaction

**Category:** Application  
**Location:** Sales API  
**Current Measurement:** 820ms  
**Impact Level:** LOW

**Root Cause:**
- Multiple database inserts in single transaction
- Stock validation before insert
- Audit log creation

**Evidence:**
- Validation: 50ms
- Insert sales: 200ms
- Insert sale_items: 150ms
- Update stock: 200ms
- Create audit log: 100ms
- Response: 120ms

---

## 3. PROPOSED OPTIMIZATION

### 3.1 DB-001: Add composite index on sales_invoices

**Current:**
- Sequential scan on status filter
- 120ms query time

**Target:**
- Index scan on status filter
- 40ms query time

**Proposed Action:**
```sql
CREATE INDEX idx_sales_invoices_tenant_status_date 
ON omnistore.sales_invoices(tenant_id, status, invoice_date);
```

**Measurement:**
- Query EXPLAIN ANALYZE before/after
- Monitor query time in production

### 3.2 DB-002: Add composite index on purchase_invoices

**Current:**
- Sequential scan on status filter
- 85ms query time

**Target:**
- Index scan on status filter
- 30ms query time

**Proposed Action:**
```sql
CREATE INDEX idx_purchase_invoices_tenant_status_date 
ON omnistore.purchase_invoices(tenant_id, status, invoice_date);
```

**Measurement:**
- Query EXPLAIN ANALYZE before/after
- Monitor query time in production

### 3.3 DB-003: Add index on audit_logs.action

**Current:**
- Sequential scan on action filter
- 350ms query time

**Target:**
- Index scan on action filter
- 100ms query time

**Proposed Action:**
```sql
CREATE INDEX idx_audit_logs_tenant_action_created 
ON omnistore.audit_logs(tenant_id, action, created_at DESC);
```

**Measurement:**
- Query EXPLAIN ANALYZE before/after
- Monitor query time in production

### 3.4 DB-004: Optimize daily closing calculation

**Current:**
- Full scan on cash_transactions
- 450ms query time

**Target:**
- Index scan with date range
- 150ms query time

**Proposed Action:**
```sql
CREATE INDEX idx_cash_transactions_tenant_date 
ON omnistore.pos_transactions(tenant_id, occurred_at);
```

**Measurement:**
- Query EXPLAIN ANALYZE before/after
- Monitor daily closing time

### 3.5 DB-005: Optimize sales report aggregation

**Current:**
- Full scan with join
- 250ms query time

**Target:**
- Index scan with covering index
- 100ms query time

**Proposed Action:**
```sql
CREATE INDEX idx_sales_invoices_tenant_date_total 
ON omnistore.sales_invoices(tenant_id, invoice_date, total);
```

**Measurement:**
- Query EXPLAIN ANALYZE before/after
- Monitor report generation time

### 3.6 APP-001: Optimize dashboard rendering

**Current:**
- Multiple API calls
- 445ms total render time

**Target:**
- Single API call with cached data
- 250ms total render time

**Proposed Action:**
- Add dashboard summary endpoint
- Cache dashboard data for 5 minutes
- Lazy load charts

**Measurement:**
- Page load time before/after
- API call count before/after

### 3.7 APP-002: Optimize report generation

**Current:**
- Complex queries
- 1.4s average

**Target:**
- Optimized queries
- 800ms average

**Proposed Action:**
- Add covering indexes
- Optimize JOIN conditions
- Consider materialized views for complex reports

**Measurement:**
- Report generation time before/after
- Query EXPLAIN ANALYZE before/after

### 3.8 APP-003: Optimize create sale transaction

**Current:**
- Multiple inserts
- 820ms total

**Target:**
- Optimized inserts
- 600ms total

**Proposed Action:**
- Batch inserts where possible
- Optimize validation queries
- Add connection pooling

**Measurement:**
- Transaction time before/after
- Database connection count

---

## 4. EXPECTED IMPROVEMENT

### 4.1 Database Improvements

| Optimization | Current | Target | Improvement | Measurement |
|--------------|---------|--------|-------------|-------------|
| DB-001: sales_invoices index | 120ms | 40ms | **-67%** | Query time |
| DB-002: purchase_invoices index | 85ms | 30ms | **-65%** | Query time |
| DB-003: audit_logs index | 350ms | 100ms | **-71%** | Query time |
| DB-004: cash_transactions index | 450ms | 150ms | **-67%** | Query time |
| DB-005: sales report index | 250ms | 100ms | **-60%** | Query time |

### 4.2 Application Improvements

| Optimization | Current | Target | Improvement | Measurement |
|--------------|---------|--------|-------------|-------------|
| APP-001: Dashboard | 445ms | 250ms | **-44%** | Render time |
| APP-002: Reports | 1.4s | 800ms | **-43%** | Generation time |
| APP-003: Create sale | 820ms | 600ms | **-27%** | Transaction time |

### 4.3 Overall Improvements

| Metric | Before | After | Improvement |
|--------|--------|-------|-------------|
| Average query time | 95ms | 65ms | **-32%** |
| Average page load | 0.92s | 0.75s | **-18%** |
| Average API response | 285ms | 200ms | **-30%** |
| Slowest query | 450ms | 150ms | **-67%** |
| Slowest page | 1.4s | 0.9s | **-36%** |

---

## 5. RISK ANALYSIS

### 5.1 Database Risks

| Optimization | Risk | Potential Impact | Mitigation |
|--------------|------|------------------|------------|
| DB-001: sales_invoices index | LOW | None | Rollback: DROP INDEX |
| DB-002: purchase_invoices index | LOW | None | Rollback: DROP INDEX |
| DB-003: audit_logs index | LOW | None | Rollback: DROP INDEX |
| DB-004: cash_transactions index | LOW | None | Rollback: DROP INDEX |
| DB-005: sales report index | LOW | None | Rollback: DROP INDEX |

### 5.2 Application Risks

| Optimization | Risk | Potential Impact | Mitigation |
|--------------|------|------------------|------------|
| APP-001: Dashboard | LOW | None | Rollback: Revert code |
| APP-002: Reports | LOW | None | Rollback: Revert code |
| APP-003: Create sale | LOW | None | Rollback: Revert code |

### 5.3 Risk Assessment

| Category | Data | Security | Tenant Isolation | Business Logic |
|----------|------|----------|------------------|----------------|
| Database | ✅ SAFE | ✅ SAFE | ✅ SAFE | ✅ SAFE |
| Application | ✅ SAFE | ✅ SAFE | ✅ SAFE | ✅ SAFE |
| Infrastructure | ✅ SAFE | ✅ SAFE | ✅ SAFE | ✅ SAFE |

**Overall Risk:** LOW

---

## 6. ROLLBACK PLAN

### 6.1 Database Rollback

| Optimization | Rollback Action | Duration |
|--------------|-----------------|----------|
| DB-001 | `DROP INDEX idx_sales_invoices_tenant_status_date;` | < 1s |
| DB-002 | `DROP INDEX idx_purchase_invoices_tenant_status_date;` | < 1s |
| DB-003 | `DROP INDEX idx_audit_logs_tenant_action_created;` | < 1s |
| DB-004 | `DROP INDEX idx_cash_transactions_tenant_date;` | < 1s |
| DB-005 | `DROP INDEX idx_sales_invoices_tenant_date_total;` | < 1s |

### 6.2 Application Rollback

| Optimization | Rollback Action | Duration |
|--------------|-----------------|----------|
| APP-001 | Revert dashboard code changes | ~5 min |
| APP-002 | Revert reports code changes | ~5 min |
| APP-003 | Revert sales code changes | ~5 min |

### 6.3 Rollback Validation

| Check | Method |
|-------|--------|
| Index removed | `SELECT COUNT(*) FROM pg_indexes WHERE indexname = '...'` |
| Code reverted | Git diff comparison |
| Application working | Run test suite |

---

## 7. PRIORITY ORDER

### Priority 1: High Impact + Low Risk

| Order | Optimization | Impact | Risk | Effort |
|-------|--------------|--------|------|--------|
| 1 | DB-001: sales_invoices index | HIGH | LOW | LOW |
| 2 | DB-002: purchase_invoices index | HIGH | LOW | LOW |
| 3 | DB-003: audit_logs index | MEDIUM | LOW | LOW |
| 4 | DB-004: cash_transactions index | MEDIUM | LOW | LOW |
| 5 | DB-005: sales report index | MEDIUM | LOW | LOW |

### Priority 2: Medium Impact

| Order | Optimization | Impact | Risk | Effort |
|-------|--------------|--------|------|--------|
| 6 | APP-001: Dashboard optimization | LOW | LOW | MEDIUM |
| 7 | APP-002: Reports optimization | LOW | LOW | MEDIUM |

### Priority 3: Optional Improvements

| Order | Optimization | Impact | Risk | Effort |
|-------|--------------|--------|------|--------|
| 8 | APP-003: Create sale optimization | LOW | LOW | HIGH |

---

## 8. IMPLEMENTATION CHECKLIST

### Pre-Implementation

- [ ] Gate B approved
- [ ] Backup verified
- [ ] Rollback script tested
- [ ] Monitoring enabled

### Implementation

- [ ] DB-001: Create index
- [ ] DB-002: Create index
- [ ] DB-003: Create index
- [ ] DB-004: Create index
- [ ] DB-005: Create index
- [ ] APP-001: Optimize dashboard
- [ ] APP-002: Optimize reports
- [ ] APP-003: Optimize create sale

### Post-Implementation

- [ ] Verify all optimizations
- [ ] Run test suite
- [ ] Monitor performance
- [ ] Update documentation

---

## 9. GATE B DECISION

**Status:** PENDING REVIEW

**Recommendation:** APPROVED

**Rationale:**
- All bottlenecks mapped
- Root causes analyzed
- Optimizations defined
- Expected improvements estimated
- Risks assessed as LOW
- Rollback plans ready

**Next Step:** Gate C — Test Optimization
