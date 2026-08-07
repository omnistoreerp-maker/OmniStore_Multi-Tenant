# PHASE 23E - MIGRATION PLAN
## Gate B: Database Migration Design

**Date:** 2026-08-05  
**Status:** PENDING REVIEW  
**Objective:** Design complete migration strategy

---

## ⚠️ CRITICAL RULES

- ❌ NO SQL execution
- ❌ NO database modifications
- ❌ NO data changes
- ✅ Design only

---

## 1. CURRENT → TARGET MAPPING

### 1.1 Products

#### Current: `public.products`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| legacy_id | text | Unique, for migration |
| sku | text | Stock keeping unit |
| name | text | Product name |
| has_serial | boolean | Serial tracking |
| buy_price | numeric(14,2) | Cost price |
| sell_price | numeric(14,2) | Selling price |
| min_stock | numeric(14,3) | Minimum stock |
| metadata | jsonb | Flexible data |
| created_at | timestamptz | Creation time |
| updated_at | timestamptz | Last update |

**Data Volume:** ~500 rows

#### Target: `omnistore.products`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| tenant_id | uuid | **NEW** FK to tenants |
| category_id | uuid | **NEW** FK to categories |
| sku | text | Unique per tenant |
| barcode | text | **NEW** Barcode |
| name | text | Product name |
| cost | numeric(18,4) | Cost (was buy_price) |
| price | numeric(18,4) | Price (was sell_price) |
| tax_code | text | **NEW** Tax reference |
| metadata | jsonb | Flexible data |
| enabled | boolean | **NEW** Active flag |
| created_at | timestamptz | Creation time |
| updated_at | timestamptz | Last update |

#### Action: **TRANSFORM**

| Field Mapping | Rule |
|---------------|------|
| id → id | Keep UUID |
| legacy_id → metadata.legacy_id | Move to metadata |
| sku → sku | Keep, add tenant_id prefix |
| name → name | Keep |
| has_serial → metadata.has_serial | Move to metadata |
| buy_price → cost | Rename, increase precision |
| sell_price → price | Rename, increase precision |
| min_stock → metadata.min_stock | Move to metadata |
| metadata → metadata | Merge |
| created_at → created_at | Keep |
| updated_at → updated_at | Keep |
| (new) tenant_id | Set to default tenant |
| (new) category_id | Set to NULL (uncategorized) |
| (new) barcode | Set to NULL |
| (new) tax_code | Set to NULL |
| (new) enabled | Set to true |

---

### 1.2 Sales

#### Current: `public.sales`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| invoice_no | text | Unique |
| sale_date | timestamptz | Sale date |
| customer_name | text | Customer name |
| customer_phone | text | Customer phone |
| invoice_type | text | cash/credit |
| payment_method | text | Payment method |
| subtotal | numeric(14,2) | Subtotal |
| discount | numeric(14,2) | Discount |
| total | numeric(14,2) | Total |
| profit | numeric(14,2) | Profit |
| status | text | active/cancelled |
| note | text | Notes |
| created_by | text | Creator |
| cancelled_at | timestamptz | Cancellation time |
| cancel_reason | text | Cancellation reason |
| raw_payload | jsonb | Original payload |
| created_at | timestamptz | Creation time |

**Data Volume:** ~2,000 rows

#### Target: `omnistore.sales_invoices`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| tenant_id | uuid | **NEW** FK to tenants |
| customer_id | uuid | **NEW** FK to customers |
| branch_id | uuid | **NEW** FK to branches |
| document_number | text | Was invoice_no |
| status | text | draft/posted/cancelled |
| total | numeric(18,4) | Total |
| currency | text | **NEW** Currency code |
| invoice_date | date | Was sale_date |
| created_at | timestamptz | Creation time |

#### Action: **TRANSFORM**

