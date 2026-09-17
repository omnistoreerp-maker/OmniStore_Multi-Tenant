import { createClient } from 'npm:@supabase/supabase-js@2'
import postgres from 'npm:postgres@3.4.7'
import { MIGRATION_VERSION, migrations } from './migrations.ts'
import {
  provisionCustomer,
  listCustomers,
  customerDetails,
  workspaceHealth,
  provisionHistory,
  workspaceAudit,
  rollbackPreview as customerRollbackPreview,
  deleteCustomer
} from './provisioning.ts'

const REQUIRED_TABLES = [
  'tenants','business_profiles','user_profiles','role_templates','permission_templates','roles','permissions',
  'role_permissions','currencies','taxes','branches','customers','suppliers','categories','products','warehouses',
  'inventory_transactions','sales_invoices','sales_invoice_lines','purchase_invoices','purchase_invoice_lines',
  'pos_transactions','pos_settings','chart_of_accounts','journal_vouchers','journal_lines',
  'accounting_settings','printing_settings','system_settings','audit_logs','workspaces','subscriptions',
  'tenant_api_credentials','cashboxes','report_settings','tenant_storage_usage','provision_history',
  'workspace_audit','schema_migrations','installer_admins'
]
const REQUIRED_INDEXES = ['idx_user_profiles_tenant','idx_products_tenant_sku','idx_inventory_tenant_product','idx_sales_tenant_date','idx_purchases_tenant_date','idx_journal_tenant_date','idx_audit_tenant_created','idx_workspaces_tenant','idx_provision_history_tenant','idx_workspace_audit_tenant']
const REQUIRED_FUNCTIONS = ['current_tenant_id','is_tenant_admin','set_updated_at']
const REQUIRED_TRIGGERS = ['trg_business_profiles_updated','trg_products_updated','trg_system_settings_updated','trg_workspaces_updated']
const TENANT_TABLE_COUNT = 35

function json(body: unknown, status = 200, origin = '') {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Cache-Control': 'no-store'
    }
  })
}

function allowedOrigin(req: Request) {
  const configured = Deno.env.get('INSTALLER_ALLOWED_ORIGIN') || ''
  const origin = req.headers.get('origin') || ''
  return configured && origin === configured ? origin : ''
}

function serverSecret() {
  const legacy = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (legacy) return legacy
  const raw = Deno.env.get('SUPABASE_SECRET_KEYS')
  if (!raw) return ''
  try {
    const parsed = JSON.parse(raw)
    return parsed.default || Object.values(parsed)[0] || ''
  } catch {
    return ''
  }
}

async function authenticatedAdmin(req: Request) {
  const authHeader = req.headers.get('authorization') || ''
  const token = authHeader.replace(/^Bearer\s+/i, '')
  const url = Deno.env.get('SUPABASE_URL') || ''
  const secret = serverSecret()
  if (!token || !url || !secret) throw new Error('INSTALLER_SERVER_CONFIGURATION_MISSING')
  const adminClient = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data, error } = await adminClient.auth.getUser(token)
  if (error || !data.user) throw new Error('AUTHENTICATION_REQUIRED')
  const role = String(data.user.app_metadata?.role || '')
  if (!['owner', 'admin'].includes(role)) throw new Error('ADMIN_PERMISSION_REQUIRED')
  return { id: data.user.id, email: data.user.email || '', role, client: adminClient }
}

async function checksum(value: string) {
  const bytes = new TextEncoder().encode(value)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest)).map(byte => byte.toString(16).padStart(2, '0')).join('')
}

function dbClient() {
  const dbUrl = Deno.env.get('SUPABASE_DB_URL')
  if (!dbUrl) throw new Error('SUPABASE_DB_URL_MISSING')
  return postgres(dbUrl, { max: 1, prepare: false, idle_timeout: 10, connect_timeout: 10 })
}

async function schemaExists(sql: ReturnType<typeof postgres>) {
  const rows = await sql<{ exists: boolean }[]>`select exists(select 1 from information_schema.schemata where schema_name = 'omnistore') as exists`
  return Boolean(rows[0]?.exists)
}

async function snapshot(sql: ReturnType<typeof postgres>) {
  const exists = await schemaExists(sql)
  if (!exists) return { verified: true, schemaExists: false, tableCount: 0, migrationCount: 0, capturedAt: new Date().toISOString() }
  const tables = await sql<{ count: number }[]>`select count(*)::int as count from information_schema.tables where table_schema = 'omnistore'`
  const migrationTable = await sql<{ exists: boolean }[]>`select to_regclass('omnistore.schema_migrations') is not null as exists`
  let migrationCount = 0
  if (migrationTable[0]?.exists) {
    const rows = await sql<{ count: number }[]>`select count(*)::int as count from omnistore.schema_migrations`
    migrationCount = rows[0]?.count || 0
  }
  return { verified: true, schemaExists: true, tableCount: tables[0]?.count || 0, migrationCount, capturedAt: new Date().toISOString() }
}

