-- DigiTronics: rebuild products from legacy item references and link UUIDs.
-- Run once in Supabase SQL Editor.
-- Atomic: any error rolls back the entire migration.

begin;

create temporary table _dt_product_sources (
  source_table text not null,
  source_rank integer not null,
  legacy_id text not null,
  product_name text,
  sku text,
  has_serial boolean not null default false,
  buy_price numeric(14,2),
  sell_price numeric(14,2),
  source_metadata jsonb not null default '{}'::jsonb,
  source_created_at timestamptz
) on commit drop;

insert into _dt_product_sources (
  source_table, source_rank, legacy_id, product_name, sku, has_serial,
  buy_price, sell_price, source_metadata, source_created_at
)
select
  'purchase_items',
  1,
  trim(pi.legacy_product_id),
  nullif(trim(pi.name), ''),
  coalesce(nullif(pi.metadata->>'sku', ''), nullif(pi.metadata->>'product_sku', '')),
  (
    (case when jsonb_typeof(pi.serials) = 'array' then jsonb_array_length(pi.serials) > 0 else false end)
    or lower(coalesce(pi.metadata->>'trackingMode', pi.metadata->>'tracking_mode', pi.metadata->>'tracking_type', ''))
       in ('serial', 'serialized', 'tracked')
  ),
  pi.unit_price,
  case
    when coalesce(pi.metadata->>'sell_price', pi.metadata->>'sale_price', '') ~ '^-?[0-9]+([.][0-9]+)?$'
    then coalesce(pi.metadata->>'sell_price', pi.metadata->>'sale_price')::numeric
    else null
  end,
  coalesce(pi.metadata, '{}'::jsonb),
  pi.created_at
from public.purchase_items pi
where nullif(trim(pi.legacy_product_id), '') is not null;

insert into _dt_product_sources (
  source_table, source_rank, legacy_id, product_name, sku, has_serial,
  buy_price, sell_price, source_metadata, source_created_at
)
select
  'sale_items',
  2,
  trim(si.legacy_product_id),
  nullif(trim(si.name), ''),
  coalesce(nullif(si.metadata->>'sku', ''), nullif(si.metadata->>'product_sku', '')),
  (
    (case when jsonb_typeof(si.serials) = 'array' then jsonb_array_length(si.serials) > 0 else false end)
    or lower(coalesce(si.metadata->>'trackingMode', si.metadata->>'tracking_mode', si.metadata->>'tracking_type', ''))
       in ('serial', 'serialized', 'tracked')
  ),
  si.unit_cost,
  si.unit_price,
  coalesce(si.metadata, '{}'::jsonb),
  si.created_at
from public.sale_items si
where nullif(trim(si.legacy_product_id), '') is not null;

insert into _dt_product_sources (
  source_table, source_rank, legacy_id, product_name, sku, has_serial,
  buy_price, sell_price, source_metadata, source_created_at
)
select
  'stock_transactions',
  3,
  trim(st.legacy_product_id),
  coalesce(
    nullif(st.metadata->>'product_name', ''),
    nullif(st.metadata->>'name', '')
  ),
  coalesce(nullif(st.metadata->>'sku', ''), nullif(st.metadata->>'product_sku', '')),
  (
    (case when jsonb_typeof(st.serials) = 'array' then jsonb_array_length(st.serials) > 0 else false end)
    or lower(coalesce(st.metadata->>'trackingMode', st.metadata->>'tracking_mode', st.metadata->>'tracking_type', ''))
       in ('serial', 'serialized', 'tracked')
  ),
  case
    when coalesce(st.metadata->>'buy_price', st.metadata->>'purchase_price', '') ~ '^-?[0-9]+([.][0-9]+)?$'
    then coalesce(st.metadata->>'buy_price', st.metadata->>'purchase_price')::numeric
    else null
  end,
  case
    when coalesce(st.metadata->>'sell_price', st.metadata->>'sale_price', '') ~ '^-?[0-9]+([.][0-9]+)?$'
    then coalesce(st.metadata->>'sell_price', st.metadata->>'sale_price')::numeric
    else null
  end,
  coalesce(st.metadata, '{}'::jsonb),
  st.created_at
from public.stock_transactions st
where nullif(trim(st.legacy_product_id), '') is not null;

do $$
begin
  if exists (select 1 from public.products) then
    raise exception 'Migration aborted: products is not empty. This recovery migration requires the confirmed empty products table.';
  end if;

  if not exists (select 1 from _dt_product_sources) then
    raise exception 'Migration aborted: no non-empty legacy_product_id values were found.';
  end if;

  -- The current recovery scenario expects these links to be NULL.
  -- Abort instead of overwriting an existing relationship.
  if exists (
    select 1 from public.purchase_items
    where nullif(trim(legacy_product_id), '') is not null and product_id is not null
  ) or exists (
    select 1 from public.sale_items
    where nullif(trim(legacy_product_id), '') is not null and product_id is not null
  ) or exists (
    select 1 from public.stock_transactions
    where nullif(trim(legacy_product_id), '') is not null and product_id is not null
  ) then
    raise exception 'Migration aborted: existing non-NULL product_id links were found. No data was changed.';
  end if;
end $$;