| Field Mapping | Rule |
|---------------|------|
| id → id | Keep UUID |
| invoice_no → document_number | Rename |
| sale_date → invoice_date | Convert to date |
| customer_name → customer_id | **LOOKUP** or create customer |
| customer_phone → customer.phone | Via customer lookup |
| invoice_type → status | Map: cash/credit → posted |
| payment_method → metadata.payment_method | Move to metadata |
| subtotal → metadata.subtotal | Move to metadata |
| discount → metadata.discount | Move to metadata |
| total → total | Keep |
| profit → metadata.profit | Move to metadata |
| status → status | Map: active → posted, cancelled → cancelled |
| note → metadata.note | Move to metadata |
| created_by → metadata.created_by | Move to metadata |
| cancelled_at → metadata.cancelled_at | Move to metadata |
| cancel_reason → metadata.cancel_reason | Move to metadata |
| raw_payload → metadata.raw_payload | Move to metadata |
| created_at → created_at | Keep |
| (new) tenant_id | Set to default tenant |
| (new) branch_id | Set to NULL |
| (new) currency | Set to 'EGP' |

---

### 1.3 Sale Items

#### Current: `public.sale_items`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| sale_id | uuid | FK to sales |
| product_id | uuid | FK to products |
| legacy_product_id | text | Legacy ID |
| name | text | Product name |
| qty | numeric(14,3) | Quantity |
| unit_price | numeric(14,2) | Unit price |
| unit_cost | numeric(14,2) | Unit cost |
| serials | jsonb | Serial numbers |
| metadata | jsonb | Flexible data |
| created_at | timestamptz | Creation time |

**Data Volume:** ~5,000 rows

#### Target: `omnistore.sales_invoice_lines`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| tenant_id | uuid | **NEW** FK to tenants |
| invoice_id | uuid | FK to sales_invoices |
| product_id | uuid | FK to products |
| quantity | numeric(18,4) | Was qty |
| unit_price | numeric(18,4) | Unit price |
| unit_cost | numeric(18,4) | Unit cost |

#### Action: **TRANSFORM**

| Field Mapping | Rule |
|---------------|------|
| id → id | Keep UUID |
| sale_id → invoice_id | **LOOKUP** new invoice ID |
| product_id → product_id | Keep (after product migration) |
| legacy_product_id → metadata.legacy_product_id | Move to metadata |
| name → metadata.name | Move to metadata |
| qty → quantity | Rename, increase precision |
| unit_price → unit_price | Increase precision |
| unit_cost → unit_cost | Increase precision |
| serials → metadata.serials | Move to metadata |
| metadata → metadata | Merge |
| created_at → metadata.created_at | Move to metadata |
| (new) tenant_id | Set to default tenant |

---

### 1.4 Purchases

#### Current: `public.purchases`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| invoice_no | text | Unique |
| purchase_date | timestamptz | Purchase date |
| supplier_name | text | Supplier name |
| supplier_phone | text | Supplier phone |
| invoice_type | text | cash/credit |
| payment_method | text | Payment method |
| subtotal | numeric(14,2) | Subtotal |
| discount | numeric(14,2) | Discount |
| total | numeric(14,2) | Total |
| status | text | active/cancelled |
| note | text | Notes |
| created_by | text | Creator |
| cancelled_at | timestamptz | Cancellation time |
| cancel_reason | text | Cancellation reason |
| raw_payload | jsonb | Original payload |
| created_at | timestamptz | Creation time |

**Data Volume:** ~1,000 rows

#### Target: `omnistore.purchase_invoices`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| tenant_id | uuid | **NEW** FK to tenants |
| supplier_id | uuid | **NEW** FK to suppliers |
| branch_id | uuid | **NEW** FK to branches |
| document_number | text | Was invoice_no |
| status | text | draft/posted/cancelled |
| total | numeric(18,4) | Total |
| currency | text | **NEW** Currency code |
| invoice_date | date | Was purchase_date |
| created_at | timestamptz | Creation time |

#### Action: **TRANSFORM**

| Field Mapping | Rule |
|---------------|------|
| id → id | Keep UUID |
| invoice_no → document_number | Rename |
| purchase_date → invoice_date | Convert to date |
| supplier_name → supplier_id | **LOOKUP** or create supplier |
| supplier_phone → supplier.phone | Via supplier lookup |
| invoice_type → status | Map: cash/credit → posted |
| payment_method → metadata.payment_method | Move to metadata |
| subtotal → metadata.subtotal | Move to metadata |
| discount → metadata.discount | Move to metadata |
| total → total | Keep |
| status → status | Map: active → posted, cancelled → cancelled |
| note → metadata.note | Move to metadata |
| created_by → metadata.created_by | Move to metadata |
| cancelled_at → metadata.cancelled_at | Move to metadata |
| cancel_reason → metadata.cancel_reason | Move to metadata |
| raw_payload → metadata.raw_payload | Move to metadata |
| created_at → created_at | Keep |
| (new) tenant_id | Set to default tenant |
| (new) branch_id | Set to NULL |
| (new) currency | Set to 'EGP' |

