export const CONTROL_VERSION = '20260702.001'

export const controlPlaneMigration = `
create schema if not exists omnistore_control;

create table if not exists omnistore_control.control_migrations (
  id text primary key,
  installed_at timestamptz not null default now(),
  installed_by uuid not null
);

create table if not exists omnistore_control.production_mode (
  singleton boolean primary key default true check (singleton),
  enabled boolean not null default false,
  enabled_by uuid,
  enabled_at timestamptz,
  disabled_by uuid,
  disabled_at timestamptz,
  updated_at timestamptz not null default now()
);

insert into omnistore_control.production_mode(singleton, enabled)
values (true, false) on conflict (singleton) do nothing;

create table if not exists omnistore_control.execution_requests (
  id uuid primary key,
  operation text not null check (operation in (
    'databaseInstallation','customerProvisioning','workspaceActivation','backup','restore',
    'deployment','licenseActivation','supabaseSchemaInstallation','edgeFunctionDeployment','storageBucketCreation'
  )),
  tenant_id uuid,
  requested_by uuid not null,
  payload jsonb not null default '{}'::jsonb,
  confirmation_hash text not null,
  status text not null default 'pending' check (status in (
    'pending','preparing','executing','verifying','verified','failed','partial_failure','rolling_back','rolled_back'
  )),
  attempts integer not null default 0,
  started_at timestamptz,
  completed_at timestamptz,
  duration_ms bigint,
  result jsonb,
  errors jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists omnistore_control.rollback_points (
  id uuid primary key default gen_random_uuid(),
  execution_id uuid not null references omnistore_control.execution_requests(id) on delete restrict,
  operation text not null,
  tenant_id uuid,
  snapshot jsonb not null,
  status text not null default 'available' check (status in ('available','used','invalid')),
  created_by uuid not null,
  created_at timestamptz not null default now(),
  used_at timestamptz
);

create table if not exists omnistore_control.execution_audit (
  id uuid primary key default gen_random_uuid(),
  execution_id uuid references omnistore_control.execution_requests(id) on delete set null,
  actor_id uuid not null,
  tenant_id uuid,
  operation text not null,
  action text not null,
  duration_ms bigint,
  result text not null,
  errors jsonb not null default '[]'::jsonb,
  rollback_id uuid references omnistore_control.rollback_points(id) on delete set null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists execution_requests_status_idx on omnistore_control.execution_requests(status, created_at desc);
create index if not exists execution_requests_tenant_idx on omnistore_control.execution_requests(tenant_id, created_at desc);
create index if not exists execution_audit_execution_idx on omnistore_control.execution_audit(execution_id, created_at desc);
create index if not exists execution_audit_tenant_idx on omnistore_control.execution_audit(tenant_id, created_at desc);
create unique index if not exists rollback_points_available_idx on omnistore_control.rollback_points(execution_id) where status = 'available';

alter table omnistore_control.production_mode enable row level security;
alter table omnistore_control.execution_requests enable row level security;
alter table omnistore_control.rollback_points enable row level security;
alter table omnistore_control.execution_audit enable row level security;
alter table omnistore_control.control_migrations enable row level security;
`