async function verifyInstallation(sql: ReturnType<typeof postgres>, adminId: string) {
  const tables = await sql<{ table_name: string }[]>`
    select table_name from information_schema.tables where table_schema = 'omnistore'
  `
  const tableSet = new Set(tables.map(row => row.table_name))
  const indexes = await sql<{ indexname: string }[]>`select indexname from pg_indexes where schemaname = 'omnistore'`
  const indexSet = new Set(indexes.map(row => row.indexname))
  const functions = await sql<{ routine_name: string }[]>`
    select routine_name from information_schema.routines where routine_schema = 'omnistore'
  `
  const functionSet = new Set(functions.map(row => row.routine_name))
  const triggers = await sql<{ trigger_name: string }[]>`
    select trigger_name from information_schema.triggers where trigger_schema = 'omnistore'
  `
  const triggerSet = new Set(triggers.map(row => row.trigger_name))
  const policies = await sql<{ count: number }[]>`select count(*)::int as count from pg_policies where schemaname = 'omnistore'`
  const defaultRoles = await sql<{ count: number }[]>`select count(*)::int as count from omnistore.role_templates where code in ('owner','admin','manager','accountant','cashier')`
  const defaultSettings = await sql<{ count: number }[]>`select count(*)::int as count from omnistore.default_settings where key in ('pos','inventory','accounting','printing','system')`
  const defaultAdmin = await sql<{ count: number }[]>`select count(*)::int as count from omnistore.installer_admins where user_id = ${adminId}`
  const missing = (required: string[], found: Set<string>) => required.filter(name => !found.has(name))
  return {
    tables: { valid: missing(REQUIRED_TABLES, tableSet).length === 0, missing: missing(REQUIRED_TABLES, tableSet) },
    indexes: { valid: missing(REQUIRED_INDEXES, indexSet).length === 0, missing: missing(REQUIRED_INDEXES, indexSet) },
    policies: { valid: (policies[0]?.count || 0) >= TENANT_TABLE_COUNT * 4, count: policies[0]?.count || 0 },
    triggers: { valid: missing(REQUIRED_TRIGGERS, triggerSet).length === 0, missing: missing(REQUIRED_TRIGGERS, triggerSet) },
    functions: { valid: missing(REQUIRED_FUNCTIONS, functionSet).length === 0, missing: missing(REQUIRED_FUNCTIONS, functionSet) },
    defaultAdmin: { valid: (defaultAdmin[0]?.count || 0) === 1 },
    defaultRoles: { valid: (defaultRoles[0]?.count || 0) === 5, count: defaultRoles[0]?.count || 0 },
    defaultSettings: { valid: (defaultSettings[0]?.count || 0) === 5, count: defaultSettings[0]?.count || 0 }
  }
}

async function health(sql: ReturnType<typeof postgres>) {
  const version = await sql<{ version: string }[]>`select current_setting('server_version') as version`
  const exists = await schemaExists(sql)
  let migrationVersion = 'not-installed'
  let rls = false
  if (exists) {
    const migrationTable = await sql<{ exists: boolean }[]>`select to_regclass('omnistore.schema_migrations') is not null as exists`
    if (migrationTable[0]?.exists) {
      const rows = await sql<{ id: string }[]>`select id from omnistore.schema_migrations order by installed_at desc limit 1`
      migrationVersion = rows[0]?.id || 'empty'
    }
    const rlsRows = await sql<{ count: number }[]>`select count(*)::int as count from pg_policies where schemaname = 'omnistore'`
    rls = (rlsRows[0]?.count || 0) > 0
  }
  const realtimeRows = await sql<{ exists: boolean }[]>`select exists(select 1 from pg_publication where pubname = 'supabase_realtime') as exists`
  return {
    database: true,
    databaseVersion: version[0]?.version || 'unknown',
    migrationVersion,
    rls,
    realtime: Boolean(realtimeRows[0]?.exists),
    projectStatus: 'active'
  }
}

