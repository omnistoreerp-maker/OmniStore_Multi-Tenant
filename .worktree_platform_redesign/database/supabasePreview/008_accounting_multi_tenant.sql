-- PHASE 24 DRAFT ONLY.
create table if not exists public.chart_of_accounts_multi_tenant (
  id uuid primary key,
  tenant_id uuid not null references public.tenants(id),
  account_code text not null,
  account_name text not null,
  account_type text not null,
  unique (tenant_id, account_code),
  unique (tenant_id, id)
);

create table if not exists public.journal_vouchers_multi_tenant (
  id uuid primary key,
  tenant_id uuid not null references public.tenants(id),
  voucher_number text not null,
  posting_status text not null default 'draft',
  posting_date date not null,
  reference text,
  unique (tenant_id, voucher_number),
  unique (tenant_id, id)
);

create table if not exists public.journal_lines_multi_tenant (
  id uuid primary key,
  tenant_id uuid not null references public.tenants(id),
  voucher_id uuid not null,
  account_id uuid not null,
  debit numeric(18,4) not null default 0,
  credit numeric(18,4) not null default 0,
  foreign key (tenant_id, voucher_id) references public.journal_vouchers_multi_tenant(tenant_id, id),
  foreign key (tenant_id, account_id) references public.chart_of_accounts_multi_tenant(tenant_id, id)
);
