# PHASE 23E - SCHEMA AUDIT
## Gate A: Database Audit

**Date:** 2026-08-05  
**Status:** PENDING REVIEW  
**Objective:** Understand current database state

---

## 1. Architecture Overview

### Hybrid Persistence Model

| Mode | Storage | Access Pattern |
|------|---------|----------------|
| **Local Mode** | JSON files in `backend/data/` | `fileStore.js` (atomic reads/writes) |
| **Cloud Mode** | Supabase (PostgreSQL) | Direct SQL via Edge Functions |

### Database Schemas

| Schema | Purpose | Tables |
|--------|---------|--------|
| `public` | Current production (single-tenant) | 12 tables |
| `omnistore` | Target multi-tenant | 30+ tables |
| `omnistore_admin` | SaaS administration | 3 tables |
| `omnistore_control` | Deployment orchestration | 3 tables |

---

## 2. Current Schema (public)

### Tables Inventory

| Table | Purpose | Rows (est.) | Risk |
|-------|---------|-------------|------|
| `products` | Product catalog | ~500 | LOW |
| `sales` | Sales invoices | ~2000 | MEDIUM |
| `sale_items` | Sales line items | ~5000 | MEDIUM |
| `purchases` | Purchase invoices | ~1000 | MEDIUM |
| `purchase_items` | Purchase line items | ~3000 | MEDIUM |
| `cash_transactions` | Cash movements | ~3000 | LOW |
| `stock_transactions` | Stock movements | ~4000 | LOW |
| `daily_closing` | Day-end reports | ~365 | LOW |
| `audit_logs` | Audit trail | ~10000 | LOW |
| `user_roles` | User permissions | ~10 | LOW |
| `devices` | Device inventory | ~200 | LOW |
| `device_repairs` | Repair tracking | ~100 | LOW |

### Columns Inventory

#### products
| Column | Type | Nullable | Default | Notes |
|--------|------|----------|---------|-------|
| id | uuid | NO | gen_random_uuid() | Primary key |
| legacy_id | text | YES | NULL | Unique, for migration |
| sku | text | YES | NULL | Stock keeping unit |
| name | text | NO | - | Product name |
| has_serial | boolean | NO | false | Serial tracking |
| buy_price | numeric(14,2) | NO | 0 | Cost price |
| sell_price | numeric(14,2) | NO | 0 | Selling price |
| min_stock | numeric(14,3) | NO | 0 | Minimum stock level |
| metadata | jsonb | NO | '{}' | Flexible data |
| created_at | timestamptz | NO | now() | Creation timestamp |
| updated_at | timestamptz | NO | now() | Last update |

#### sales
| Column | Type | Nullable | Default | Notes |
|--------|------|----------|---------|-------|
| id | uuid | NO | gen_random_uuid() | Primary key |
| invoice_no | text | NO | - | Unique invoice number |
| sale_date | timestamptz | NO | now() | Sale date |
| customer_name | text | NO | 'عميل نقدي' | Customer name |
| customer_phone | text | YES | NULL | Customer phone |
| invoice_type | text | NO | 'cash' | cash/credit |
| payment_method | text | NO | 'cash' | Payment method |
| subtotal | numeric(14,2) | NO | 0 | Subtotal |
| discount | numeric(14,2) | NO | 0 | Discount |
| total | numeric(14,2) | NO | 0 | Total |
| profit | numeric(14,2) | NO | 0 | Profit |
| status | text | NO | 'active' | active/cancelled |
| note | text | YES | NULL | Notes |
| created_by | text | YES | NULL | Creator |
| cancelled_at | timestamptz | YES | NULL | Cancellation time |
| cancel_reason | text | YES | NULL | Cancellation reason |
| raw_payload | jsonb | NO | '{}' | Original payload |
| created_at | timestamptz | NO | now() | Creation timestamp |

