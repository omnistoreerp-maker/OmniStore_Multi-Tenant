import { createClient } from 'npm:@supabase/supabase-js@2'
import postgres from 'npm:postgres@3.4.7'
import { CONTROL_VERSION, controlPlaneMigration } from './migration.ts'

type Sql = ReturnType<typeof postgres>
const OPERATIONS = new Set([
  'databaseInstallation','customerProvisioning','workspaceActivation','backup','restore',
  'deployment','licenseActivation','supabaseSchemaInstallation','edgeFunctionDeployment','storageBucketCreation'
])

function json(body: unknown, status: number, origin: string) {
  return new Response(JSON.stringify(body), { status, headers: {
    'Content-Type': 'application/json', 'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  }})
}

function allowedOrigin(req: Request) {
  const expected = Deno.env.get('PRODUCTION_EXECUTION_ALLOWED_ORIGIN') || ''
  const origin = req.headers.get('origin') || ''
  return expected && origin === expected ? origin : ''
}

function serverSecret() {
  const legacy = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (legacy) return legacy
  const raw = Deno.env.get('SUPABASE_SECRET_KEYS') || ''
  try { const parsed = JSON.parse(raw); return parsed.default || Object.values(parsed)[0] || '' } catch { return '' }
}

async function owner(req: Request) {
  const url = Deno.env.get('SUPABASE_URL') || ''
  const secret = serverSecret()
  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
  if (!url || !secret || !token) throw new Error('PRODUCTION_SERVER_CONFIGURATION_MISSING')
  const client = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } })
  const result = await client.auth.getUser(token)
  if (result.error || !result.data.user) throw new Error('OWNER_AUTHENTICATION_REQUIRED')
  if (result.data.user.app_metadata?.platform_role !== 'erp_owner') throw new Error('ERP_OWNER_ROLE_REQUIRED')
  return result.data.user
}

function database() {
  const url = Deno.env.get('SUPABASE_DB_URL')
  if (!url) throw new Error('SUPABASE_DB_URL_MISSING')
  return postgres(url, { max: 2, prepare: false, idle_timeout: 10, connect_timeout: 10 })
}

async function schemaReady(sql: Sql) {
  const rows = await sql<{ ready: boolean }[]>`select to_regclass('omnistore_control.production_mode') is not null as ready`
  return Boolean(rows[0]?.ready)
}

async function modeStatus(sql: Sql, userId: string) {
  if (!(await schemaReady(sql))) return { enabled: false, serverEnabled: false, ownerVerified: true, initialized: false }
  const rows = await sql`select enabled, enabled_by, enabled_at from omnistore_control.production_mode where singleton`
  return {
    enabled: Boolean(rows[0]?.enabled),
    serverEnabled: Deno.env.get('PRODUCTION_EXECUTION_ALLOWED') === 'true',
    ownerVerified: true,
    initialized: true,
    enabledBy: rows[0]?.enabled_by || null,
    enabledAt: rows[0]?.enabled_at || null,
    currentOwner: userId
  }
}

async function sha256(value: string) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(bytes)).map(x => x.toString(16).padStart(2, '0')).join('')
}

function endpointFor(operation: string) {
  const raw = Deno.env.get('PRODUCTION_EXECUTOR_ENDPOINTS') || '{}'
  const map = JSON.parse(raw)
  const endpoint = map[operation]
  if (!endpoint || !/^https:\/\//.test(endpoint.url || '')) throw new Error('OPERATION_EXECUTOR_NOT_CONFIGURED')
  return endpoint
}

async function callExecutor(operation: string, action: string, body: Record<string, unknown>) {
  const endpoint = endpointFor(operation)
  const tokenName = String(endpoint.tokenEnv || 'PRODUCTION_EXECUTOR_TOKEN')
  const token = Deno.env.get(tokenName) || ''
  if (!token) throw new Error('OPERATION_EXECUTOR_TOKEN_MISSING')
  const response = await fetch(endpoint.url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, operation, ...body })
  })
  const value = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(value.error || `EXECUTOR_${response.status}`)
  return value
}

async function audit(sql: Sql, input: Record<string, unknown>) {
  const rows = await sql`
    insert into omnistore_control.execution_audit(
      execution_id, actor_id, tenant_id, operation, action, duration_ms, result, errors, rollback_id, details
    ) values (
      ${input.executionId || null}, ${input.actorId}, ${input.tenantId || null}, ${input.operation},
      ${input.action}, ${input.durationMs || null}, ${input.result}, ${JSON.stringify(input.errors || [])}::jsonb,
      ${input.rollbackId || null}, ${JSON.stringify(input.details || {})}::jsonb
    ) returning id
  `
  return rows[0].id
}

