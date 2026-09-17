-- PHASE 24 DRAFT ONLY.
create table if not exists public.customer_workspaces (
  id uuid primary key,
  tenant_id uuid not null references public.tenants(id),
  name text not null,
  slug text not null,
  configuration jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (tenant_id, slug)
);