#### sale_items
| Column | Type | Nullable | Default | Notes |
|--------|------|----------|---------|-------|
| id | uuid | NO | gen_random_uuid() | Primary key |
| sale_id | uuid | NO | - | FK to sales |
| product_id | uuid | YES | NULL | FK to products |
| legacy_product_id | text | YES | NULL | Legacy product ID |
| name | text | NO | - | Product name |
| qty | numeric(14,3) | NO | - | Quantity (CHECK > 0) |
| unit_price | numeric(14,2) | NO | 0 | Unit price |
| unit_cost | numeric(14,2) | NO | 0 | Unit cost |
| serials | jsonb | NO | '[]' | Serial numbers |
| metadata | jsonb | NO | '{}' | Flexible data |
| created_at | timestamptz | NO | now() | Creation timestamp |

#### purchases
| Column | Type | Nullable | Default | Notes |
|--------|------|----------|---------|-------|
| id | uuid | NO | gen_random_uuid() | Primary key |
| invoice_no | text | NO | - | Unique invoice number |
| purchase_date | timestamptz | NO | now() | Purchase date |
| supplier_name | text | NO | '' | Supplier name |
| supplier_phone | text | YES | NULL | Supplier phone |
| invoice_type | text | NO | 'cash' | cash/credit |
| payment_method | text | NO | 'cash' | Payment method |
| subtotal | numeric(14,2) | NO | 0 | Subtotal |
| discount | numeric(14,2) | NO | 0 | Discount |
| total | numeric(14,2) | NO | 0 | Total |
| status | text | NO | 'active' | active/cancelled |
| note | text | YES | NULL | Notes |
| created_by | text | YES | NULL | Creator |
| cancelled_at | timestamptz | YES | NULL | Cancellation time |
| cancel_reason | text | YES | NULL | Cancellation reason |
| raw_payload | jsonb | NO | '{}' | Original payload |
| created_at | timestamptz | NO | now() | Creation timestamp |

#### purchase_items
| Column | Type | Nullable | Default | Notes |
|--------|------|----------|---------|-------|
| id | uuid | NO | gen_random_uuid() | Primary key |
| purchase_id | uuid | NO | - | FK to purchases |
| product_id | uuid | YES | NULL | FK to products |
| legacy_product_id | text | YES | NULL | Legacy product ID |
| name | text | NO | - | Product name |
| qty | numeric(14,3) | NO | - | Quantity (CHECK > 0) |
| unit_price | numeric(14,2) | NO | 0 | Unit price |
| serials | jsonb | NO | '[]' | Serial numbers |
| metadata | jsonb | NO | '{}' | Flexible data |
| created_at | timestamptz | NO | now() | Creation timestamp |

#### cash_transactions
| Column | Type | Nullable | Default | Notes |
|--------|------|----------|---------|-------|
| id | uuid | NO | gen_random_uuid() | Primary key |
| transaction_date | timestamptz | NO | now() | Transaction date |
| direction | text | NO | - | CHECK in/out |
| amount | numeric(14,2) | NO | - | CHECK > 0 |
| method | text | NO | 'cash' | Payment method |
| source_type | text | NO | - | Source type |
| source_id | uuid | YES | NULL | Source ID |
| source_ref | text | YES | NULL | Source reference |
| description | text | YES | NULL | Description |
| created_by | text | YES | NULL | Creator |
| metadata | jsonb | NO | '{}' | Flexible data |
| created_at | timestamptz | NO | now() | Creation timestamp |

#### stock_transactions
| Column | Type | Nullable | Default | Notes |
|--------|------|----------|---------|-------|
| id | uuid | NO | gen_random_uuid() | Primary key |
| transaction_date | timestamptz | NO | now() | Transaction date |
| product_id | uuid | YES | NULL | FK to products |
| legacy_product_id | text | YES | NULL | Legacy product ID |
| direction | text | NO | - | CHECK in/out |
| qty | numeric(14,3) | NO | - | CHECK > 0 |
| source_type | text | NO | - | Source type |
| source_id | uuid | YES | NULL | Source ID |
| source_ref | text | YES | NULL | Source reference |
| serials | jsonb | NO | '[]' | Serial numbers |
| description | text | YES | NULL | Description |
| created_by | text | YES | NULL | Creator |
| metadata | jsonb | NO | '{}' | Flexible data |
| created_at | timestamptz | NO | now() | Creation timestamp |

