-- OmniStore Phase 11 Accounting Persistence Schema Design
-- DRAFT ONLY. DO NOT EXECUTE AUTOMATICALLY.
-- Purpose: accounting audit trail for create/edit/post/unpost/reverse/void actions.

create table if not exists accounting_audit_log (
  id uuid primary key default gen_random_uuid(),
  action text not null check (action in ('create','edit','delete','post','unpost','reverse','void','close_period','reopen_period','close_year','reopen_year')),
  entity_type text not null,
  entity_id text,
  voucher_id uuid references accounting_journal_vouchers(id),
  voucher_number text,
  actor_id text,
  actor_role text,
  branch_id text,
  before_snapshot jsonb,
  after_snapshot jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_accounting_audit_voucher on accounting_audit_log(voucher_id);
create index if not exists idx_accounting_audit_action on accounting_audit_log(action);
create index if not exists idx_accounting_audit_created_at on accounting_audit_log(created_at);
