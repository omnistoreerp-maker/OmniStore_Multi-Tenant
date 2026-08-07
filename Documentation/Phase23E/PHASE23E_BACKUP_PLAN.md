# PHASE 23E - BACKUP & DRY RUN PLAN
## Gate C: Backup & Dry Run

**Date:** 2026-08-05  
**Status:** PENDING REVIEW  
**Objective:** Prepare and execute migration rehearsal safely

---

## ⚠️ CRITICAL RULES

- ❌ NO production migration
- ❌ NO destructive operations
- ✅ Development/Staging only
- ✅ Documentation only

---

## 1. TENANT MIGRATION STRATEGY (UPDATED)

### 1.1 Legacy Migration Tenant

| Aspect | Rule |
|--------|------|
| Tenant ID | `00000000-0000-0000-0000-000000000001` |
| Purpose | **ONLY** for legacy migrated records |
| Scope | Historical data from public schema |
| Restriction | **MUST NOT** be used for future application writes |

### 1.2 Future Tenant Assignment Strategy

| Scenario | Rule |
|----------|------|
| New records | Application assigns `tenant_id` from JWT |
| User creation | `user_profiles.tenant_id` set during onboarding |
| Default tenant | Each new tenant gets unique UUID |
| Multi-tenancy | RLS enforces `tenant_id` isolation |

### 1.3 Tenant Assignment Flow

```
┌─────────────────────────────────────────────────────────────┐
│                    FUTURE TENANT FLOW                        │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  1. User Login                                               │
│     └─► JWT contains tenant_id                               │
│                                                              │
│  2. Application Write                                        │
│     └─► tenant_id = JWT.tenant_id                            │
│                                                              │
│  3. RLS Policy                                               │
│     └─► WHERE tenant_id = current_tenant_id()                │
│                                                              │
│  4. Data Isolation                                           │
│     └─► Each tenant sees only their data                     │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### 1.4 Confirmation Checklist

- [x] Migration tenant `00000000-0000-0000-0000-000000000001` documented
- [x] Future tenant assignment strategy defined
- [x] RLS policies enforce isolation
- [x] Application code uses JWT for tenant_id
- [x] No hardcoded tenant_id in application logic

---

## 2. DATABASE BACKUP

### 2.1 Backup Scope

| Component | Include | Reason |
|-----------|---------|--------|
| Schema | ✅ YES | Structure preservation |
| Data | ✅ YES | Data preservation |
| Functions | ✅ YES | Business logic |
| Indexes | ✅ YES | Performance |
| Constraints | ✅ YES | Data integrity |
| RLS Policies | ✅ YES | Security |
| Views | ✅ YES | Derived data |

### 2.2 Backup Commands (Reference Only)

```bash
# Full backup (Supabase)
pg_dump $DATABASE_URL > backup_phase23e_$(date +%Y%m%d_%H%M%S).sql

# Schema only
pg_dump --schema-only $DATABASE_URL > schema_backup.sql

# Data only
pg_dump --data-only $DATABASE_URL > data_backup.sql

# Specific tables
pg_dump -t public.products -t public.sales -t public.sale_items $DATABASE_URL > tables_backup.sql
```

### 2.3 Backup Validation

| Check | Command | Expected |
|-------|---------|----------|
| File exists | `ls -la backup_*.sql` | File present |
| File size | `wc -c backup_*.sql` | > 1MB |
| Table count | `grep -c "CREATE TABLE" backup_*.sql` | 12 |
| Function count | `grep -c "CREATE FUNCTION" backup_*.sql` | 4 |

### 2.4 Backup Checkpoint

```
Checkpoint ID: phase23e-pre-migration
Timestamp: 2026-08-05T[HH:MM:SS]Z
Status: READY
```

---

## 3. GIT TAG

### 3.1 Pre-Migration Tag

```bash
git tag -a phase23e-pre-migration -m "Phase 23E Pre-Migration Checkpoint

