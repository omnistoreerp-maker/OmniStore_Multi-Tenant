-- PHASE 24 DRAFT ONLY.
create table if not exists public.purchase_invoices_multi_tenant (
  id uuid primary key,
  tenant_id uuid not null references public.tenants(id),
  supplier_id uuid,
  document_number text not null,
  status text not null default 'draft',
  total numeric(18,4) not null default 0,
  currency text not null default 'EGP',
  created_at timestamptz not null default now(),
  unique (tenant_id, document_number),
  foreign key (tenant_id, supplier_id) references public.suppliers_multi_tenant(tenant_id, id)
);

create table if not exists public.purchase_invoice_lines_multi_tenant (
  id uuid primary key,
  tenant_id uuid not null references public.tenants(id),
  invoice_id uuid not null,
  product_id uuid,
  quantity numeric(18,4) not null,
  unit_cost numeric(18,4) not null,
  foreign key (tenant_id, product_id) references public.products_multi_tenant(tenant_id, id)
);
