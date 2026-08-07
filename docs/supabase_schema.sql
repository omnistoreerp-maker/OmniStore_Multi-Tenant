-- DigiTronics Supabase phase 1 schema.
-- Run this file in Supabase SQL Editor.
-- The app still keeps LocalStorage/GitHub sync as fallback during this phase.

create extension if not exists pgcrypto;

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  legacy_id text unique,
  sku text,
  name text not null,
  has_serial boolean not null default false,
  buy_price numeric(14,2) not null default 0,
  sell_price numeric(14,2) not null default 0,
  min_stock numeric(14,3) not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.sales (
  id uuid primary key default gen_random_uuid(),
  invoice_no text not null unique,
  sale_date timestamptz not null default now(),
  customer_name text not null default 'عميل نقدي',
  customer_phone text,
  invoice_type text not null default 'cash',
  payment_method text not null default 'cash',
  subtotal numeric(14,2) not null default 0,
  discount numeric(14,2) not null default 0,
  total numeric(14,2) not null default 0,
  profit numeric(14,2) not null default 0,
  status text not null default 'active',
  note text,
  created_by text,
  cancelled_at timestamptz,
  cancel_reason text,
  raw_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.sale_items (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references public.sales(id) on delete cascade,
  product_id uuid references public.products(id),
  legacy_product_id text,
  name text not null,
  qty numeric(14,3) not null check (qty > 0),
  unit_price numeric(14,2) not null default 0,
  unit_cost numeric(14,2) not null default 0,
  serials jsonb not null default '[]'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.purchases (
  id uuid primary key default gen_random_uuid(),
  invoice_no text not null unique,
  purchase_date timestamptz not null default now(),
  supplier_name text not null default '',
  supplier_phone text,
  invoice_type text not null default 'cash',
  payment_method text not null default 'cash',
  subtotal numeric(14,2) not null default 0,
  discount numeric(14,2) not null default 0,
  total numeric(14,2) not null default 0,
  status text not null default 'active',
  note text,
  created_by text,
  cancelled_at timestamptz,
  cancel_reason text,
  raw_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.purchase_items (
  id uuid primary key default gen_random_uuid(),
  purchase_id uuid not null references public.purchases(id) on delete cascade,
  product_id uuid references public.products(id),
  legacy_product_id text,
  name text not null,
  qty numeric(14,3) not null check (qty > 0),
  unit_price numeric(14,2) not null default 0,
  serials jsonb not null default '[]'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.cash_transactions (
  id uuid primary key default gen_random_uuid(),
  transaction_date timestamptz not null default now(),
  direction text not null check (direction in ('in', 'out')),
  amount numeric(14,2) not null check (amount > 0),
  method text not null default 'cash',
  source_type text not null,
  source_id uuid,
  source_ref text,
  description text,
  created_by text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.stock_transactions (
  id uuid primary key default gen_random_uuid(),
  transaction_date timestamptz not null default now(),
  product_id uuid references public.products(id),
  legacy_product_id text,
  direction text not null check (direction in ('in', 'out')),
  qty numeric(14,3) not null check (qty > 0),
  source_type text not null,
  source_id uuid,
  source_ref text,
  serials jsonb not null default '[]'::jsonb,
  description text,
  created_by text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.daily_closing (
  id uuid primary key default gen_random_uuid(),
  close_date date not null unique,
  cash_total numeric(14,2) not null default 0,
  stock_value numeric(14,2) not null default 0,
  sales_total numeric(14,2) not null default 0,
  purchases_total numeric(14,2) not null default 0,
  closed_by text,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  action text not null,
  entity_type text,
  entity_id uuid,
  entity_ref text,
  details jsonb not null default '{}'::jsonb,
  created_by text,
  created_at timestamptz not null default now()
);

create table if not exists public.user_roles (
  id uuid primary key default gen_random_uuid(),
  username text not null unique,
  role text not null,
  can_manage_finance boolean not null default false,
  can_manage_stock boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.devices (
  id uuid primary key default gen_random_uuid(),
  serial_number text,
  imei text,
  service_tag text,
  asset_tag text,
  warranty_start date,
  warranty_end date,
  warranty_status text not null default 'unknown' check (warranty_status in ('active', 'expired', 'unknown')),
  customer_id text,
  customer_name text,
  customer_phone text,
  product_id uuid references public.products(id),
  legacy_product_id text,
  product_name text,
  sale_id uuid references public.sales(id),
  sale_ref text,
  purchase_id uuid references public.purchases(id),
  purchase_ref text,
  status text not null default 'available' check (status in ('available', 'sold', 'repair', 'returned', 'scrapped')),
  notes text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists devices_serial_number_unique
  on public.devices (serial_number)
  where serial_number is not null and btrim(serial_number) <> '';

create unique index if not exists devices_imei_unique
  on public.devices (imei)
  where imei is not null and btrim(imei) <> '';

create unique index if not exists devices_service_tag_unique
  on public.devices (service_tag)
  where service_tag is not null and btrim(service_tag) <> '';

create table if not exists public.device_repairs (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references public.devices(id) on delete cascade,
  repair_date timestamptz not null default now(),
  issue text not null,
  solution text,
  cost numeric(14,2) not null default 0,
  technician text,
  status text not null default 'open' check (status in ('open', 'in_progress', 'done', 'cancelled')),
  notes text,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace view public.cash_balance as
select coalesce(sum(case when direction = 'in' then amount else -amount end), 0)::numeric(14,2) as balance
from public.cash_transactions;

create or replace view public.product_stock_balance as
select
  coalesce(st.product_id, p.id) as product_id,
  coalesce(st.legacy_product_id, p.legacy_id) as legacy_product_id,
  p.name,
  coalesce(sum(case when st.direction = 'in' then st.qty else -st.qty end), 0)::numeric(14,3) as stock_qty
from public.products p
left join public.stock_transactions st on st.product_id = p.id or st.legacy_product_id = p.legacy_id
group by coalesce(st.product_id, p.id), coalesce(st.legacy_product_id, p.legacy_id), p.name;

create index if not exists idx_sales_invoice_no on public.sales(invoice_no);
create index if not exists idx_sale_items_sale_id on public.sale_items(sale_id);
create index if not exists idx_purchases_invoice_no on public.purchases(invoice_no);
create index if not exists idx_cash_source on public.cash_transactions(source_type, source_ref);
create index if not exists idx_stock_source on public.stock_transactions(source_type, source_ref);
create index if not exists idx_devices_customer on public.devices(customer_name, customer_phone);
create index if not exists idx_devices_status on public.devices(status);
create index if not exists idx_device_repairs_device_id on public.device_repairs(device_id);

alter table public.devices add column if not exists product_name text;

create or replace function public.create_sale(p_sale jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sale_id uuid;
  v_invoice_no text := coalesce(nullif(p_sale->>'invoiceId', ''), 'INV-' || to_char(extract(epoch from clock_timestamp())::bigint, 'FM999999999999'));
  v_sale_date timestamptz := coalesce(nullif(p_sale->>'issueDateIso', '')::timestamptz, now());
  v_customer text := coalesce(nullif(p_sale->>'customer', ''), 'عميل نقدي');
  v_payment text := coalesce(nullif(p_sale->>'paymentType', ''), 'cash');
  v_invoice_type text := coalesce(nullif(p_sale->>'invoiceType', ''), 'cash');
  v_subtotal numeric(14,2) := coalesce((p_sale->>'subtotal')::numeric, 0);
  v_discount numeric(14,2) := coalesce((p_sale->>'discount')::numeric, 0);
  v_total numeric(14,2) := coalesce((p_sale->>'total')::numeric, 0);
  v_profit numeric(14,2) := coalesce((p_sale->>'profit')::numeric, 0);
  v_item jsonb;
  v_product_id uuid;
  v_qty numeric(14,3);
  v_down_payment numeric(14,2) := coalesce((p_sale->>'downPayment')::numeric, 0);
begin
  if exists (select 1 from public.sales where invoice_no = v_invoice_no) then
    raise exception 'sale invoice % already exists', v_invoice_no;
  end if;

  if v_subtotal = 0 then
    select coalesce(sum((item->>'price')::numeric * (item->>'qty')::numeric), 0)
    into v_subtotal
    from jsonb_array_elements(coalesce(p_sale->'items', '[]'::jsonb)) item;
  end if;
  if v_total = 0 then
    v_total := greatest(v_subtotal - v_discount, 0);
  end if;

  insert into public.sales (
    invoice_no, sale_date, customer_name, customer_phone, invoice_type, payment_method,
    subtotal, discount, total, profit, note, created_by, raw_payload
  )
  values (
    v_invoice_no, v_sale_date, v_customer, p_sale->>'customerPhone', v_invoice_type, v_payment,
    v_subtotal, v_discount, v_total, v_profit, p_sale->>'note', p_sale->>'user', p_sale
  )
  returning id into v_sale_id;

  for v_item in select * from jsonb_array_elements(coalesce(p_sale->'items', '[]'::jsonb))
  loop
    v_qty := coalesce((v_item->>'qty')::numeric, 0);
    select id into v_product_id
    from public.products
    where legacy_id = v_item->>'productId'
       or legacy_id = (v_item->>'productId')::text
    limit 1;

    insert into public.sale_items (
      sale_id, product_id, legacy_product_id, name, qty, unit_price, unit_cost, serials, metadata
    )
    values (
      v_sale_id, v_product_id, v_item->>'productId', coalesce(v_item->>'name', 'صنف'),
      v_qty, coalesce((v_item->>'price')::numeric, 0), coalesce((v_item->>'buyPrice')::numeric, 0),
      coalesce(v_item->'serials', '[]'::jsonb), v_item
    );

    insert into public.stock_transactions (
      transaction_date, product_id, legacy_product_id, direction, qty, source_type, source_id,
      source_ref, serials, description, created_by, metadata
    )
    values (
      v_sale_date, v_product_id, v_item->>'productId', 'out', v_qty, 'sale', v_sale_id,
      v_invoice_no, coalesce(v_item->'serials', '[]'::jsonb), 'بيع - فاتورة ' || v_invoice_no,
      p_sale->>'user', v_item
    );
  end loop;

  if v_payment <> 'installment' and v_invoice_type = 'cash' and v_total > 0 then
    insert into public.cash_transactions (
      transaction_date, direction, amount, method, source_type, source_id, source_ref,
      description, created_by, metadata
    )
    values (
      v_sale_date, 'in', v_total, v_payment, 'sale', v_sale_id, v_invoice_no,
      'بيع - ' || v_customer, p_sale->>'user', p_sale
    );
  elsif v_payment = 'installment' and v_down_payment > 0 then
    insert into public.cash_transactions (
      transaction_date, direction, amount, method, source_type, source_id, source_ref,
      description, created_by, metadata
    )
    values (
      v_sale_date, 'in', v_down_payment, 'cash', 'sale', v_sale_id, v_invoice_no,
      'مقدم تقسيط - ' || v_customer, p_sale->>'user', p_sale
    );
  end if;

  insert into public.audit_logs(action, entity_type, entity_id, entity_ref, details, created_by)
  values ('create_sale', 'sale', v_sale_id, v_invoice_no, p_sale, p_sale->>'user');

  return jsonb_build_object('sale_id', v_sale_id, 'invoice_no', v_invoice_no);
end;
$$;

create or replace function public.create_purchase(p_purchase jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_purchase_id uuid;
  v_invoice_no text := coalesce(nullif(p_purchase->>'invoiceId', ''), 'PUR-' || extract(epoch from clock_timestamp())::bigint);
  v_purchase_date timestamptz := coalesce(nullif(p_purchase->>'issueDateIso', '')::timestamptz, now());
  v_supplier text := coalesce(nullif(p_purchase->>'supplier', ''), '');
  v_payment text := coalesce(nullif(p_purchase->>'paymentMethod', ''), 'cash');
  v_invoice_type text := coalesce(nullif(p_purchase->>'invoiceType', ''), 'cash');
  v_total numeric(14,2) := coalesce((p_purchase->>'total')::numeric, 0);
  v_item jsonb;
  v_product_id uuid;
  v_qty numeric(14,3);
begin
  insert into public.purchases (
    invoice_no, purchase_date, supplier_name, supplier_phone, invoice_type, payment_method,
    subtotal, discount, total, note, created_by, raw_payload
  )
  values (
    v_invoice_no, v_purchase_date, v_supplier, p_purchase->>'supplierPhone', v_invoice_type, v_payment,
    coalesce((p_purchase->>'subtotal')::numeric, v_total), coalesce((p_purchase->>'discount')::numeric, 0),
    v_total, p_purchase->>'note', p_purchase->>'user', p_purchase
  )
  returning id into v_purchase_id;

  for v_item in select * from jsonb_array_elements(coalesce(p_purchase->'items', '[]'::jsonb))
  loop
    v_qty := coalesce((v_item->>'qty')::numeric, 0);
    select id into v_product_id from public.products where legacy_id = v_item->>'productId' limit 1;

    insert into public.purchase_items(purchase_id, product_id, legacy_product_id, name, qty, unit_price, serials, metadata)
    values (v_purchase_id, v_product_id, v_item->>'productId', coalesce(v_item->>'name', 'صنف'), v_qty,
      coalesce((v_item->>'price')::numeric, 0), coalesce(v_item->'serials', '[]'::jsonb), v_item);

    insert into public.stock_transactions(transaction_date, product_id, legacy_product_id, direction, qty, source_type, source_id, source_ref, serials, description, created_by, metadata)
    values (v_purchase_date, v_product_id, v_item->>'productId', 'in', v_qty, 'purchase', v_purchase_id,
      v_invoice_no, coalesce(v_item->'serials', '[]'::jsonb), 'شراء - فاتورة ' || v_invoice_no, p_purchase->>'user', v_item);
  end loop;

  if v_invoice_type = 'cash' and v_payment <> 'ajel' and v_total > 0 then
    insert into public.cash_transactions(transaction_date, direction, amount, method, source_type, source_id, source_ref, description, created_by, metadata)
    values (v_purchase_date, 'out', v_total, v_payment, 'purchase', v_purchase_id, v_invoice_no,
      'شراء - ' || v_supplier, p_purchase->>'user', p_purchase);
  end if;

  insert into public.audit_logs(action, entity_type, entity_id, entity_ref, details, created_by)
  values ('create_purchase', 'purchase', v_purchase_id, v_invoice_no, p_purchase, p_purchase->>'user');

  return jsonb_build_object('purchase_id', v_purchase_id, 'invoice_no', v_invoice_no);
end;
$$;

create or replace function public.cancel_sale(p_invoice_no text, p_reason text default null, p_user text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sale public.sales%rowtype;
  v_item public.sale_items%rowtype;
begin
  select * into v_sale from public.sales where invoice_no = p_invoice_no and status = 'active';
  if not found then
    raise exception 'active sale invoice % was not found', p_invoice_no;
  end if;

  update public.sales
  set status = 'cancelled', cancelled_at = now(), cancel_reason = p_reason
  where id = v_sale.id;

  insert into public.cash_transactions(transaction_date, direction, amount, method, source_type, source_id, source_ref, description, created_by)
  select now(), 'out', total, payment_method, 'sale_cancel', id, invoice_no, 'إلغاء فاتورة بيع ' || invoice_no, p_user
  from public.sales
  where id = v_sale.id and invoice_type = 'cash' and payment_method <> 'installment' and total > 0;

  for v_item in select * from public.sale_items where sale_id = v_sale.id
  loop
    insert into public.stock_transactions(transaction_date, product_id, legacy_product_id, direction, qty, source_type, source_id, source_ref, serials, description, created_by)
    values (now(), v_item.product_id, v_item.legacy_product_id, 'in', v_item.qty, 'sale_cancel', v_sale.id,
      v_sale.invoice_no, v_item.serials, 'إلغاء فاتورة بيع ' || v_sale.invoice_no, p_user);
  end loop;

  insert into public.audit_logs(action, entity_type, entity_id, entity_ref, details, created_by)
  values ('cancel_sale', 'sale', v_sale.id, v_sale.invoice_no, jsonb_build_object('reason', p_reason), p_user);

  return jsonb_build_object('sale_id', v_sale.id, 'invoice_no', v_sale.invoice_no, 'status', 'cancelled');
end;
$$;

create or replace function public.close_day(p_close_date date default current_date, p_user text default null, p_notes text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cash_total numeric(14,2);
  v_sales_total numeric(14,2);
  v_purchases_total numeric(14,2);
  v_stock_value numeric(14,2);
begin
  select coalesce(sum(case when direction = 'in' then amount else -amount end), 0)
  into v_cash_total
  from public.cash_transactions
  where transaction_date::date <= p_close_date;

  select coalesce(sum(total), 0) into v_sales_total
  from public.sales
  where sale_date::date = p_close_date and status = 'active';

  select coalesce(sum(total), 0) into v_purchases_total
  from public.purchases
  where purchase_date::date = p_close_date and status = 'active';

  select coalesce(sum(ps.stock_qty * p.buy_price), 0)
  into v_stock_value
  from public.product_stock_balance ps
  join public.products p on p.id = ps.product_id;

  insert into public.daily_closing(close_date, cash_total, stock_value, sales_total, purchases_total, closed_by, notes)
  values (p_close_date, v_cash_total, v_stock_value, v_sales_total, v_purchases_total, p_user, p_notes)
  on conflict (close_date) do update set
    cash_total = excluded.cash_total,
    stock_value = excluded.stock_value,
    sales_total = excluded.sales_total,
    purchases_total = excluded.purchases_total,
    closed_by = excluded.closed_by,
    notes = excluded.notes;

  insert into public.audit_logs(action, entity_type, entity_ref, details, created_by)
  values ('close_day', 'daily_closing', p_close_date::text,
    jsonb_build_object('cash_total', v_cash_total, 'sales_total', v_sales_total, 'purchases_total', v_purchases_total, 'stock_value', v_stock_value),
    p_user);

  return jsonb_build_object('close_date', p_close_date, 'cash_total', v_cash_total, 'stock_value', v_stock_value);
end;
$$;

alter table public.products enable row level security;
alter table public.sales enable row level security;
alter table public.sale_items enable row level security;
alter table public.purchases enable row level security;
alter table public.purchase_items enable row level security;
alter table public.cash_transactions enable row level security;
alter table public.stock_transactions enable row level security;
alter table public.daily_closing enable row level security;
alter table public.audit_logs enable row level security;
alter table public.user_roles enable row level security;
alter table public.devices enable row level security;
alter table public.device_repairs enable row level security;

drop policy if exists "devices_read_phase5" on public.devices;
create policy "devices_read_phase5" on public.devices
  for select to anon, authenticated
  using (true);

drop policy if exists "device_repairs_read_phase5" on public.device_repairs;
create policy "device_repairs_read_phase5" on public.device_repairs
  for select to anon, authenticated
  using (true);

drop policy if exists "devices_insert_phase6" on public.devices;
create policy "devices_insert_phase6" on public.devices
  for insert to anon, authenticated
  with check (true);

drop policy if exists "devices_update_phase6" on public.devices;
create policy "devices_update_phase6" on public.devices
  for update to anon, authenticated
  using (true)
  with check (true);

drop policy if exists "device_repairs_insert_phase6" on public.device_repairs;
create policy "device_repairs_insert_phase6" on public.device_repairs
  for insert to anon, authenticated
  with check (true);

drop policy if exists "device_repairs_update_phase6" on public.device_repairs;
create policy "device_repairs_update_phase6" on public.device_repairs
  for update to anon, authenticated
  using (true)
  with check (true);

grant select, insert, update on table public.devices to anon, authenticated;
grant select, insert, update on table public.device_repairs to anon, authenticated;

grant execute on function public.create_sale(jsonb) to anon, authenticated;
grant execute on function public.create_purchase(jsonb) to anon, authenticated;
grant execute on function public.cancel_sale(text, text, text) to anon, authenticated;
grant execute on function public.close_day(date, text, text) to anon, authenticated;

comment on table public.cash_transactions is 'Cash balance is derived from transactions only; do not store or edit a direct treasury balance.';
comment on table public.stock_transactions is 'Stock balance is derived from transactions only; do not store or edit a direct product stock quantity.';
