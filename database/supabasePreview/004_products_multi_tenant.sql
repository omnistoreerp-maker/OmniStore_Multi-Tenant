-- PHASE 24 DRAFT ONLY.
create table if not exists public.products_multi_tenant (
  id uuid primary key,
  tenant_id uuid not null references public.tenants(id),
  sku text not null,
  name text not null,
  cost numeric(18,4) not null default 0,
  price numeric(18,4) not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (tenant_id, sku),
  unique (tenant_id, id)
);

create table if not exists public.customers_multi_tenant (
  id uuid primary key,
  tenant_id uuid not null references public.tenants(id),
  name text not null,
  contact jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (tenant_id, id)
);

create table if not exists public.suppliers_multi_tenant (
  id uuid primary key,
  tenant_id uuid not null references public.tenants(id),
  name text not null,
  contact jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (tenant_id, id)
);
