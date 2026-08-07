-- DigiTronics rollback for dt_rebuild_products_20260628.
-- Run only if the matching migration must be reverted.
-- This restores product_id to NULL and deletes only products created by that migration.

begin;

create temporary table _dt_rollback_products on commit drop as
select id, legacy_id
from public.products
where metadata->>'migration_id' = 'dt_rebuild_products_20260628';

do $$
begin
  if not exists (select 1 from _dt_rollback_products) then
    raise exception 'Rollback aborted: no products marked dt_rebuild_products_20260628 were found.';
  end if;

  if exists (
    select 1
    from public.devices d
    join _dt_rollback_products rp on rp.id = d.product_id
  ) then
    raise exception 'Rollback aborted: devices created after the migration reference rebuilt products. No data was changed.';
  end if;
end $$;

create temporary table _dt_rollback_report (
  metric text primary key,
  value bigint not null
) on commit drop;

with restored as (
  update public.purchase_items pi
  set product_id = null
  from _dt_rollback_products rp
  where pi.product_id = rp.id
    and trim(pi.legacy_product_id) = rp.legacy_id
  returning pi.id
)
insert into _dt_rollback_report values ('purchase_items_restored', (select count(*) from restored));

with restored as (
  update public.sale_items si
  set product_id = null
  from _dt_rollback_products rp
  where si.product_id = rp.id
    and trim(si.legacy_product_id) = rp.legacy_id
  returning si.id
)
insert into _dt_rollback_report values ('sale_items_restored', (select count(*) from restored));

with restored as (
  update public.stock_transactions st
  set product_id = null
  from _dt_rollback_products rp
  where st.product_id = rp.id
    and trim(st.legacy_product_id) = rp.legacy_id
  returning st.id
)
insert into _dt_rollback_report values ('stock_transactions_restored', (select count(*) from restored));

with deleted as (
  delete from public.products p
  using _dt_rollback_products rp
  where p.id = rp.id
  returning p.id
)
insert into _dt_rollback_report values ('products_deleted', (select count(*) from deleted));

do $$
begin
  if exists (
    select 1
    from public.products
    where metadata->>'migration_id' = 'dt_rebuild_products_20260628'
  ) then
    raise exception 'Rollback verification failed: marked products still exist.';
  end if;
end $$;

select metric, value
from _dt_rollback_report
order by metric;

commit;