async function execute(sql: Sql, userId: string, body: Record<string, unknown>) {
  const operation = String(body.operation || '')
  const requestId = String(body.requestId || '')
  const tenantId = body.tenantId ? String(body.tenantId) : null
  if (!OPERATIONS.has(operation)) throw new Error('UNSUPPORTED_OPERATION')
  if (!/^[0-9a-f-]{36}$/i.test(requestId)) throw new Error('INVALID_REQUEST_ID')
  const mode = await modeStatus(sql, userId)
  if (!mode.serverEnabled || !mode.enabled) throw new Error('PRODUCTION_MODE_DISABLED')
  const expected = `EXECUTE:${operation}:${tenantId || 'platform'}:${requestId}`
  if (String(body.confirmation || '') !== expected) throw new Error('EXECUTION_CONFIRMATION_MISMATCH')
  const existing = await sql`select * from omnistore_control.execution_requests where id = ${requestId}`
  if (existing.length) return { ...existing[0].result, idempotent: true }
  const started = Date.now()
  const confirmationHash = await sha256(expected)
  await sql`
    insert into omnistore_control.execution_requests(id, operation, tenant_id, requested_by, payload, confirmation_hash, status, started_at, attempts)
    values (${requestId}, ${operation}, ${tenantId}, ${userId}, ${JSON.stringify(body.payload || {})}::jsonb, ${confirmationHash}, 'preparing', now(), 1)
  `
  let rollbackId: string | null = null
  try {
    const prepared = await callExecutor(operation, 'prepare', { requestId, tenantId, payload: body.payload || {} })
    const rollbackRows = await sql`
      insert into omnistore_control.rollback_points(execution_id, operation, tenant_id, snapshot, created_by)
      values (${requestId}, ${operation}, ${tenantId}, ${JSON.stringify(prepared.rollbackSnapshot || {})}::jsonb, ${userId})
      returning id
    `
    rollbackId = rollbackRows[0].id
    await sql`update omnistore_control.execution_requests set status = 'executing', updated_at = now() where id = ${requestId}`
    const result = await callExecutor(operation, 'execute', { requestId, tenantId, payload: body.payload || {}, rollbackId })
    await sql`update omnistore_control.execution_requests set status = 'verifying', result = ${JSON.stringify(result)}::jsonb, updated_at = now() where id = ${requestId}`
    const verification = await callExecutor(operation, 'verify', { requestId, tenantId, result })
    const passed = verification.passed === true
    const durationMs = Date.now() - started
    const auditId = await audit(sql, { executionId: requestId, actorId: userId, tenantId, operation, action: 'execute', durationMs, result: passed ? 'verified' : 'verification_failed', rollbackId, details: { verification } })
    const response = { executionId: requestId, operation, tenantId, result, verification, auditId, rollbackId, rollbackSupported: true, durationMs, transactionSafe: Boolean(result.transactionSafe), retrySupported: true }
    await sql`
      update omnistore_control.execution_requests
      set status = ${passed ? 'verified' : 'failed'}, result = ${JSON.stringify(response)}::jsonb,
        duration_ms = ${durationMs}, completed_at = now(), updated_at = now()
      where id = ${requestId}
    `
    return response
  } catch (error) {
    const durationMs = Date.now() - started
    const message = String(error instanceof Error ? error.message : error)
    const status = rollbackId ? 'partial_failure' : 'failed'
    await sql`update omnistore_control.execution_requests set status = ${status}, errors = ${JSON.stringify([message])}::jsonb, duration_ms = ${durationMs}, completed_at = now(), updated_at = now() where id = ${requestId}`
    await audit(sql, { executionId: requestId, actorId: userId, tenantId, operation, action: 'execute', durationMs, result: status, errors: [message], rollbackId })
    throw error
  }
}