#### daily_closing
| Column | Type | Nullable | Default | Notes |
|--------|------|----------|---------|-------|
| id | uuid | NO | gen_random_uuid() | Primary key |
| close_date | date | NO | - | Unique closing date |
| cash_total | numeric(14,2) | NO | 0 | Cash total |
| stock_value | numeric(14,2) | NO | 0 | Stock value |
| sales_total | numeric(14,2) | NO | 0 | Sales total |
| purchases_total | numeric(14,2) | NO | 0 | Purchases total |
| closed_by | text | YES | NULL | Closer |
| notes | text | YES | NULL | Notes |
| created_at | timestamptz | NO | now() | Creation timestamp |

#### audit_logs
| Column | Type | Nullable | Default | Notes |
|--------|------|----------|---------|-------|
| id | uuid | NO | gen_random_uuid() | Primary key |
| action | text | NO | - | Action type |
| entity_type | text | YES | NULL | Entity type |
| entity_id | uuid | YES | NULL | Entity ID |
| entity_ref | text | YES | NULL | Entity reference |
| details | jsonb | NO | '{}' | Action details |
| created_by | text | YES | NULL | Actor |
| created_at | timestamptz | NO | now() | Creation timestamp |

#### user_roles
| Column | Type | Nullable | Default | Notes |
|--------|------|----------|---------|-------|
| id | uuid | NO | gen_random_uuid() | Primary key |
| username | text | NO | - | Unique username |
| role | text | NO | - | Role name |
| can_manage_finance | boolean | NO | false | Finance permission |
| can_manage_stock | boolean | NO | false | Stock permission |
| created_at | timestamptz | NO | now() | Creation timestamp |
| updated_at | timestamptz | NO | now() | Last update |

#### devices
| Column | Type | Nullable | Default | Notes |
|--------|------|----------|---------|-------|
| id | uuid | NO | gen_random_uuid() | Primary key |
| serial_number | text | YES | NULL | Unique (partial) |
| imei | text | YES | NULL | Unique (partial) |
| service_tag | text | YES | NULL | Unique (partial) |
| asset_tag | text | YES | NULL | Asset tag |
| warranty_start | date | YES | NULL | Warranty start |
| warranty_end | date | YES | NULL | Warranty end |
| warranty_status | text | NO | 'unknown' | CHECK active/expired/unknown |
| customer_id | text | YES | NULL | Customer ID |
| customer_name | text | YES | NULL | Customer name |
| customer_phone | text | YES | NULL | Customer phone |
| product_id | uuid | YES | NULL | FK to products |
| legacy_product_id | text | YES | NULL | Legacy product ID |
| product_name | text | YES | NULL | Product name |
| sale_id | uuid | YES | NULL | FK to sales |
| sale_ref | text | YES | NULL | Sale reference |
| purchase_id | uuid | YES | NULL | FK to purchases |
| purchase_ref | text | YES | NULL | Purchase reference |
| status | text | NO | 'available' | CHECK available/sold/repair/returned/scrapped |
| notes | text | YES | NULL | Notes |
| metadata | jsonb | NO | '{}' | Flexible data |
| created_at | timestamptz | NO | now() | Creation timestamp |
| updated_at | timestamptz | NO | now() | Last update |

