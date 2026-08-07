-- PHASE 24 DRAFT ONLY. Authentication mapping; no users are created.
create table if not exists public.auth_profiles (
  id uuid primary key,
  tenant_id uuid not null references public.tenants(id),
  auth_user_id uuid not null,
  display_name text,
  role text not null check (role in ('owner','admin','manager','accountant','cashier')),
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  unique (tenant_id, auth_user_id)
);