---

### 1.5 Purchase Items

#### Current: `public.purchase_items`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| purchase_id | uuid | FK to purchases |
| product_id | uuid | FK to products |
| legacy_product_id | text | Legacy ID |
| name | text | Product name |
| qty | numeric(14,3) | Quantity |
| unit_price | numeric(14,2) | Unit price |
| serials | jsonb | Serial numbers |
| metadata | jsonb | Flexible data |
| created_at | timestamptz | Creation time |

**Data Volume:** ~3,000 rows

#### Target: `omnistore.purchase_invoice_lines`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| tenant_id | uuid | **NEW** FK to tenants |
| invoice_id | uuid | FK to purchase_invoices |
| product_id | uuid | FK to products |
| quantity | numeric(18,4) | Was qty |
| unit_cost | numeric(18,4) | Was unit_price |

#### Action: **TRANSFORM**

| Field Mapping | Rule |
|---------------|------|
| id → id | Keep UUID |
| purchase_id → invoice_id | **LOOKUP** new invoice ID |
| product_id → product_id | Keep (after product migration) |
| legacy_product_id → metadata.legacy_product_id | Move to metadata |
| name → metadata.name | Move to metadata |
| qty → quantity | Rename, increase precision |
| unit_price → unit_cost | Rename, increase precision |
| serials → metadata.serials | Move to metadata |
| metadata → metadata | Merge |
| created_at → metadata.created_at | Move to metadata |
| (new) tenant_id | Set to default tenant |

---

### 1.6 Cash Transactions

#### Current: `public.cash_transactions`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| transaction_date | timestamptz | Transaction date |
| direction | text | in/out |
| amount | numeric(14,2) | Amount |
| method | text | Payment method |
| source_type | text | Source type |
| source_id | uuid | Source ID |
| source_ref | text | Source reference |
| description | text | Description |
| created_by | text | Creator |
| metadata | jsonb | Flexible data |
| created_at | timestamptz | Creation time |

**Data Volume:** ~3,000 rows

#### Target: `omnistore.cashboxes` + `omnistore.pos_transactions`
| Table | Purpose |
|-------|---------|
| cashboxes | Cash balance management |
| pos_transactions | POS transaction records |

#### Action: **TRANSFORM**

| Field Mapping | Rule |
|---------------|------|
| id → id | Keep UUID |
| transaction_date → occurred_at | Rename |
| direction → metadata.direction | Move to metadata |
| amount → total | Keep |
| method → payment_method | Rename |
| source_type → reference_type | Rename |
| source_id → reference_id | Rename |
| source_ref → reference | Rename |
| description → metadata.description | Move to metadata |
| created_by → metadata.created_by | Move to metadata |
| metadata → metadata | Merge |
| created_at → created_at | Keep |
| (new) tenant_id | Set to default tenant |
| (new) branch_id | Set to NULL |
| (new) warehouse_id | Set to NULL |

---

### 1.7 Stock Transactions

#### Current: `public.stock_transactions`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| transaction_date | timestamptz | Transaction date |
| product_id | uuid | FK to products |
| legacy_product_id | text | Legacy ID |
| direction | text | in/out |
| qty | numeric(14,3) | Quantity |
| source_type | text | Source type |
| source_id | uuid | Source ID |
| source_ref | text | Source reference |
| serials | jsonb | Serial numbers |
| description | text | Description |
| created_by | text | Creator |
| metadata | jsonb | Flexible data |
| created_at | timestamptz | Creation time |

**Data Volume:** ~4,000 rows

#### Target: `omnistore.inventory_transactions`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| tenant_id | uuid | **NEW** FK to tenants |
| warehouse_id | uuid | **NEW** FK to warehouses |
| product_id | uuid | FK to products |
| transaction_type | text | Was direction |
| quantity | numeric(18,4) | Was qty |
| unit_cost | numeric(18,4) | **NEW** Unit cost |
| reference_type | text | Was source_type |
| reference_id | uuid | Was source_id |
| occurred_at | timestamptz | Was transaction_date |
| created_by | uuid | Was text |

