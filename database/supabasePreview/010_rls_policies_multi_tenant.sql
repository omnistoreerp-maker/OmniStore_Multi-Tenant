-- PHASE 24 DRAFT ONLY. Review auth claim strategy before any future execution.
-- Every tenant-owned table must enable RLS and compare tenant_id with the authenticated tenant claim.
alter table public.auth_profiles enable row level security;
create policy auth_profiles_tenant_select on public.auth_profiles
  for select using (tenant_id::text = auth.jwt() ->> 'tenant_id');
create policy auth_profiles_tenant_insert on public.auth_profiles
  for insert with check (tenant_id::text = auth.jwt() ->> 'tenant_id');
create policy auth_profiles_tenant_update on public.auth_profiles
  for update using (tenant_id::text = auth.jwt() ->> 'tenant_id')
  with check (tenant_id::text = auth.jwt() ->> 'tenant_id');
create policy auth_profiles_tenant_delete on public.auth_profiles
  for delete using (tenant_id::text = auth.jwt() ->> 'tenant_id');

-- Apply the same tenant_id predicate to customer_workspaces, tenant_branding,
-- tenant_settings, products, customers, suppliers, sales, purchases, inventory,
-- accounting, and reports tables after schema review.
