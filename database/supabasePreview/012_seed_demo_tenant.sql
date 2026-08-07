-- PHASE 24 DRAFT ONLY. Optional future sandbox seed; never run against production.
insert into public.tenants (id, code, name, status)
values ('00000000-0000-0000-0000-000000000024', 'demo-preview', 'OmniStore Preview Tenant', 'preview');

insert into public.customer_workspaces (id, tenant_id, name, slug)
values (
  '00000000-0000-0000-0000-000000000124',
  '00000000-0000-0000-0000-000000000024',
  'Preview Workspace',
  'preview-workspace'
);