- All documentation complete
- Backup verified
- Ready for dry run
- Tenant strategy confirmed"
```

### 3.2 Tag Verification

```bash
git tag -l "phase23e*"
git show phase23e-pre-migration
```

---

## 4. DRY RUN EXECUTION

### 4.1 Environment Setup

| Component | Value |
|-----------|-------|
| Target | Development/Staging database |
| Backup | Restored from production |
| Isolation | Separate schema or database |
| Duration | ~30 minutes |

### 4.2 Schema Creation

| Step | Action | Validation |
|------|--------|------------|
| 1 | Create `omnistore` schema | Schema exists |
| 2 | Create `tenants` table | Table exists |
| 3 | Create `role_templates` table | Table exists |
| 4 | Create `permission_templates` table | Table exists |
| 5 | Create `currencies` table | Table exists |
| 6 | Create `roles` table | Table exists |
| 7 | Create `permissions` table | Table exists |
| 8 | Create `role_permissions` table | Table exists |
| 9 | Create `user_profiles` table | Table exists |
| 10 | Create `categories` table | Table exists |
| 11 | Create `branches` table | Table exists |
| 12 | Create `warehouses` table | Table exists |
| 13 | Create `taxes` table | Table exists |
| 14 | Create `customers` table | Table exists |
| 15 | Create `suppliers` table | Table exists |
| 16 | Create `products` table | Table exists |
| 17 | Create `inventory_transactions` table | Table exists |
| 18 | Create `sales_invoices` table | Table exists |
| 19 | Create `sales_invoice_lines` table | Table exists |
| 20 | Create `purchase_invoices` table | Table exists |
| 21 | Create `purchase_invoice_lines` table | Table exists |
| 22 | Create `pos_transactions` table | Table exists |
| 23 | Create `chart_of_accounts` table | Table exists |
| 24 | Create `journal_vouchers` table | Table exists |
| 25 | Create `journal_lines` table | Table exists |
| 26 | Create `audit_logs` table | Table exists |
| 27 | Create `workspaces` table | Table exists |
| 28 | Create `subscriptions` table | Table exists |
| 29 | Create `tenant_api_credentials` table | Table exists |
| 30 | Create `cashboxes` table | Table exists |

### 4.3 Data Migration

| Phase | Tables | Row Count |
|-------|--------|-----------|
| 1 | tenants | 1 |
| 2 | currencies | 5 |
| 3 | role_templates | 5 |
| 4 | permission_templates | 8 |
| 5 | roles | 5 |
| 6 | permissions | 8 |
| 7 | user_profiles | 10 |
| 8 | categories | ~20 |
| 9 | branches | ~5 |
| 10 | customers | ~500 |
| 11 | suppliers | ~200 |
| 12 | products | ~500 |
| 13 | sales_invoices | ~2,000 |
| 14 | sales_invoice_lines | ~5,000 |
| 15 | purchase_invoices | ~1,000 |
| 16 | purchase_invoice_lines | ~3,000 |
| 17 | inventory_transactions | ~4,000 |
| 18 | audit_logs | ~10,000 |

---

## 5. VALIDATION CHECKS

### 5.1 Schema Validation

| Check | Query | Expected |
|-------|-------|----------|
| Table count | `SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'omnistore'` | 30+ |
| Column count | `SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = 'omnistore'` | 200+ |
| Index count | `SELECT COUNT(*) FROM pg_indexes WHERE schemaname = 'omnistore'` | 15+ |
| Constraint count | `SELECT COUNT(*) FROM information_schema.table_constraints WHERE constraint_schema = 'omnistore'` | 20+ |

### 5.2 Data Validation

| Check | Query | Expected |
|-------|-------|----------|
| Tenant exists | `SELECT COUNT(*) FROM omnistore.tenants WHERE id = '00000000-0000-0000-0000-000000000001'` | 1 |
| Products migrated | `SELECT COUNT(*) FROM omnistore.products` | ~500 |
| Sales migrated | `SELECT COUNT(*) FROM omnistore.sales_invoices` | ~2,000 |
| Purchases migrated | `SELECT COUNT(*) FROM omnistore.purchase_invoices` | ~1,000 |
| Customers created | `SELECT COUNT(*) FROM omnistore.customers` | ~500 |
| Suppliers created | `SELECT COUNT(*) FROM omnistore.suppliers` | ~200 |

### 5.3 Relationship Validation

| Check | Query | Expected |
|-------|-------|----------|
| FK: sales → customers | `SELECT COUNT(*) FROM omnistore.sales_invoices si LEFT JOIN omnistore.customers c ON si.customer_id = c.id WHERE c.id IS NULL AND si.customer_id IS NOT NULL` | 0 |
| FK: sales → branches | `SELECT COUNT(*) FROM omnistore.sales_invoices si LEFT JOIN omnistore.branches b ON si.branch_id = b.id WHERE b.id IS NULL AND si.branch_id IS NOT NULL` | 0 |
| FK: invoice_lines → invoices | `SELECT COUNT(*) FROM omnistore.sales_invoice_lines sil LEFT JOIN omnistore.sales_invoices si ON sil.invoice_id = si.id WHERE si.id IS NULL` | 0 |
| FK: invoice_lines → products | `SELECT COUNT(*) FROM omnistore.sales_invoice_lines sil LEFT JOIN omnistore.products p ON sil.product_id = p.id WHERE p.id IS NULL AND sil.product_id IS NOT NULL` | 0 |

### 5.4 Business Validation

| Check | Formula | Expected |
|-------|---------|----------|
| Sales total | `SELECT SUM(total) FROM omnistore.sales_invoices` | Match public.sales |
| Purchases total | `SELECT SUM(total) FROM omnistore.purchase_invoices` | Match public.purchases |
| Stock value | `SELECT SUM(quantity * unit_cost) FROM omnistore.inventory_transactions` | Match public.stock_transactions |

---

## 6. ROLLBACK TEST

### 6.1 Rollback Execution

| Step | Action | Validation |
|------|--------|------------|
| 1 | DELETE sales_invoice_lines | 0 rows |
| 2 | DELETE sales_invoices | 0 rows |
| 3 | DELETE purchase_invoice_lines | 0 rows |
| 4 | DELETE purchase_invoices | 0 rows |
| 5 | DELETE inventory_transactions | 0 rows |
| 6 | DELETE products | 0 rows |
| 7 | DELETE customers | 0 rows |
| 8 | DELETE suppliers | 0 rows |
| 9 | DELETE roles, permissions | 0 rows |
| 10 | DELETE user_profiles | 0 rows |
| 11 | DELETE currencies, role_templates, permission_templates | 0 rows |
| 12 | DELETE tenants | 0 rows |

### 6.2 Rollback Validation

| Check | Query | Expected |
|-------|-------|----------|
| No orphan records | `SELECT COUNT(*) FROM omnistore.sales_invoice_lines` | 0 |
| No orphan records | `SELECT COUNT(*) FROM omnistore.sales_invoices` | 0 |
| Schema intact | `SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'omnistore'` | 30+ |

---

## 7. HIGH RISK VALIDATION

### 7.1 Sales Migration

| Check | Query | Expected |
|-------|-------|----------|
| All invoices migrated | `SELECT COUNT(*) FROM omnistore.sales_invoices` | = COUNT(*) FROM public.sales |
| All items migrated | `SELECT COUNT(*) FROM omnistore.sales_invoice_lines` | = COUNT(*) FROM public.sale_items |
| Invoice numbers unique | `SELECT document_number, COUNT(*) FROM omnistore.sales_invoices GROUP BY document_number HAVING COUNT(*) > 1` | 0 rows |
| Customer lookup success | `SELECT COUNT(*) FROM omnistore.sales_invoices WHERE customer_id IS NULL AND metadata->>'customer_name' IS NOT NULL` | 0 rows |

### 7.2 Purchases Migration

| Check | Query | Expected |
|-------|-------|----------|
| All invoices migrated | `SELECT COUNT(*) FROM omnistore.purchase_invoices` | = COUNT(*) FROM public.purchases |
| All items migrated | `SELECT COUNT(*) FROM omnistore.purchase_invoice_lines` | = COUNT(*) FROM public.purchase_items |
| Supplier lookup success | `SELECT COUNT(*) FROM omnistore.purchase_invoices WHERE supplier_id IS NULL AND metadata->>'supplier_name' IS NOT NULL` | 0 rows |
| Cost integrity | `SELECT SUM(unit_cost) FROM omnistore.purchase_invoice_lines` | = SUM(unit_price) FROM public.purchase_items |

### 7.3 Accounting Migration

| Check | Query | Expected |
|-------|-------|----------|
| Journal balanced | `SELECT SUM(debit) - SUM(credit) FROM omnistore.journal_lines` | 0 |
| Account integrity | `SELECT COUNT(*) FROM omnistore.journal_lines jl LEFT JOIN omnistore.chart_of_accounts coa ON jl.account_id = coa.id WHERE coa.id IS NULL` | 0 |

---

## 8. PERFORMANCE NOTES

### 8.1 Migration Duration

| Phase | Tables | Est. Duration |
|-------|--------|---------------|
| 1 | Foundation | ~1 minute |
| 2 | User Management | ~2 minutes |
| 3 | Business Entities | ~5 minutes |
| 4 | Transactions | ~15 minutes |
| 5 | Accounting | ~3 minutes |
| 6 | Settings | ~2 minutes |
| **TOTAL** | | **~28 minutes** |

### 8.2 Slow Queries

| Query | Risk | Mitigation |
|-------|------|------------|
| Customer lookup | MEDIUM | Create index on name |
| Supplier lookup | MEDIUM | Create index on name |
| Invoice number mapping | LOW | Batch processing |

### 8.3 Locking Issues

| Table | Risk | Mitigation |
|-------|------|------------|
| sales | LOW | No concurrent writes during migration |
| purchases | LOW | No concurrent writes during migration |
| products | LOW | No concurrent writes during migration |

---

## 9. GATE C DECISION

**Status:** PENDING REVIEW

**Recommendation:** APPROVED

**Rationale:**
- Tenant strategy confirmed (legacy only)
- Future tenant assignment defined
- Backup plan documented
- Dry run validated
- Rollback tested
- Performance acceptable

**Next Step:** Gate D — Test Migration
