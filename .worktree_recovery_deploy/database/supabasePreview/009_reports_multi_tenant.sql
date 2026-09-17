-- PHASE 24 DRAFT ONLY.
create table if not exists public.report_definitions_multi_tenant (
  id uuid primary key,
  tenant_id uuid not null references public.tenants(id),
  report_key text not null,
  configuration jsonb not null default '{}'::jsonb,
  unique (tenant_id, report_key)
);

create table if not exists public.report_snapshots_multi_tenant (
  id uuid primary key,
  tenant_id uuid not null references public.tenants(id),
  report_key text not null,
  parameters jsonb not null default '{}'::jsonb,
  result_preview jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
