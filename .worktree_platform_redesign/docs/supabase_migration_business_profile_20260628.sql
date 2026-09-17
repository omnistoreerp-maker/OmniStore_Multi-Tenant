-- DigiTronics: optional Business Profile migration (safe/additive).
-- This script creates ONE new table only. It does not rename, alter, truncate,
-- or delete any existing table or row.
-- The current app continues to work from LocalStorage without running this file.

begin;

create table if not exists public.business_profile (
  id text primary key default 'default' check (id = 'default'),
  business_type text not null default 'computer_shop'
    check (business_type in (
      'computer_shop',
      'auto_parts',
      'auto_accessories',
      'mobile_shop',
      'electronics',
      'pharmacy',
      'supermarket',
      'restaurant',
      'fashion',
      'hardware',
      'furniture',
      'custom'
    )),
  business_name text not null default 'DigiTronics',
  logo_url text,
  currency text not null default 'EGP',
  currency_symbol text not null default 'EGP',
  language text not null default 'ar',
  time_zone text not null default 'Africa/Cairo',
  serial_enabled boolean not null default true,
  barcode_enabled boolean not null default true,
  part_number_enabled boolean not null default false,
  brand_enabled boolean not null default true,
  model_enabled boolean not null default true,
  car_make_enabled boolean not null default false,
  car_model_enabled boolean not null default false,
  car_year_enabled boolean not null default false,
  color_enabled boolean not null default true,
  size_enabled boolean not null default false,
  unit_enabled boolean not null default false,
  storage_location_enabled boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.business_profile is
  'Optional single-row, customizable business profile. Existing core tables are unchanged.';

insert into public.business_profile (id)
values ('default')
on conflict (id) do nothing;

-- RLS is enabled without opening anonymous access. Add a project-specific
-- authenticated policy only after the Supabase authentication model is defined.
alter table public.business_profile enable row level security;

commit;