#### device_repairs
| Column | Type | Nullable | Default | Notes |
|--------|------|----------|---------|-------|
| id | uuid | NO | gen_random_uuid() | Primary key |
| device_id | uuid | NO | - | FK to devices |
| repair_date | timestamptz | NO | now() | Repair date |
| issue | text | NO | - | Issue description |
| solution | text | YES | NULL | Solution |
| cost | numeric(14,2) | NO | 0 | Repair cost |
| technician | text | YES | NULL | Technician |
| status | text | NO | 'open' | CHECK open/in_progress/done/cancelled |
| notes | text | YES | NULL | Notes |
| created_by | text | YES | NULL | Creator |
| created_at | timestamptz | NO | now() | Creation timestamp |
| updated_at | timestamptz | NO | now() | Last update |

### Views

| View | Purpose | Tables Used |
|------|---------|-------------|
| `cash_balance` | Current cash balance | cash_transactions |
| `product_stock_balance` | Current stock levels | products, stock_transactions |

### Stored Procedures

| Function | Purpose | Tables Modified |
|----------|---------|-----------------|
| `create_sale(jsonb)` | Create sale invoice | sales, sale_items, stock_transactions, cash_transactions, audit_logs |
| `create_purchase(jsonb)` | Create purchase invoice | purchases, purchase_items, stock_transactions, cash_transactions, audit_logs |
| `cancel_sale(text, text, text)` | Cancel sale invoice | sales, cash_transactions, stock_transactions, audit_logs |
| `close_day(date, text, text)` | Close day | daily_closing, audit_logs |

### Indexes

| Index | Table | Columns | Type |
|-------|-------|---------|------|
| `devices_serial_number_unique` | devices | serial_number | UNIQUE (partial) |
| `devices_imei_unique` | devices | imei | UNIQUE (partial) |
| `devices_service_tag_unique` | devices | service_tag | UNIQUE (partial) |
| `idx_sales_invoice_no` | sales | invoice_no | BTREE |
| `idx_sale_items_sale_id` | sale_items | sale_id | BTREE |
| `idx_purchases_invoice_no` | purchases | invoice_no | BTREE |
| `idx_cash_source` | cash_transactions | source_type, source_ref | BTREE |
| `idx_stock_source` | stock_transactions | source_type, source_ref | BTREE |
| `idx_devices_customer` | devices | customer_name, customer_phone | BTREE |
| `idx_devices_status` | devices | status | BTREE |
| `idx_device_repairs_device_id` | device_repairs | device_id | BTREE |

### Foreign Keys

| Table | Column | References | On Delete |
|-------|--------|------------|-----------|
| sale_items | sale_id | sales(id) | CASCADE |
| sale_items | product_id | products(id) | NO ACTION |
| purchase_items | purchase_id | purchases(id) | CASCADE |
| purchase_items | product_id | products(id) | NO ACTION |
| devices | product_id | products(id) | NO ACTION |
| devices | sale_id | sales(id) | NO ACTION |
| devices | purchase_id | purchases(id) | NO ACTION |
| device_repairs | device_id | devices(id) | CASCADE |

### Row-Level Security (RLS)

| Table | Policies |
|-------|----------|
| products | Enabled (select, insert, update) |
| sales | Enabled |
| sale_items | Enabled |
| purchases | Enabled |
| purchase_items | Enabled |
| cash_transactions | Enabled |
| stock_transactions | Enabled |
| daily_closing | Enabled |
| audit_logs | Enabled |
| user_roles | Enabled |
| devices | Enabled (select, insert, update for anon, authenticated) |
| device_repairs | Enabled (select, insert, update for anon, authenticated) |

---

## 3. Target Schema (omnistore)

### Tables Inventory (30+ tables)