create temporary table _dt_product_seed on commit drop as
select
  ids.legacy_id,
  coalesce(
    (
      select s.product_name
      from _dt_product_sources s
      where s.legacy_id = ids.legacy_id and nullif(trim(s.product_name), '') is not null
      order by s.source_rank, s.source_created_at desc nulls last
      limit 1
    ),
    'Product ' || ids.legacy_id
  ) as name,
  (
    select s.sku
    from _dt_product_sources s
    where s.legacy_id = ids.legacy_id and nullif(trim(s.sku), '') is not null
    order by s.source_rank, s.source_created_at desc nulls last
    limit 1
  ) as sku,
  exists (
    select 1 from _dt_product_sources s
    where s.legacy_id = ids.legacy_id and s.has_serial
  ) as has_serial,
  coalesce(
    (
      select s.buy_price
      from _dt_product_sources s
      where s.legacy_id = ids.legacy_id and s.buy_price is not null
      order by
        case when s.buy_price > 0 then 0 else 1 end,
        s.source_rank,
        s.source_created_at desc nulls last
      limit 1
    ),
    0
  ) as buy_price,
  coalesce(
    (
      select s.sell_price
      from _dt_product_sources s
      where s.legacy_id = ids.legacy_id and s.sell_price is not null
      order by
        case when s.sell_price > 0 then 0 else 1 end,
        s.source_rank,
        s.source_created_at desc nulls last
      limit 1
    ),
    0
  ) as sell_price,
  coalesce(
    (
      select s.source_metadata
      from _dt_product_sources s
      where s.legacy_id = ids.legacy_id and s.source_metadata <> '{}'::jsonb
      order by s.source_rank, s.source_created_at desc nulls last
      limit 1
    ),
    '{}'::jsonb
  ) || jsonb_build_object(
    'migration_id', 'dt_rebuild_products_20260628',
    'rebuilt_from_legacy', true,
    'rebuilt_at', now(),
    'source_counts', jsonb_build_object(
      'purchase_items', (select count(*) from _dt_product_sources s where s.legacy_id = ids.legacy_id and s.source_table = 'purchase_items'),
      'sale_items', (select count(*) from _dt_product_sources s where s.legacy_id = ids.legacy_id and s.source_table = 'sale_items'),
      'stock_transactions', (select count(*) from _dt_product_sources s where s.legacy_id = ids.legacy_id and s.source_table = 'stock_transactions')
    )
  ) as metadata
from (select distinct legacy_id from _dt_product_sources) ids;

create temporary table _dt_created_products (
  id uuid primary key,
  legacy_id text not null unique
) on commit drop;

with inserted as (
  insert into public.products (
    legacy_id, sku, name, has_serial, buy_price, sell_price, metadata
  )
  select
    seed.legacy_id,
    seed.sku,
    seed.name,
    seed.has_serial,
    seed.buy_price,
    seed.sell_price,
    seed.metadata
  from _dt_product_seed seed
  on conflict (legacy_id) do nothing
  returning id, legacy_id
)
insert into _dt_created_products (id, legacy_id)
select id, legacy_id from inserted;

create temporary table _dt_migration_report (
  metric text primary key,
  value bigint not null
) on commit drop;

insert into _dt_migration_report values
  ('unique_legacy_products', (select count(*) from _dt_product_seed)),
  ('products_created', (select count(*) from _dt_created_products)),
  ('products_already_existing', (
    select count(*)
    from _dt_product_seed seed
    where exists (select 1 from public.products p where p.legacy_id = seed.legacy_id)
  ) - (select count(*) from _dt_created_products));

with updated as (
  update public.purchase_items pi
  set product_id = p.id
  from public.products p
  where pi.product_id is null
    and nullif(trim(pi.legacy_product_id), '') = p.legacy_id
  returning pi.id
)
insert into _dt_migration_report values ('purchase_items_linked', (select count(*) from updated));

with updated as (
  update public.sale_items si
  set product_id = p.id
  from public.products p
  where si.product_id is null
    and nullif(trim(si.legacy_product_id), '') = p.legacy_id
  returning si.id
)
insert into _dt_migration_report values ('sale_items_linked', (select count(*) from updated));

with updated as (
  update public.stock_transactions st
  set product_id = p.id
  from public.products p
  where st.product_id is null
    and nullif(trim(st.legacy_product_id), '') = p.legacy_id
  returning st.id
)
insert into _dt_migration_report values ('stock_transactions_linked', (select count(*) from updated));

do $$
begin
  if exists (
    select 1
    from public.purchase_items pi
    left join public.products p on p.id = pi.product_id
    where nullif(trim(pi.legacy_product_id), '') is not null
      and (p.id is null or p.legacy_id <> trim(pi.legacy_product_id))
  ) then
    raise exception 'Verification failed: purchase_items contains missing or mismatched product links.';
  end if;

  if exists (
    select 1
    from public.sale_items si
    left join public.products p on p.id = si.product_id
    where nullif(trim(si.legacy_product_id), '') is not null
      and (p.id is null or p.legacy_id <> trim(si.legacy_product_id))
  ) then
    raise exception 'Verification failed: sale_items contains missing or mismatched product links.';
  end if;

  if exists (
    select 1
    from public.stock_transactions st
    left join public.products p on p.id = st.product_id
    where nullif(trim(st.legacy_product_id), '') is not null
      and (p.id is null or p.legacy_id <> trim(st.legacy_product_id))
  ) then
    raise exception 'Verification failed: stock_transactions contains missing or mismatched product links.';
  end if;
end $$;

-- Result set shown by Supabase SQL Editor.
select metric, value
from _dt_migration_report
union all
select 'purchase_items_unlinked_after', count(*)
from public.purchase_items
where nullif(trim(legacy_product_id), '') is not null and product_id is null
union all
select 'sale_items_unlinked_after', count(*)
from public.sale_items
where nullif(trim(legacy_product_id), '') is not null and product_id is null
union all
select 'stock_transactions_unlinked_after', count(*)
from public.stock_transactions
where nullif(trim(legacy_product_id), '') is not null and product_id is null
order by metric;

commit;