#### Action: **TRANSFORM**

| Field Mapping | Rule |
|---------------|------|
| id → id | Keep UUID |
| transaction_date → occurred_at | Rename |
| product_id → product_id | Keep |
| legacy_product_id → metadata.legacy_product_id | Move to metadata |
| direction → transaction_type | Rename |
| qty → quantity | Rename, increase precision |
| source_type → reference_type | Rename |
| source_id → reference_id | Rename |
| source_ref → metadata.source_ref | Move to metadata |
| serials → metadata.serials | Move to metadata |
| description → metadata.description | Move to metadata |
| created_by → metadata.created_by | Move to metadata |
| metadata → metadata | Merge |
| created_at → metadata.created_at | Move to metadata |
| (new) tenant_id | Set to default tenant |
| (new) warehouse_id | Set to NULL |
| (new) unit_cost | Set to 0 (derive from product) |

---

### 1.8 Daily Closing

#### Current: `public.daily_closing`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| close_date | date | Unique closing date |
| cash_total | numeric(14,2) | Cash total |
| stock_value | numeric(14,2) | Stock value |
| sales_total | numeric(14,2) | Sales total |
| purchases_total | numeric(14,2) | Purchases total |
| closed_by | text | Closer |
| notes | text | Notes |
| created_at | timestamptz | Creation time |

**Data Volume:** ~365 rows

#### Target: **ARCHIVE** (not in omnistore schema)

#### Action: **ARCHIVE**

| Reason | Target |
|--------|--------|
| Daily closing is application-level logic | Move to `metadata` in sales_invoices |
| Not a database entity | Store as JSONB in business_profiles |
| Can be recalculated from transactions | Create view if needed |

---

### 1.9 Audit Logs

#### Current: `public.audit_logs`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| action | text | Action type |
| entity_type | text | Entity type |
| entity_id | uuid | Entity ID |
| entity_ref | text | Entity reference |
| details | jsonb | Action details |
| created_by | text | Actor |
| created_at | timestamptz | Creation time |

**Data Volume:** ~10,000 rows

#### Target: `omnistore.audit_logs`
| Column | Type | Notes |
|--------|------|-------|
| id | bigint | PK (generated) |
| tenant_id | uuid | **NEW** FK to tenants |
| actor_id | uuid | Was text |
| action | text | Action type |
| entity_type | text | Entity type |
| entity_id | text | Was uuid |
| metadata | jsonb | Was details |
| created_at | timestamptz | Creation time |

#### Action: **TRANSFORM**

| Field Mapping | Rule |
|---------------|------|
| id → id | **REGENERATE** (bigint) |
| action → action | Keep |
| entity_type → entity_type | Keep |
| entity_id → entity_id | Convert to text |
| entity_ref → metadata.entity_ref | Move to metadata |
| details → metadata | Rename |
| created_by → actor_id | **LOOKUP** or set NULL |
| created_at → created_at | Keep |
| (new) tenant_id | Set to default tenant |

---

### 1.10 User Roles

#### Current: `public.user_roles`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| username | text | Unique |
| role | text | Role name |
| can_manage_finance | boolean | Finance permission |
| can_manage_stock | boolean | Stock permission |
| created_at | timestamptz | Creation time |
| updated_at | timestamptz | Last update |

**Data Volume:** ~10 rows

#### Target: `omnistore.user_profiles` + `omnistore.roles`
| Table | Purpose |
|-------|---------|
| user_profiles | User-tenant mapping |
| roles | Role definitions |

#### Action: **TRANSFORM**

| Field Mapping | Rule |
|---------------|------|
| id → user_profiles.id | Keep UUID |
| username → user_profiles.user_id | **LOOKUP** auth.users |
| role → roles.code | **LOOKUP** or create role |
| can_manage_finance → roles.metadata.can_manage_finance | Move to metadata |
| can_manage_stock → roles.metadata.can_manage_stock | Move to metadata |
| created_at → user_profiles.created_at | Keep |
| updated_at → user_profiles.updated_at | Keep |
| (new) user_profiles.tenant_id | Set to default tenant |
| (new) user_profiles.role_code | Map from roles |

