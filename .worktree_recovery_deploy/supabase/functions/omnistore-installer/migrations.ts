export const MIGRATION_VERSION = '20260701.002'

export type Migration = {
  id: string
  description: string
  sql: string
}

export const migrations: Migration[] = [
  {
    id: '20260701_001_core',
    description: 'Core tenancy, installer metadata, profiles, roles and permissions',
    sql: `
      create schema if not exists omnistore;

      create table if not exists omnistore.schema_migrations (
        id text primary key,
        description text not null,
        checksum text not null,
        installed_at timestamptz not null default now(),
        installed_by uuid not null
      );

      create table if not exists omnistore.installer_admins (
        user_id uuid primary key references auth.users(id) on delete cascade,
        email text,
        installed_version text not null,
        installed_at timestamptz not null default now()
      );

      create table if not exists omnistore.tenants (
        id uuid primary key default gen_random_uuid(),
        code text not null unique,
        name text not null,
        status text not null default 'active',
        country text,
        currency text not null default 'EGP',
        timezone text not null default 'Africa/Cairo',
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      );

      create table if not exists omnistore.business_profiles (
        id uuid primary key default gen_random_uuid(),
        tenant_id uuid not null references omnistore.tenants(id) on delete cascade,
        company_name text not null,
        phone text,
        address text,
        tax_number text,
        logo_path text,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        unique (tenant_id)
      );

      create table if not exists omnistore.user_profiles (
        id uuid primary key default gen_random_uuid(),
        tenant_id uuid not null references omnistore.tenants(id) on delete cascade,
        user_id uuid not null references auth.users(id) on delete cascade,
        display_name text,
        role_code text not null,
        enabled boolean not null default true,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        unique (tenant_id, user_id)
      );

      create table if not exists omnistore.role_templates (
        code text primary key,
        name text not null,
        system_role boolean not null default true
      );

      create table if not exists omnistore.permission_templates (
        code text primary key,
        module text not null,
        description text
      );

      create table if not exists omnistore.roles (
        id uuid primary key default gen_random_uuid(),
        tenant_id uuid not null references omnistore.tenants(id) on delete cascade,
        code text not null,
        name text not null,
        system_role boolean not null default false,
        unique (tenant_id, code)
      );

      create table if not exists omnistore.permissions (
        id uuid primary key default gen_random_uuid(),
        tenant_id uuid not null references omnistore.tenants(id) on delete cascade,
        code text not null,
        module text not null,
        description text,
        unique (tenant_id, code)
      );

      create table if not exists omnistore.role_permissions (
        tenant_id uuid not null references omnistore.tenants(id) on delete cascade,
        role_id uuid not null references omnistore.roles(id) on delete cascade,
        permission_id uuid not null references omnistore.permissions(id) on delete cascade,
        primary key (tenant_id, role_id, permission_id)
      );

      create table if not exists omnistore.default_settings (
        key text primary key,
        value jsonb not null,
        updated_at timestamptz not null default now()
      );
    `
  },
  {
    id: '20260701_002_erp',
    description: 'ERP tenant tables',
    sql: `
      create table if not exists omnistore.currencies (
        code text primary key,
        name text not null,
        symbol text not null,
        decimals smallint not null default 2,
        enabled boolean not null default true
      );

      create table if not exists omnistore.taxes (
        id uuid primary key default gen_random_uuid(),
        tenant_id uuid not null references omnistore.tenants(id) on delete cascade,
        code text not null,
        name text not null,
        rate numeric(9,4) not null default 0,
        enabled boolean not null default true,
        unique (tenant_id, code)
      );

      create table if not exists omnistore.branches (
        id uuid primary key default gen_random_uuid(),
        tenant_id uuid not null references omnistore.tenants(id) on delete cascade,
        code text not null,
        name text not null,
        address text,
        enabled boolean not null default true,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        unique (tenant_id, code)
      );

      create table if not exists omnistore.customers (
        id uuid primary key default gen_random_uuid(),
        tenant_id uuid not null references omnistore.tenants(id) on delete cascade,
        name text not null,
        phone text,
        email text,
        tax_number text,
        balance numeric(18,4) not null default 0,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      );

      create table if not exists omnistore.suppliers (
        id uuid primary key default gen_random_uuid(),
        tenant_id uuid not null references omnistore.tenants(id) on delete cascade,
        name text not null,
        phone text,
        email text,
        tax_number text,
        balance numeric(18,4) not null default 0,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      );

      create table if not exists omnistore.categories (
        id uuid primary key default gen_random_uuid(),
        tenant_id uuid not null references omnistore.tenants(id) on delete cascade,
        name text not null,
        parent_id uuid references omnistore.categories(id),
        created_at timestamptz not null default now(),
        unique (tenant_id, name)
      );

      create table if not exists omnistore.products (
        id uuid primary key default gen_random_uuid(),
        tenant_id uuid not null references omnistore.tenants(id) on delete cascade,
        category_id uuid references omnistore.categories(id),
        sku text not null,
        barcode text,
        name text not null,
        cost numeric(18,4) not null default 0,
        price numeric(18,4) not null default 0,
        tax_code text,
        metadata jsonb not null default '{}'::jsonb,
        enabled boolean not null default true,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        unique (tenant_id, sku)
      );

      create table if not exists omnistore.warehouses (
        id uuid primary key default gen_random_uuid(),
        tenant_id uuid not null references omnistore.tenants(id) on delete cascade,
        branch_id uuid references omnistore.branches(id),
        code text not null,
        name text not null,
        enabled boolean not null default true,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        unique (tenant_id, code)
      );

      create table if not exists omnistore.inventory_transactions (
        id uuid primary key default gen_random_uuid(),
        tenant_id uuid not null references omnistore.tenants(id) on delete cascade,
        warehouse_id uuid not null references omnistore.warehouses(id),
        product_id uuid not null references omnistore.products(id),
        transaction_type text not null,
        quantity numeric(18,4) not null,
        unit_cost numeric(18,4) not null default 0,
        reference_type text,
        reference_id uuid,
        occurred_at timestamptz not null default now(),
        created_by uuid references auth.users(id)
      );

      create table if not exists omnistore.sales_invoices (
        id uuid primary key default gen_random_uuid(),
        tenant_id uuid not null references omnistore.tenants(id) on delete cascade,
        customer_id uuid references omnistore.customers(id),
        branch_id uuid references omnistore.branches(id),
        document_number text not null,
        status text not null default 'draft',
        total numeric(18,4) not null default 0,
        currency text not null default 'EGP',
        invoice_date date not null default current_date,
        created_at timestamptz not null default now(),
        unique (tenant_id, document_number)
      );

      create table if not exists omnistore.sales_invoice_lines (
        id uuid primary key default gen_random_uuid(),
        tenant_id uuid not null references omnistore.tenants(id) on delete cascade,
        invoice_id uuid not null references omnistore.sales_invoices(id) on delete cascade,
        product_id uuid references omnistore.products(id),
        quantity numeric(18,4) not null,
        unit_price numeric(18,4) not null,
        unit_cost numeric(18,4) not null default 0
      );

      create table if not exists omnistore.purchase_invoices (
        id uuid primary key default gen_random_uuid(),
        tenant_id uuid not null references omnistore.tenants(id) on delete cascade,
        supplier_id uuid references omnistore.suppliers(id),
        branch_id uuid references omnistore.branches(id),
        document_number text not null,
        status text not null default 'draft',
        total numeric(18,4) not null default 0,
        currency text not null default 'EGP',
        invoice_date date not null default current_date,
        created_at timestamptz not null default now(),
        unique (tenant_id, document_number)
      );

      create table if not exists omnistore.purchase_invoice_lines (
        id uuid primary key default gen_random_uuid(),
        tenant_id uuid not null references omnistore.tenants(id) on delete cascade,
        invoice_id uuid not null references omnistore.purchase_invoices(id) on delete cascade,
        product_id uuid references omnistore.products(id),
        quantity numeric(18,4) not null,
        unit_cost numeric(18,4) not null
      );

      create table if not exists omnistore.pos_transactions (
        id uuid primary key default gen_random_uuid(),
        tenant_id uuid not null references omnistore.tenants(id) on delete cascade,
        branch_id uuid references omnistore.branches(id),
        warehouse_id uuid references omnistore.warehouses(id),
        customer_id uuid references omnistore.customers(id),
        reference text not null,
        total numeric(18,4) not null default 0,
        payment_method text not null default 'cash',
        occurred_at timestamptz not null default now(),
        unique (tenant_id, reference)
      );

      create table if not exists omnistore.pos_settings (
        tenant_id uuid primary key references omnistore.tenants(id) on delete cascade,
        settings jsonb not null default '{}'::jsonb,
        updated_at timestamptz not null default now()
      );

      create table if not exists omnistore.chart_of_accounts (
        id uuid primary key default gen_random_uuid(),
        tenant_id uuid not null references omnistore.tenants(id) on delete cascade,
        account_code text not null,
        account_name text not null,
        account_type text not null,
        parent_id uuid references omnistore.chart_of_accounts(id),
        active boolean not null default true,
        unique (tenant_id, account_code)
      );

      create table if not exists omnistore.journal_vouchers (
        id uuid primary key default gen_random_uuid(),
        tenant_id uuid not null references omnistore.tenants(id) on delete cascade,
        voucher_number text not null,
        posting_date date not null,
        status text not null default 'draft',
        reference text,
        description text,
        created_at timestamptz not null default now(),
        unique (tenant_id, voucher_number)
      );

      create table if not exists omnistore.journal_lines (
        id uuid primary key default gen_random_uuid(),
        tenant_id uuid not null references omnistore.tenants(id) on delete cascade,
        voucher_id uuid not null references omnistore.journal_vouchers(id) on delete cascade,
        account_id uuid not null references omnistore.chart_of_accounts(id),
        debit numeric(18,4) not null default 0,
        credit numeric(18,4) not null default 0,
        currency text not null default 'EGP',
        exchange_rate numeric(18,8) not null default 1
      );

      create table if not exists omnistore.accounting_settings (
        tenant_id uuid primary key references omnistore.tenants(id) on delete cascade,
        settings jsonb not null default '{}'::jsonb,
        updated_at timestamptz not null default now()
      );

      create table if not exists omnistore.printing_settings (
        tenant_id uuid primary key references omnistore.tenants(id) on delete cascade,
        settings jsonb not null default '{}'::jsonb,
        updated_at timestamptz not null default now()
      );

      create table if not exists omnistore.system_settings (
        tenant_id uuid primary key references omnistore.tenants(id) on delete cascade,
        settings jsonb not null default '{}'::jsonb,
        updated_at timestamptz not null default now()
      );

      create table if not exists omnistore.audit_logs (
        id bigint generated always as identity primary key,
        tenant_id uuid references omnistore.tenants(id) on delete cascade,
        actor_id uuid references auth.users(id),
        action text not null,
        entity_type text,
        entity_id text,
        metadata jsonb not null default '{}'::jsonb,
        created_at timestamptz not null default now()
      );
    `
  },
  {
    id: '20260701_003_security',
    description: 'Indexes, tenant functions, triggers and RLS',
    sql: `
      create index if not exists idx_user_profiles_tenant on omnistore.user_profiles(tenant_id, user_id);
      create index if not exists idx_products_tenant_sku on omnistore.products(tenant_id, sku);
      create index if not exists idx_inventory_tenant_product on omnistore.inventory_transactions(tenant_id, product_id, occurred_at);
      create index if not exists idx_sales_tenant_date on omnistore.sales_invoices(tenant_id, invoice_date);
      create index if not exists idx_purchases_tenant_date on omnistore.purchase_invoices(tenant_id, invoice_date);
      create index if not exists idx_journal_tenant_date on omnistore.journal_vouchers(tenant_id, posting_date);
      create index if not exists idx_audit_tenant_created on omnistore.audit_logs(tenant_id, created_at desc);

      create or replace function omnistore.current_tenant_id()
      returns uuid
      language sql
      stable
      security invoker
      set search_path = ''
      as $$
        select nullif(auth.jwt() -> 'app_metadata' ->> 'tenant_id', '')::uuid
      $$;

      create or replace function omnistore.is_tenant_admin()
      returns boolean
      language sql
      stable
      security invoker
      set search_path = ''
      as $$
        select coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') in ('owner', 'admin')
      $$;

      create or replace function omnistore.set_updated_at()
      returns trigger
      language plpgsql
      security invoker
      set search_path = ''
      as $$
      begin
        new.updated_at = now();
        return new;
      end;
      $$;

      drop trigger if exists trg_business_profiles_updated on omnistore.business_profiles;
      create trigger trg_business_profiles_updated before update on omnistore.business_profiles
      for each row execute function omnistore.set_updated_at();
      drop trigger if exists trg_products_updated on omnistore.products;
      create trigger trg_products_updated before update on omnistore.products
      for each row execute function omnistore.set_updated_at();
      drop trigger if exists trg_system_settings_updated on omnistore.system_settings;
      create trigger trg_system_settings_updated before update on omnistore.system_settings
      for each row execute function omnistore.set_updated_at();

      do $$
      declare
        table_name text;
        tenant_tables text[] := array[
          'business_profiles','user_profiles','roles','permissions','role_permissions','taxes','branches',
          'customers','suppliers','categories','products','warehouses','inventory_transactions',
          'sales_invoices','sales_invoice_lines','purchase_invoices','purchase_invoice_lines','pos_transactions','pos_settings',
          'chart_of_accounts','journal_vouchers','journal_lines','accounting_settings','printing_settings',
          'system_settings','audit_logs'
        ];
      begin
        foreach table_name in array tenant_tables loop
          execute format('alter table omnistore.%I enable row level security', table_name);
          if not exists (select 1 from pg_policies where schemaname = 'omnistore' and tablename = table_name and policyname = 'tenant_select') then
            execute format('create policy tenant_select on omnistore.%I for select using (tenant_id = omnistore.current_tenant_id())', table_name);
          end if;
          if not exists (select 1 from pg_policies where schemaname = 'omnistore' and tablename = table_name and policyname = 'tenant_insert') then
            execute format('create policy tenant_insert on omnistore.%I for insert with check (tenant_id = omnistore.current_tenant_id())', table_name);
          end if;
          if not exists (select 1 from pg_policies where schemaname = 'omnistore' and tablename = table_name and policyname = 'tenant_update') then
            execute format('create policy tenant_update on omnistore.%I for update using (tenant_id = omnistore.current_tenant_id()) with check (tenant_id = omnistore.current_tenant_id())', table_name);
          end if;
          if not exists (select 1 from pg_policies where schemaname = 'omnistore' and tablename = table_name and policyname = 'tenant_delete') then
            execute format('create policy tenant_delete on omnistore.%I for delete using (tenant_id = omnistore.current_tenant_id() and omnistore.is_tenant_admin())', table_name);
          end if;
        end loop;
      end
      $$;
    `
  },
  {
    id: '20260701_004_defaults',
    description: 'Default roles, permissions, currencies and settings',
    sql: `
      insert into omnistore.role_templates(code, name, system_role) values
        ('owner','Owner',true),('admin','Admin',true),('manager','Manager',true),
        ('accountant','Accountant',true),('cashier','Cashier',true)
      on conflict (code) do update set name = excluded.name;

      insert into omnistore.permission_templates(code, module, description) values
        ('products.read','products','Read products'),('products.write','products','Write products'),
        ('sales.create','sales','Create sales'),('purchases.create','purchases','Create purchases'),
        ('inventory.adjust','inventory','Adjust inventory'),('reports.view','reports','View reports'),
        ('accounting.preview','accounting','Preview accounting'),('deployment.manage','deployment','Manage deployment')
      on conflict (code) do update set module = excluded.module, description = excluded.description;

      insert into omnistore.currencies(code, name, symbol, decimals) values
        ('EGP','Egyptian Pound','ج.م',2),('USD','US Dollar','$',2),('EUR','Euro','€',2),
        ('SAR','Saudi Riyal','ر.س',2),('AED','UAE Dirham','د.إ',2)
      on conflict (code) do update set name = excluded.name, symbol = excluded.symbol;

      insert into omnistore.default_settings(key, value) values
        ('pos','{"receipt_size":"80mm","allow_negative_stock":false}'::jsonb),
        ('inventory','{"cost_method":"average","default_warehouse":"main"}'::jsonb),
        ('accounting','{"posting_enabled":false,"inventory_method":"average"}'::jsonb),
        ('printing','{"invoice_template":"standard","show_logo":true}'::jsonb),
        ('system','{"language":"ar","timezone":"Africa/Cairo"}'::jsonb)
      on conflict (key) do update set value = excluded.value, updated_at = now();
    `
  },
  {
    id: '20260701_005_workspaces',
    description: 'Customer workspaces, subscriptions, API credentials, usage and provisioning audit',
    sql: `
      create table if not exists omnistore.workspaces (
        id uuid primary key default gen_random_uuid(),
        tenant_id uuid not null unique references omnistore.tenants(id) on delete cascade,
        slug text not null unique,
        status text not null default 'provisioning',
        data_schema text not null default 'omnistore',
        isolation_key text not null default 'tenant_id',
        login_url text,
        database_version text not null,
        migration_version text not null,
        activated_at timestamptz,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      );

      create table if not exists omnistore.subscriptions (
        tenant_id uuid primary key references omnistore.tenants(id) on delete cascade,
        plan text not null check (plan in ('free','basic','pro','enterprise')),
        status text not null default 'active',
        starts_at timestamptz not null default now(),
        ends_at timestamptz,
        limits jsonb not null default '{}'::jsonb,
        updated_at timestamptz not null default now()
      );

      create table if not exists omnistore.tenant_api_credentials (
        id uuid primary key default gen_random_uuid(),
        tenant_id uuid not null references omnistore.tenants(id) on delete cascade,
        key_prefix text not null,
        secret_hash text not null,
        scopes text[] not null default array['workspace:read'],
        active boolean not null default true,
        created_at timestamptz not null default now(),
        revoked_at timestamptz
      );

      create table if not exists omnistore.cashboxes (
        id uuid primary key default gen_random_uuid(),
        tenant_id uuid not null references omnistore.tenants(id) on delete cascade,
        branch_id uuid references omnistore.branches(id),
        code text not null,
        name text not null,
        currency text not null default 'EGP',
        balance numeric(18,4) not null default 0,
        enabled boolean not null default true,
        unique (tenant_id, code)
      );

      create table if not exists omnistore.report_settings (
        tenant_id uuid primary key references omnistore.tenants(id) on delete cascade,
        settings jsonb not null default '{}'::jsonb,
        updated_at timestamptz not null default now()
      );

      create table if not exists omnistore.tenant_storage_usage (
        tenant_id uuid primary key references omnistore.tenants(id) on delete cascade,
        bytes_used bigint not null default 0,
        object_count bigint not null default 0,
        measured_at timestamptz not null default now()
      );

      create table if not exists omnistore.provision_history (
        id uuid primary key default gen_random_uuid(),
        tenant_id uuid not null,
        request_id uuid not null unique,
        action text not null,
        status text not null,
        actor_id uuid references auth.users(id),
        details jsonb not null default '{}'::jsonb,
        created_at timestamptz not null default now()
      );

      create table if not exists omnistore.workspace_audit (
        id bigint generated always as identity primary key,
        tenant_id uuid not null,
        workspace_id uuid,
        actor_id uuid references auth.users(id),
        event text not null,
        details jsonb not null default '{}'::jsonb,
        created_at timestamptz not null default now()
      );

      create index if not exists idx_workspaces_tenant on omnistore.workspaces(tenant_id, status);
      create index if not exists idx_provision_history_tenant on omnistore.provision_history(tenant_id, created_at desc);
      create index if not exists idx_workspace_audit_tenant on omnistore.workspace_audit(tenant_id, created_at desc);

      drop trigger if exists trg_workspaces_updated on omnistore.workspaces;
      create trigger trg_workspaces_updated before update on omnistore.workspaces
      for each row execute function omnistore.set_updated_at();

      do $$
      declare
        table_name text;
        tenant_tables text[] := array[
          'workspaces','subscriptions','tenant_api_credentials','cashboxes','report_settings',
          'tenant_storage_usage','provision_history','workspace_audit'
        ];
      begin
        foreach table_name in array tenant_tables loop
          execute format('alter table omnistore.%I enable row level security', table_name);
          execute format('create policy tenant_select on omnistore.%I for select using (tenant_id = omnistore.current_tenant_id())', table_name);
          execute format('create policy tenant_insert on omnistore.%I for insert with check (tenant_id = omnistore.current_tenant_id())', table_name);
          execute format('create policy tenant_update on omnistore.%I for update using (tenant_id = omnistore.current_tenant_id()) with check (tenant_id = omnistore.current_tenant_id())', table_name);
          execute format('create policy tenant_delete on omnistore.%I for delete using (tenant_id = omnistore.current_tenant_id() and omnistore.is_tenant_admin())', table_name);
        end loop;
      end
      $$;

      alter table omnistore.tenants enable row level security;
      create policy tenant_select on omnistore.tenants
        for select using (id = omnistore.current_tenant_id());
      create policy tenant_insert on omnistore.tenants
        for insert with check (false);
      create policy tenant_update on omnistore.tenants
        for update using (id = omnistore.current_tenant_id() and omnistore.is_tenant_admin())
        with check (id = omnistore.current_tenant_id() and omnistore.is_tenant_admin());
      create policy tenant_delete on omnistore.tenants
        for delete using (id = omnistore.current_tenant_id() and omnistore.is_tenant_admin());

      drop policy tenant_select on omnistore.tenant_api_credentials;
      drop policy tenant_insert on omnistore.tenant_api_credentials;
      drop policy tenant_update on omnistore.tenant_api_credentials;
      drop policy tenant_delete on omnistore.tenant_api_credentials;
      create policy tenant_select on omnistore.tenant_api_credentials
        for select using (tenant_id = omnistore.current_tenant_id() and omnistore.is_tenant_admin());
      create policy tenant_insert on omnistore.tenant_api_credentials
        for insert with check (tenant_id = omnistore.current_tenant_id() and omnistore.is_tenant_admin());
      create policy tenant_update on omnistore.tenant_api_credentials
        for update using (tenant_id = omnistore.current_tenant_id() and omnistore.is_tenant_admin())
        with check (tenant_id = omnistore.current_tenant_id() and omnistore.is_tenant_admin());
      create policy tenant_delete on omnistore.tenant_api_credentials
        for delete using (tenant_id = omnistore.current_tenant_id() and omnistore.is_tenant_admin());

      drop policy tenant_select on omnistore.provision_history;
      drop policy tenant_insert on omnistore.provision_history;
      drop policy tenant_update on omnistore.provision_history;
      drop policy tenant_delete on omnistore.provision_history;
      create policy tenant_select on omnistore.provision_history for select using (
        tenant_id = omnistore.current_tenant_id() and omnistore.is_tenant_admin()
        and exists (select 1 from omnistore.tenants tenant where tenant.id = provision_history.tenant_id and tenant.status = 'active')
      );
      create policy tenant_insert on omnistore.provision_history for insert with check (
        tenant_id = omnistore.current_tenant_id() and omnistore.is_tenant_admin()
        and exists (select 1 from omnistore.tenants tenant where tenant.id = provision_history.tenant_id and tenant.status = 'active')
      );
      create policy tenant_update on omnistore.provision_history for update using (
        tenant_id = omnistore.current_tenant_id() and omnistore.is_tenant_admin()
        and exists (select 1 from omnistore.tenants tenant where tenant.id = provision_history.tenant_id and tenant.status = 'active')
      );
      create policy tenant_delete on omnistore.provision_history for delete using (
        tenant_id = omnistore.current_tenant_id() and omnistore.is_tenant_admin()
        and exists (select 1 from omnistore.tenants tenant where tenant.id = provision_history.tenant_id and tenant.status = 'active')
      );

      drop policy tenant_select on omnistore.workspace_audit;
      drop policy tenant_insert on omnistore.workspace_audit;
      drop policy tenant_update on omnistore.workspace_audit;
      drop policy tenant_delete on omnistore.workspace_audit;
      create policy tenant_select on omnistore.workspace_audit for select using (
        tenant_id = omnistore.current_tenant_id() and omnistore.is_tenant_admin()
        and exists (select 1 from omnistore.tenants tenant where tenant.id = workspace_audit.tenant_id and tenant.status = 'active')
      );
      create policy tenant_insert on omnistore.workspace_audit for insert with check (
        tenant_id = omnistore.current_tenant_id() and omnistore.is_tenant_admin()
        and exists (select 1 from omnistore.tenants tenant where tenant.id = workspace_audit.tenant_id and tenant.status = 'active')
      );
      create policy tenant_update on omnistore.workspace_audit for update using (
        tenant_id = omnistore.current_tenant_id() and omnistore.is_tenant_admin()
        and exists (select 1 from omnistore.tenants tenant where tenant.id = workspace_audit.tenant_id and tenant.status = 'active')
      );
      create policy tenant_delete on omnistore.workspace_audit for delete using (
        tenant_id = omnistore.current_tenant_id() and omnistore.is_tenant_admin()
        and exists (select 1 from omnistore.tenants tenant where tenant.id = workspace_audit.tenant_id and tenant.status = 'active')
      );
    `
  }
]