async function rollback(sql: Sql, userId: string, body: Record<string, unknown>) {
  const rollbackId = String(body.rollbackId || '')
  if (String(body.confirmation || '') !== `ROLLBACK:${rollbackId}`) throw new Error('ROLLBACK_CONFIRMATION_MISMATCH')
  const rows = await sql`
    select point.*, request.requested_by
    from omnistore_control.rollback_points point
    join omnistore_control.execution_requests request on request.id = point.execution_id
    where point.id = ${rollbackId} and point.status = 'available'
  `
  if (!rows.length) throw new Error('ROLLBACK_POINT_NOT_AVAILABLE')
  const value = rows[0]
  const mode = await modeStatus(sql, userId)
  if (!mode.serverEnabled || !mode.enabled) throw new Error('PRODUCTION_MODE_DISABLED')
  await sql`update omnistore_control.execution_requests set status = 'rolling_back', updated_at = now() where id = ${value.execution_id}`
  const result = await callExecutor(value.operation, 'rollback', { executionId: value.execution_id, tenantId: value.tenant_id, rollbackId, snapshot: value.snapshot })
  const verification = await callExecutor(value.operation, 'verifyRollback', { executionId: value.execution_id, tenantId: value.tenant_id, result })
  if (verification.passed !== true) throw new Error('ROLLBACK_VERIFICATION_FAILED')
  await sql.begin(async tx => {
    await tx`update omnistore_control.rollback_points set status = 'used', used_at = now() where id = ${rollbackId}`
    await tx`update omnistore_control.execution_requests set status = 'rolled_back', updated_at = now() where id = ${value.execution_id}`
  })
  const auditId = await audit(sql, { executionId: value.execution_id, actorId: userId, tenantId: value.tenant_id, operation: value.operation, action: 'rollback', result: 'verified', rollbackId, details: { verification } })
  return { executionId: value.execution_id, rollbackId, result, verification, auditId }
}

Deno.serve(async req => {
  const origin = allowedOrigin(req)
  if (req.method === 'OPTIONS') return origin ? json({ ok: true }, 200, origin) : json({ error: 'ORIGIN_NOT_ALLOWED' }, 403, '')
  if (!origin) return json({ error: 'ORIGIN_NOT_ALLOWED' }, 403, '')
  if (req.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED' }, 405, origin)
  let sql: Sql | null = null
  try {
    const user = await owner(req)
    const body = await req.json()
    sql = database()
    if (body.action === 'status') return json({ mode: await modeStatus(sql, user.id), version: CONTROL_VERSION }, 200, origin)
    if (body.action === 'initialize-control-plane') {
      if (String(body.confirmation || '') !== 'INITIALIZE_PRODUCTION_CONTROL') throw new Error('INITIALIZATION_CONFIRMATION_MISMATCH')
      await sql.begin(async tx => { await tx`select pg_advisory_xact_lock(hashtext('omnistore_control_install'))`; await tx.unsafe(controlPlaneMigration); await tx`insert into omnistore_control.control_migrations(id, installed_by) values (${CONTROL_VERSION}, ${user.id}) on conflict (id) do nothing` })
      return json({ initialized: true, mode: await modeStatus(sql, user.id) }, 200, origin)
    }
    if (!(await schemaReady(sql))) throw new Error('PRODUCTION_CONTROL_NOT_INITIALIZED')
    if (body.action === 'enable-mode' || body.action === 'disable-mode') {
      const enabled = body.action === 'enable-mode'
      if (enabled && Deno.env.get('PRODUCTION_EXECUTION_ALLOWED') !== 'true') throw new Error('SERVER_EXECUTION_DISABLED')
      const expected = `${enabled ? 'ENABLE' : 'DISABLE'}_PRODUCTION:${user.id}`
      if (String(body.confirmation || '') !== expected) throw new Error('MODE_CONFIRMATION_MISMATCH')
      await sql`
        update omnistore_control.production_mode set enabled = ${enabled},
          enabled_by = ${enabled ? user.id : null}, enabled_at = ${enabled ? new Date() : null},
          disabled_by = ${enabled ? null : user.id}, disabled_at = ${enabled ? null : new Date()}, updated_at = now()
        where singleton
      `
      await audit(sql, { actorId: user.id, operation: 'productionMode', action: enabled ? 'enable' : 'disable', result: 'success' })
      return json({ mode: await modeStatus(sql, user.id) }, 200, origin)
    }
    if (body.action === 'execute') return json(await execute(sql, user.id, body), 200, origin)
    if (body.action === 'rollback') return json(await rollback(sql, user.id, body), 200, origin)
    if (body.action === 'history') return json({ history: await sql`select * from omnistore_control.execution_audit order by created_at desc limit 500` }, 200, origin)
    if (body.action === 'queue') return json({ queue: await sql`select * from omnistore_control.execution_requests where status in ('pending','preparing','executing','verifying','partial_failure') order by created_at` }, 200, origin)
    return json({ error: 'UNSUPPORTED_ACTION' }, 400, origin)
  } catch (error) {
    return json({ error: String(error instanceof Error ? error.message : error) }, 400, origin)
  } finally {
    if (sql) await sql.end({ timeout: 1 })
  }
})