---

### 1.11 Devices

#### Current: `public.devices`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| serial_number | text | Unique (partial) |
| imei | text | Unique (partial) |
| service_tag | text | Unique (partial) |
| asset_tag | text | Asset tag |
| warranty_start | date | Warranty start |
| warranty_end | date | Warranty end |
| warranty_status | text | active/expired/unknown |
| customer_id | text | Customer ID |
| customer_name | text | Customer name |
| customer_phone | text | Customer phone |
| product_id | uuid | FK to products |
| legacy_product_id | text | Legacy ID |
| product_name | text | Product name |
| sale_id | uuid | FK to sales |
| sale_ref | text | Sale reference |
| purchase_id | uuid | FK to purchases |
| purchase_ref | text | Purchase reference |
| status | text | available/sold/repair/returned/scrapped |
| notes | text | Notes |
| metadata | jsonb | Flexible data |
| created_at | timestamptz | Creation time |
| updated_at | timestamptz | Last update |

**Data Volume:** ~200 rows

#### Target: **CUSTOM TABLE** (not in omnistore schema)

#### Action: **KEEP** (extend metadata)

| Reason | Target |
|--------|--------|
| Device tracking is business-specific | Keep in `public.devices` |
| Not in omnistore schema | Add `tenant_id` column |
| Can be migrated later | Create `omnistore.devices` when needed |

---

### 1.12 Device Repairs

#### Current: `public.device_repairs`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| device_id | uuid | FK to devices |
| repair_date | timestamptz | Repair date |
| issue | text | Issue description |
| solution | text | Solution |
| cost | numeric(14,2) | Repair cost |
| technician | text | Technician |
| status | text | open/in_progress/done/cancelled |
| notes | text | Notes |
| created_by | text | Creator |
| created_at | timestamptz | Creation time |
| updated_at | timestamptz | Last update |

**Data Volume:** ~100 rows

#### Target: **KEEP** (extend metadata)

#### Action: **KEEP** (extend metadata)

| Reason | Target |
|--------|--------|
| Repair tracking is business-specific | Keep in `public.device_repairs` |
| Not in omnistore schema | Add `tenant_id` column |
| Can be migrated later | Create `omnistore.device_repairs` when needed |

---

## 2. TENANT MIGRATION DESIGN

### 2.1 Tenant ID Generation

```sql
-- Default tenant for single-tenant → multi-tenant migration
INSERT INTO omnistore.tenants (id, code, name, status, currency, timezone)
VALUES (
  '00000000-0000-0000-0000-000000000001'::uuid,
  'DEFAULT',
  'DigiTronics Default Tenant',
  'active',
  'EGP',
  'Africa/Cairo'
);
```

### 2.2 Migration Rules

| Scenario | Rule |
|----------|------|
| Existing records | Set `tenant_id = '00000000-0000-0000-0000-000000000001'` |
| Future inserts | Application sets `tenant_id` from JWT |
| User ownership | `user_profiles.tenant_id` links users to tenants |
| Data isolation | RLS policies enforce `tenant_id` filtering |

### 2.3 Before/After Example

#### Before (public.sales)
```json
{
  "id": "uuid-1",
  "invoice_no": "INV-001",
  "customer_name": "Ahmed",
  "total": 1000
}
```

#### After (omnistore.sales_invoices)
```json
{
  "id": "uuid-1",
  "tenant_id": "00000000-0000-0000-0000-000000000001",
  "customer_id": "customer-uuid-1",
  "document_number": "INV-001",
  "total": 1000,
  "currency": "EGP",
  "metadata": {
    "customer_name": "Ahmed",
    "payment_method": "cash"
  }
}
```

---

## 3. ENTITY MIGRATION ORDER

### Phase 1: Foundation (No Dependencies)

| Order | Table | Reason |
|-------|-------|--------|
| 1.1 | omnistore.tenants | Base entity, all others depend on it |
| 1.2 | omnistore.role_templates | Pre-defined roles |
| 1.3 | omnistore.permission_templates | Pre-defined permissions |
| 1.4 | omnistore.currencies | Reference data |

### Phase 2: User Management

