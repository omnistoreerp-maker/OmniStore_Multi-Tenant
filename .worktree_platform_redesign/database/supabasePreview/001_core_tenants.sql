-- PHASE 24 DRAFT ONLY. DO NOT EXECUTE FROM THE BROWSER.
create table if not exists public.tenants (
  id uuid primary key,
  code text not null unique,
  name text not null,
  status text not null default 'preview',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.tenant_branding (
  id uuid primary key,
  tenant_id uuid not null references public.tenants(id),
  company_name text,
  logo_path text,
  theme jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.tenant_settings (
  id uuid primary key,
  tenant_id uuid not null references public.tenants(id),
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