| Table | Purpose | Migration Status |
|-------|---------|------------------|
| `tenants` | Tenant registry | READY |
| `business_profiles` | Company info | READY |
| `user_profiles` | User-tenant mapping | READY |
| `role_templates` | Role definitions | READY |
| `permission_templates` | Permission definitions | READY |
| `roles` | Tenant roles | READY |
| `permissions` | Tenant permissions | READY |
| `role_permissions` | Role-permission mapping | READY |
| `currencies` | Currency definitions | READY |
| `taxes` | Tax configurations | READY |
| `branches` | Branch locations | READY |
| `customers` | Customer registry | READY |
| `suppliers` | Supplier registry | READY |
| `categories` | Product categories | READY |
| `products` | Product catalog (multi-tenant) | READY |
| `warehouses` | Warehouse locations | READY |
| `inventory_transactions` | Stock movements | READY |
| `sales_invoices` | Sales (multi-tenant) | READY |
| `sales_invoice_lines` | Sales line items | READY |
| `purchase_invoices` | Purchases (multi-tenant) | READY |
| `purchase_invoice_lines` | Purchase line items | READY |
| `pos_transactions` | POS transactions | READY |
| `pos_settings` | POS configuration | READY |
| `chart_of_accounts` | Account structure | READY |
| `journal_vouchers` | Journal entries | READY |
| `journal_lines` | Journal line items | READY |
| `accounting_settings` | Accounting config | READY |
| `printing_settings` | Print configuration | READY |
| `system_settings` | System configuration | READY |
| `audit_logs` | Audit trail (multi-tenant) | READY |
| `workspaces` | Workspace management | READY |
| `subscriptions` | Subscription plans | READY |
| `tenant_api_credentials` | API keys | READY |
| `cashboxes` | Cash management | READY |
| `report_settings` | Report configuration | READY |
| `tenant_storage_usage` | Storage metrics | READY |
| `provision_history` | Provisioning audit | READY |
| `workspace_audit` | Workspace audit | READY |

---

## 4. Data Volume Analysis

### Current Data (Estimated)

| Table | Rows | Size (MB) | Growth Rate |
|-------|------|-----------|-------------|
| products | ~500 | ~0.5 | Low |
| sales | ~2,000 | ~2 | Medium |
| sale_items | ~5,000 | ~5 | Medium |
| purchases | ~1,000 | ~1 | Medium |
| purchase_items | ~3,000 | ~3 | Medium |
| cash_transactions | ~3,000 | ~3 | Medium |
| stock_transactions | ~4,000 | ~4 | Medium |
| daily_closing | ~365 | ~0.1 | Low |
| audit_logs | ~10,000 | ~10 | High |
| user_roles | ~10 | ~0.01 | Low |
| devices | ~200 | ~0.2 | Low |
| device_repairs | ~100 | ~0.1 | Low |
| **TOTAL** | ~29,175 | ~29 | - |

### Local Mode Data (JSON)

| File | Size (KB) | Records |
|------|-----------|---------|
| sales.json | ~500 | ~2,000 |
| purchases.json | ~300 | ~1,000 |
| **TOTAL** | ~800 | ~3,000 |

---

## 5. Risk Assessment

### High Risk

| Risk | Impact | Mitigation |
|------|--------|------------|
| Data loss during migration | CRITICAL | Full backup before migration |
| Schema incompatibility | HIGH | Dry run on staging |
| Application downtime | HIGH | Blue-green deployment |

### Medium Risk

| Risk | Impact | Mitigation |
|------|--------|------------|
| Performance degradation | MEDIUM | Query optimization |
| Index bloat | MEDIUM | Index maintenance |
| RLS policy conflicts | MEDIUM | Policy review |

### Low Risk

| Risk | Impact | Mitigation |
|------|--------|------------|
| Metadata format changes | LOW | JSONB compatibility |
| Timestamp timezone issues | LOW | Consistent UTC |
| UUID generation conflicts | LOW | UUID v4 |

---

## 6. Gate A Decision

**Status:** PENDING REVIEW

**Recommendation:** APPROVED

**Rationale:**
- Current schema is well-documented
- Target schema is ready for migration
- Data volume is manageable
- Risks are identified and mitigated

**Next Step:** Gate B — Migration Design