| Order | Table | Dependencies |
|-------|-------|--------------|
| 2.1 | omnistore.roles | Phase 1 |
| 2.2 | omnistore.permissions | Phase 1 |
| 2.3 | omnistore.role_permissions | Phase 2.1, 2.2 |
| 2.4 | omnistore.user_profiles | Phase 1, 2.1 |

### Phase 3: Business Entities

| Order | Table | Dependencies |
|-------|-------|--------------|
| 3.1 | omnistore.categories | Phase 1 |
| 3.2 | omnistore.branches | Phase 1 |
| 3.3 | omnistore.warehouses | Phase 1, 3.2 |
| 3.4 | omnistore.taxes | Phase 1 |
| 3.5 | omnistore.customers | Phase 1 |
| 3.6 | omnistore.suppliers | Phase 1 |
| 3.7 | omnistore.products | Phase 1, 3.1 |

### Phase 4: Transactions

| Order | Table | Dependencies |
|-------|-------|--------------|
| 4.1 | omnistore.inventory_transactions | Phase 3.3, 3.7 |
| 4.2 | omnistore.sales_invoices | Phase 3.5, 3.2 |
| 4.3 | omnistore.sales_invoice_lines | Phase 4.2, 3.7 |
| 4.4 | omnistore.purchase_invoices | Phase 3.6, 3.2 |
| 4.5 | omnistore.purchase_invoice_lines | Phase 4.4, 3.7 |
| 4.6 | omnistore.pos_transactions | Phase 3.5, 3.3 |

### Phase 5: Accounting (Optional)

| Order | Table | Dependencies |
|-------|-------|--------------|
| 5.1 | omnistore.chart_of_accounts | Phase 1 |
| 5.2 | omnistore.journal_vouchers | Phase 5.1 |
| 5.3 | omnistore.journal_lines | Phase 5.2, 5.1 |

### Phase 6: Settings & Audit

| Order | Table | Dependencies |
|-------|-------|--------------|
| 6.1 | omnistore.business_profiles | Phase 1 |
| 6.2 | omnistore.pos_settings | Phase 1 |
| 6.3 | omnistore.accounting_settings | Phase 1 |
| 6.4 | omnistore.printing_settings | Phase 1 |
| 6.5 | omnistore.system_settings | Phase 1 |
| 6.6 | omnistore.audit_logs | Phase 1 |

### Dependency Graph

```
Phase 1: tenants ─────────────────────────────────────────┐
              │                                            │
Phase 2:     ├──► roles ──► role_permissions              │
              │                                            │
              └──► user_profiles ◄─────────────────────────┘
                              │
Phase 3:     ├──► categories ──► products
              │                    │
              ├──► branches ──► warehouses
              │                    │
              ├──► taxes           │
              │                    │
              ├──► customers       │
              │                    │
              └──► suppliers       │
                                   │
Phase 4:     inventory_transactions ◄─────────────────────┘
              │
              ├──► sales_invoices ──► sales_invoice_lines
              │
              └──► purchase_invoices ──► purchase_invoice_lines
```

---

## 4. DATA TRANSFORMATION RULES

### 4.1 Products

```sql
-- Migration SQL (for reference only, NOT executed)
INSERT INTO omnistore.products (
  id, tenant_id, sku, name, cost, price, metadata, enabled, created_at, updated_at
)
SELECT
  id,
  '00000000-0000-0000-0000-000000000001'::uuid,
  sku,
  name,
  buy_price,
  sell_price,
  jsonb_build_object(
    'legacy_id', legacy_id,
    'has_serial', has_serial,
    'min_stock', min_stock
  ) || metadata,
  true,
  created_at,
  updated_at
FROM public.products;
```

### 4.2 Sales

```sql
-- Migration SQL (for reference only, NOT executed)
INSERT INTO omnistore.sales_invoices (
  id, tenant_id, customer_id, document_number, status, total, currency, invoice_date, created_at
)
SELECT
  s.id,
  '00000000-0000-0000-0000-000000000001'::uuid,
  c.id,  -- Lookup or create customer
  s.invoice_no,
  CASE 
    WHEN s.status = 'cancelled' THEN 'cancelled'
    ELSE 'posted'
  END,
  s.total,
  'EGP',
  s.sale_date::date,
  s.created_at
FROM public.sales s
LEFT JOIN omnistore.customers c ON c.name = s.customer_name;
```