async function install(sql: ReturnType<typeof postgres>, admin: { id: string; email: string }, body: Record<string, unknown>) {
  if (body.confirmation !== 'INSTALL_DATABASE') throw new Error('INSTALL_CONFIRMATION_REQUIRED')
  if (body.migrationVersion !== MIGRATION_VERSION) throw new Error('MIGRATION_VERSION_MISMATCH')
  const requestedIds = Array.isArray(body.migrationIds) ? body.migrationIds.map(String) : []
  if (requestedIds.join(',') !== migrations.map(item => item.id).join(',')) throw new Error('MIGRATION_MANIFEST_MISMATCH')
  const before = await snapshot(sql)
  const stages: Array<{ id: string; status: string; message: string }> = []
  await sql.begin(async transaction => {
    await transaction`select pg_advisory_xact_lock(hashtext('omnistore_erp_installer'))`
    for (const migration of migrations) {
      const hash = await checksum(migration.sql)
      const migrationTable = await transaction<{ exists: boolean }[]>`
        select to_regclass('omnistore.schema_migrations') is not null as exists
      `
      const installed = migrationTable[0]?.exists
        ? await transaction<{ checksum: string }[]>`select checksum from omnistore.schema_migrations where id = ${migration.id}`
        : []
      if (installed.length) {
        if (installed[0].checksum !== hash) throw new Error(`MIGRATION_CHECKSUM_MISMATCH:${migration.id}`)
        stages.push({ id: migration.id, status: 'skipped', message: 'Already installed with matching checksum' })
        continue
      }
      await transaction.unsafe(migration.sql)
      await transaction`
        insert into omnistore.schema_migrations(id, description, checksum, installed_by)
        values (${migration.id}, ${migration.description}, ${hash}, ${admin.id})
      `
      stages.push({ id: migration.id, status: 'completed', message: migration.description })
    }
    await transaction`
      insert into omnistore.installer_admins(user_id, email, installed_version)
      values (${admin.id}, ${admin.email}, ${MIGRATION_VERSION})
      on conflict (user_id) do update
      set email = excluded.email, installed_version = excluded.installed_version, installed_at = now()
    `
    await transaction`
      insert into omnistore.audit_logs(tenant_id, actor_id, action, entity_type, metadata)
      values (null, ${admin.id}, 'database_install', 'schema', ${JSON.stringify({ migrationVersion: MIGRATION_VERSION })}::jsonb)
    `
  })
  const verification = await verifyInstallation(sql, admin.id)
  return {
    installationId: crypto.randomUUID(),
    migrationVersion: MIGRATION_VERSION,
    stages,
    snapshotBefore: before,
    verification,
    completedAt: new Date().toISOString()
  }
}

Deno.serve(async req => {
  const origin = allowedOrigin(req)
  if (req.method === 'OPTIONS') return origin ? json({ ok: true }, 200, origin) : json({ error: 'ORIGIN_NOT_ALLOWED' }, 403, '')
  if (!origin) return json({ error: 'ORIGIN_NOT_ALLOWED' }, 403, '')
  if (req.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED' }, 405, origin)
  let sql: ReturnType<typeof postgres> | null = null
  try {
    const admin = await authenticatedAdmin(req)
    const body = await req.json()
    sql = dbClient()
    if (body.action === 'health') return json({ ok: true, health: await health(sql) }, 200, origin)
    if (body.action === 'install') return json(await install(sql, admin, body), 200, origin)
    if (body.action === 'provision-customer') {
      await install(sql, admin, {
        confirmation: 'INSTALL_DATABASE',
        migrationVersion: MIGRATION_VERSION,
        migrationIds: migrations.map(item => item.id)
      })
      return json(await provisionCustomer(sql, admin.client, admin, body, origin), 200, origin)
    }
    if (body.action === 'list-customers') return json({ customers: await listCustomers(sql) }, 200, origin)
    if (body.action === 'customer-details') return json({ customer: await customerDetails(sql, String(body.tenantId || '')) }, 200, origin)
    if (body.action === 'workspace-health') return json({ health: await workspaceHealth(sql, String(body.tenantId || '')) }, 200, origin)
    if (body.action === 'provision-history') return json({ history: await provisionHistory(sql, body.tenantId ? String(body.tenantId) : undefined) }, 200, origin)
    if (body.action === 'workspace-audit') return json({ audit: await workspaceAudit(sql, body.tenantId ? String(body.tenantId) : undefined) }, 200, origin)
    if (body.action === 'customer-rollback-preview') return json({ rollback: await customerRollbackPreview(sql, String(body.tenantId || '')) }, 200, origin)
    if (body.action === 'delete-customer') {
      return json({
        deletion: await deleteCustomer(sql, admin.client, admin, String(body.tenantId || ''), String(body.confirmation || ''))
      }, 200, origin)
    }
    if (body.action === 'verify') {
      const verification = await verifyInstallation(sql, admin.id)
      return json({ verification, migrationVersion: MIGRATION_VERSION, completedAt: new Date().toISOString() }, 200, origin)
    }
    if (body.action === 'rollback-preview') {
      const currentSnapshot = await snapshot(sql)
      return json({
        snapshot: currentSnapshot,
        migrationVersion: MIGRATION_VERSION,
        executionEnabled: false,
        steps: ['verify-snapshot','compare-migrations','generate-reviewed-rollback','require-second-confirmation']
      }, 200, origin)
    }
    return json({ error: 'UNSUPPORTED_ACTION' }, 400, origin)
  } catch (error) {
    const message = String(error instanceof Error ? error.message : error).replace(/postgres(?:ql)?:\/\/[^\s]+/gi, '[redacted-database-url]')
    return json({ error: message }, 400, origin)
  } finally {
    if (sql) await sql.end({ timeout: 2 })
  }
})
