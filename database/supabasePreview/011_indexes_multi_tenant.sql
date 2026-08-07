-- PHASE 24 DRAFT ONLY.
create index if not exists idx_auth_profiles_tenant on public.auth_profiles(tenant_id);
create index if not exists idx_products_tenant_sku on public.products_multi_tenant(tenant_id, sku);
create index if not exists idx_customers_tenant on public.customers_multi_tenant(tenant_id);
create index if not exists idx_suppliers_tenant on public.suppliers_multi_tenant(tenant_id);
create index if not exists idx_sales_tenant_date on public.sales_invoices_multi_tenant(tenant_id, created_at);
create index if not exists idx_purchases_tenant_date on public.purchase_invoices_multi_tenant(tenant_id, created_at);
create index if not exists idx_inventory_tenant_product on public.inventory_transactions_multi_tenant(tenant_id, product_id);
create index if not exists idx_vouchers_tenant_date on public.journal_vouchers_multi_tenant(tenant_id, posting_date);