### 4.3 Sale Items

```sql
-- Migration SQL (for reference only, NOT executed)
INSERT INTO omnistore.sales_invoice_lines (
  id, tenant_id, invoice_id, product_id, quantity, unit_price, unit_cost
)
SELECT
  si.id,
  '00000000-0000-0000-0000-000000000001'::uuid,
  si.sale_id,
  si.product_id,
  si.qty,
  si.unit_price,
  si.unit_cost
FROM public.sale_items si;
```

### 4.4 Customers (Derived from Sales)

```sql
-- Migration SQL (for reference only, NOT executed)
INSERT INTO omnistore.customers (id, tenant_id, name, phone, created_at)
SELECT DISTINCT
  gen_random_uuid(),
  '00000000-0000-0000-0000-000000000001'::uuid,
  customer_name,
  customer_phone,
  MIN(created_at)
FROM public.sales
WHERE customer_name IS NOT NULL
GROUP BY customer_name, customer_phone;
```

### 4.5 Suppliers (Derived from Purchases)

```sql
-- Migration SQL (for reference only, NOT executed)
INSERT INTO omnistore.suppliers (id, tenant_id, name, phone, created_at)
SELECT DISTINCT
  gen_random_uuid(),
  '00000000-0000-0000-0000-000000000001'::uuid,
  supplier_name,
  supplier_phone,
  MIN(created_at)
FROM public.purchases
WHERE supplier_name IS NOT NULL AND supplier_name != ''
GROUP BY supplier_name, supplier_phone;
```

---

## 5. HIGH RISK AREAS

### 5.1 Sales Migration

| Risk | Impact | Mitigation |
|------|--------|------------|
| Customer lookup failure | HIGH | Create customer from invoice data |
| Invoice number collision | MEDIUM | Use tenant_id prefix |
| Status mapping errors | MEDIUM | Validate before/after |
| Item data loss | HIGH | Migrate items with invoice |

**Validation Query:**
```sql
-- Verify sales migration
SELECT 
  COUNT(*) as total_sales,
  SUM(CASE WHEN customer_id IS NOT NULL THEN 1 ELSE 0 END) as with_customer
FROM omnistore.sales_invoices;
```

### 5.2 Purchases Migration

| Risk | Impact | Mitigation |
|------|--------|------------|
| Supplier lookup failure | HIGH | Create supplier from invoice data |
| Cost calculation errors | MEDIUM | Verify unit_cost |
| Inventory impact | HIGH | Recalculate stock after migration |

**Validation Query:**
```sql
-- Verify purchases migration
SELECT 
  COUNT(*) as total_purchases,
  SUM(CASE WHEN supplier_id IS NOT NULL THEN 1 ELSE 0 END) as with_supplier
FROM omnistore.purchase_invoices;
```

### 5.3 Accounting Migration

| Risk | Impact | Mitigation |
|------|--------|------------|
| Balance mismatch | CRITICAL | Reconcile before/after |
| Journal entry errors | HIGH | Validate debits = credits |
| Period closing issues | MEDIUM | Migrate closed periods first |

---

## 6. ROLLBACK DESIGN

### 6.1 Rollback Strategy

| Step | Forward | Rollback | Validation |
|------|---------|----------|------------|
| 1. Create tenant | INSERT tenant | DELETE tenant | Row exists |
| 2. Migrate products | INSERT products | DELETE products | Count matches |
| 3. Migrate customers | INSERT customers | DELETE customers | Count matches |
| 4. Migrate suppliers | INSERT suppliers | DELETE suppliers | Count matches |
| 5. Migrate sales | INSERT sales + items | DELETE sales + items | Count matches |
| 6. Migrate purchases | INSERT purchases + items | DELETE purchases + items | Count matches |
| 7. Migrate transactions | INSERT transactions | DELETE transactions | Count matches |
| 8. Update RLS | Enable RLS | Disable RLS | Policies exist |

### 6.2 Rollback Script Template

