-- PHASE 24 DRAFT ONLY.
create table if not exists public.warehouses_multi_tenant (
  id uuid primary key,
  tenant_id uuid not null references public.tenants(id),
  code text not null,
  name text not null,
  unique (tenant_id, code),
  unique (tenant_id, id)
);

create table if not exists public.inventory_transactions_multi_tenant (
  id uuid primary key,
  tenant_id uuid not null references public.tenants(id),
  warehouse_id uuid not null,
  product_id uuid not null,
  transaction_type text not null,
  quantity numeric(18,4) not null,
  unit_cost numeric(18,4) not null default 0,
  reference text,
  occurred_at timestamptz not null,
  foreign key (tenant_id, warehouse_id) references public.warehouses_multi_tenant(tenant_id, id),
  foreign key (tenant_id, product_id) references public.products_multi_tenant(tenant_id, id)
);
