export const SAAS_ADMIN_VERSION = '20260701.001'

export const saasAdminMigration = `
  create schema if not exists omnistore_admin;

  create table if not exists omnistore_admin.admin_migrations (
    id text primary key,
    installed_at timestamptz not null default now(),
    installed_by uuid not null
  );

  create table if not exists omnistore_admin.plan_catalog (
    code text primary key check (code in ('trial','monthly','quarterly','yearly','lifetime','custom')),
    name text not null,
    billing_months integer,
    price numeric(18,4) not null default 0,
    currency text not null default 'USD',
    limits jsonb not null,
    active boolean not null default true,
    updated_at timestamptz not null default now()
  );

  create table if not exists omnistore_admin.customer_subscriptions (
    tenant_id uuid primary key references omnistore.tenants(id) on delete cascade,
    plan_code text not null references omnistore_admin.plan_catalog(code),
    status text not null check (status in ('trial','active','suspended','expired','revoked')),
    starts_at timestamptz not null default now(),
    ends_at timestamptz,
    auto_renew boolean not null default false,
    custom_limits jsonb not null default '{}'::jsonb,
    updated_at timestamptz not null default now()
  );

  create table if not exists omnistore_admin.licenses (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null references omnistore.tenants(id) on delete cascade,
    license_hash text not null unique,
    key_prefix text not null,
    plan_code text not null references omnistore_admin.plan_catalog(code),
    status text not null check (status in ('active','expired','revoked')),
    starts_at timestamptz not null default now(),
    expires_at timestamptz,
    renewed_at timestamptz,
    revoked_at timestamptz,
    last_validated_at timestamptz,
    metadata jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now()
  );

  create table if not exists omnistore_admin.billing_invoices (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null references omnistore.tenants(id) on delete cascade,
    invoice_number text not null unique,
    plan_code text not null,
    period_start date not null,
    period_end date not null,
    amount numeric(18,4) not null default 0,
    currency text not null default 'USD',
    status text not null default 'preview',
    preview_only boolean not null default true,
    created_at timestamptz not null default now()
  );

  create table if not exists omnistore_admin.billing_payments (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null references omnistore.tenants(id) on delete cascade,
    invoice_id uuid references omnistore_admin.billing_invoices(id) on delete set null,
    amount numeric(18,4) not null default 0,
    currency text not null default 'USD',
    status text not null default 'preview',
    gateway text not null default 'none',
    preview_only boolean not null default true,
    created_at timestamptz not null default now()
  );

  create table if not exists omnistore_admin.subscription_history (
    id bigint generated always as identity primary key,
    tenant_id uuid not null,
    action text not null,
    old_plan text,
    new_plan text,
    old_status text,
    new_status text,
    details jsonb not null default '{}'::jsonb,
    actor_id uuid not null,
    created_at timestamptz not null default now()
  );

  create table if not exists omnistore_admin.customer_metrics (
    tenant_id uuid primary key references omnistore.tenants(id) on delete cascade,
    last_login_at timestamptz,
    storage_bytes bigint not null default 0,
    users_count integer not null default 0,
    branches_count integer not null default 0,
    warehouses_count integer not null default 0,
    pos_devices_count integer not null default 0,
    products_count integer not null default 0,
    customers_count integer not null default 0,
    suppliers_count integer not null default 0,
    invoices_count integer not null default 0,
    measured_at timestamptz not null default now()
  );

  create table if not exists omnistore_admin.notification_rules (
    code text primary key,
    enabled boolean not null default true,
    threshold jsonb not null default '{}'::jsonb,
    channels text[] not null default array['dashboard'],
    updated_at timestamptz not null default now()
  );

  create table if not exists omnistore_admin.notification_queue (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid,
    rule_code text not null references omnistore_admin.notification_rules(code),
    severity text not null default 'warning',
    payload jsonb not null default '{}'::jsonb,
    status text not null default 'preview',
    preview_only boolean not null default true,
    created_at timestamptz not null default now()
  );

  create table if not exists omnistore_admin.license_audit (
    id bigint generated always as identity primary key,
    tenant_id uuid,
    license_id uuid,
    action text not null,
    actor_id uuid not null,
    details jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now()
  );

  create index if not exists idx_licenses_tenant_status on omnistore_admin.licenses(tenant_id, status, expires_at);
  create index if not exists idx_subscriptions_status on omnistore_admin.customer_subscriptions(status, ends_at);
  create index if not exists idx_billing_invoices_tenant on omnistore_admin.billing_invoices(tenant_id, created_at desc);
  create index if not exists idx_subscription_history_tenant on omnistore_admin.subscription_history(tenant_id, created_at desc);
  create index if not exists idx_license_audit_tenant on omnistore_admin.license_audit(tenant_id, created_at desc);

  alter table omnistore_admin.plan_catalog enable row level security;
  alter table omnistore_admin.customer_subscriptions enable row level security;
  alter table omnistore_admin.licenses enable row level security;
  alter table omnistore_admin.billing_invoices enable row level security;
  alter table omnistore_admin.billing_payments enable row level security;
  alter table omnistore_admin.subscription_history enable row level security;
  alter table omnistore_admin.customer_metrics enable row level security;
  alter table omnistore_admin.notification_rules enable row level security;
  alter table omnistore_admin.notification_queue enable row level security;
  alter table omnistore_admin.license_audit enable row level security;

  insert into omnistore_admin.plan_catalog(code, name, billing_months, price, currency, limits) values
    ('trial','Trial',0,0,'USD','{"users":3,"branches":1,"warehouses":1,"posDevices":1,"products":500,"customers":200,"suppliers":100,"invoices":1000,"storageBytes":104857600}'::jsonb),
    ('monthly','Monthly',1,29,'USD','{"users":10,"branches":3,"warehouses":5,"posDevices":5,"products":10000,"customers":5000,"suppliers":2000,"invoices":50000,"storageBytes":1073741824}'::jsonb),
    ('quarterly','Quarterly',3,79,'USD','{"users":20,"branches":5,"warehouses":10,"posDevices":10,"products":25000,"customers":10000,"suppliers":5000,"invoices":150000,"storageBytes":5368709120}'::jsonb),
    ('yearly','Yearly',12,299,'USD','{"users":50,"branches":20,"warehouses":50,"posDevices":50,"products":100000,"customers":50000,"suppliers":20000,"invoices":1000000,"storageBytes":21474836480}'::jsonb),
    ('lifetime','Lifetime',null,999,'USD','{"users":100,"branches":50,"warehouses":100,"posDevices":100,"products":500000,"customers":250000,"suppliers":100000,"invoices":5000000,"storageBytes":53687091200}'::jsonb),
    ('custom','Custom',null,0,'USD','{"users":1,"branches":1,"warehouses":1,"posDevices":1,"products":100,"customers":100,"suppliers":100,"invoices":100,"storageBytes":104857600}'::jsonb)
  on conflict (code) do update set name = excluded.name, billing_months = excluded.billing_months,
    price = excluded.price, currency = excluded.currency, limits = excluded.limits, updated_at = now();

  insert into omnistore_admin.notification_rules(code, threshold) values
    ('license_expiration','{"days":14}'::jsonb),
    ('storage_limits','{"percent":80}'::jsonb),
    ('plan_limits','{"percent":90}'::jsonb),
    ('inactive_customer','{"days":30}'::jsonb),
    ('failed_provision','{"status":"failed"}'::jsonb)
  on conflict (code) do update set threshold = excluded.threshold, updated_at = now();
`