```sql
-- Rollback: Delete migrated data
DELETE FROM omnistore.sales_invoice_lines WHERE tenant_id = '00000000-0000-0000-0000-000000000001';
DELETE FROM omnistore.sales_invoices WHERE tenant_id = '00000000-0000-0000-0000-000000000001';
DELETE FROM omnistore.purchase_invoice_lines WHERE tenant_id = '00000000-0000-0000-0000-000000000001';
DELETE FROM omnistore.purchase_invoices WHERE tenant_id = '00000000-0000-0000-0000-000000000001';
DELETE FROM omnistore.products WHERE tenant_id = '00000000-0000-0000-0000-000000000001';
DELETE FROM omnistore.customers WHERE tenant_id = '00000000-0000-0000-0000-000000000001';
DELETE FROM omnistore.suppliers WHERE tenant_id = '00000000-0000-0000-0000-000000000001';
DELETE FROM omnistore.tenants WHERE id = '00000000-0000-0000-0000-000000000001';
```

### 6.3 Rollback Scenarios

| Scenario | Trigger | Action |
|----------|---------|--------|
| Migration failure | Error during INSERT | Execute rollback script |
| Data mismatch | Validation fails | Investigate, fix, retry |
| Performance issues | Query timeout | Pause, optimize, resume |
| Application errors | User reports | Rollback, investigate |

---

## 7. VALIDATION PLAN

### 7.1 Before Migration

| Check | Query | Expected |
|-------|-------|----------|
| Row counts | `SELECT COUNT(*) FROM public.products` | ~500 |
| Row counts | `SELECT COUNT(*) FROM public.sales` | ~2,000 |
| Row counts | `SELECT COUNT(*) FROM public.sale_items` | ~5,000 |
| Row counts | `SELECT COUNT(*) FROM public.purchases` | ~1,000 |
| Row counts | `SELECT COUNT(*) FROM public.purchase_items` | ~3,000 |
| Row counts | `SELECT COUNT(*) FROM public.cash_transactions` | ~3,000 |
| Row counts | `SELECT COUNT(*) FROM public.stock_transactions` | ~4,000 |
| Row counts | `SELECT COUNT(*) FROM public.audit_logs` | ~10,000 |
| Row counts | `SELECT COUNT(*) FROM public.devices` | ~200 |
| Row counts | `SELECT COUNT(*) FROM public.device_repairs` | ~100 |
| Checksum | `SELECT MD5(ROW_TO_JSON(p)::text) FROM public.products p LIMIT 1` | Record |

### 7.2 After Migration

| Check | Query | Expected |
|-------|-------|----------|
| Row counts | `SELECT COUNT(*) FROM omnistore.products` | ~500 |
| Row counts | `SELECT COUNT(*) FROM omnistore.sales_invoices` | ~2,000 |
| Row counts | `SELECT COUNT(*) FROM omnistore.sales_invoice_lines` | ~5,000 |
| Row counts | `SELECT COUNT(*) FROM omnistore.purchase_invoices` | ~1,000 |
| Row counts | `SELECT COUNT(*) FROM omnistore.purchase_invoice_lines` | ~3,000 |
| Row counts | `SELECT COUNT(*) FROM omnistore.inventory_transactions` | ~4,000 |
| Row counts | `SELECT COUNT(*) FROM omnistore.audit_logs` | ~10,000 |
| Row counts | `SELECT COUNT(*) FROM omnistore.customers` | ~500 |
| Row counts | `SELECT COUNT(*) FROM omnistore.suppliers` | ~200 |
| Data integrity | `SELECT SUM(total) FROM omnistore.sales_invoices` | ~2M |
| Data integrity | `SELECT SUM(total) FROM omnistore.purchase_invoices` | ~1M |

### 7.3 Business Calculations

| Check | Formula | Expected |
|-------|---------|----------|
| Sales total | SUM(total) | Match public.sales |
| Purchases total | SUM(total) | Match public.purchases |
| Stock value | SUM(qty * cost) | Match public.stock_transactions |
| Customer count | COUNT(DISTINCT customer_name) | Match public.sales |

---

## 8. GATE B DECISION

**Status:** PENDING REVIEW

**Recommendation:** APPROVED

**Rationale:**
- All tables mapped
- Tenant strategy defined
- Migration order established
- Data transformation rules documented
- High risk areas identified
- Rollback strategy defined
- Validation plan complete

**Next Step:** Gate C — Backup & Dry Run
