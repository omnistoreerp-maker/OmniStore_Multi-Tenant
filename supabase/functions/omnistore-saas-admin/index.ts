import { createClient } from 'npm:@supabase/supabase-js@2'
import postgres from 'npm:postgres@3.4.7'
import { SAAS_ADMIN_VERSION, saasAdminMigration } from './migrations.ts'

type Sql = ReturnType<typeof postgres>

function response(body: unknown, status: number, origin: string) {
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
  const configured = Deno.env.get('SAAS_ADMIN_ALLOWED_ORIGIN') || Deno.env.get('INSTALLER_ALLOWED_ORIGIN') || ''
  const origin = req.headers.get('origin') || ''
  return configured && origin === configured ? origin : ''
}

function secretKey() {
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

async function platformOwner(req: Request) {
  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
  const url = Deno.env.get('SUPABASE_URL') || ''
  const secret = secretKey()
  if (!token || !url || !secret) throw new Error('SAAS_ADMIN_SERVER_CONFIGURATION_MISSING')
  const client = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } })
  const result = await client.auth.getUser(token)
  if (result.error || !result.data.user) throw new Error('AUTHENTICATION_REQUIRED')
  if (result.data.user.app_metadata?.platform_role !== 'erp_owner') throw new Error('ERP_OWNER_PERMISSION_REQUIRED')
  return { id: result.data.user.id, email: result.data.user.email || '', client }
}

function database() {
  const url = Deno.env.get('SUPABASE_DB_URL')
  if (!url) throw new Error('SUPABASE_DB_URL_MISSING')
  return postgres(url, { max: 1, prepare: false, idle_timeout: 10, connect_timeout: 10 })
}

async function initialized(sql: Sql) {
  const rows = await sql<{ exists: boolean }[]>`select to_regclass('omnistore_admin.admin_migrations') is not null as exists`
  return Boolean(rows[0]?.exists)
}

async function initialize(sql: Sql, actorId: string) {
  await sql.begin(async transaction => {
    await transaction`select pg_advisory_xact_lock(hashtext('omnistore_saas_admin_install'))`
    const exists = await transaction<{ exists: boolean }[]>`select to_regclass('omnistore_admin.admin_migrations') is not null as exists`
    if (!exists[0]?.exists) await transaction.unsafe(saasAdminMigration)
    await transaction`
      insert into omnistore_admin.admin_migrations(id, installed_by)
      values (${SAAS_ADMIN_VERSION}, ${actorId})
      on conflict (id) do nothing
    `
    await transaction`
      insert into omnistore_admin.customer_subscriptions(tenant_id, plan_code, status, starts_at, ends_at)
      select tenant.id,
        case coalesce(subscription.plan, 'free')
          when 'free' then 'trial' when 'basic' then 'monthly' when 'pro' then 'yearly'
          when 'enterprise' then 'custom' else 'trial'
        end,
        case when tenant.status = 'active' then 'active' else 'suspended' end,
        tenant.created_at,
        case when coalesce(subscription.plan, 'free') = 'free' then tenant.created_at + interval '14 days' else null end
      from omnistore.tenants tenant
      left join omnistore.subscriptions subscription on subscription.tenant_id = tenant.id
      on conflict (tenant_id) do nothing
    `
    await transaction`
      insert into omnistore_admin.customer_metrics(tenant_id, storage_bytes)
      select tenant.id, coalesce(usage.bytes_used, 0)
      from omnistore.tenants tenant
      left join omnistore.tenant_storage_usage usage on usage.tenant_id = tenant.id
      on conflict (tenant_id) do nothing
    `
  })
  return { initialized: true, version: SAAS_ADMIN_VERSION }
}

async function audit(sql: Sql, actorId: string, action: string, tenantId?: string, licenseId?: string, details: unknown = {}) {
  await sql`
    insert into omnistore_admin.license_audit(tenant_id, license_id, action, actor_id, details)
    values (${tenantId || null}, ${licenseId || null}, ${action}, ${actorId}, ${JSON.stringify(details)}::jsonb)
  `
}

function addMonths(value: Date, months: number | null) {
  if (months == null) return null
  const result = new Date(value)
  result.setUTCMonth(result.getUTCMonth() + months)
  return result
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest)).map(byte => byte.toString(16).padStart(2, '0')).join('')
}

function licenseKey() {
  const raw = crypto.randomUUID().replace(/-/g, '').toUpperCase()
  return `OMNI-${raw.slice(0, 6)}-${raw.slice(6, 12)}-${raw.slice(12, 18)}-${raw.slice(18, 24)}`
}

async function plans(sql: Sql) {
  return sql`select * from omnistore_admin.plan_catalog order by array_position(array['trial','monthly','quarterly','yearly','lifetime','custom'], code)`
}

async function updatePlan(sql: Sql, actorId: string, planCode: string, input: Record<string, unknown>) {
  const allowed = ['trial', 'monthly', 'quarterly', 'yearly', 'lifetime', 'custom']
  if (!allowed.includes(planCode)) throw new Error('INVALID_PLAN_CODE')
  const limitKeys = ['users', 'branches', 'warehouses', 'posDevices', 'products', 'customers', 'suppliers', 'invoices', 'storageBytes']
  const limits = Object.fromEntries(limitKeys.map((key) => {
    const value = Number((input.limits as Record<string, unknown> | undefined)?.[key])
    if (!Number.isFinite(value) || value < 0) throw new Error(`INVALID_PLAN_LIMIT:${key}`)
    return [key, value]
  }))
  const price = Number(input.price)
  if (!Number.isFinite(price) || price < 0) throw new Error('INVALID_PLAN_PRICE')
  const currency = String(input.currency || '').trim().toUpperCase()
  if (!/^[A-Z]{3}$/.test(currency)) throw new Error('INVALID_PLAN_CURRENCY')
  const rows = await sql`
    update omnistore_admin.plan_catalog
    set limits = ${sql.json(limits)}, price = ${price}, currency = ${currency}, updated_at = now()
    where code = ${planCode}
    returning *
  `
  await audit(sql, actorId, 'update_plan', undefined, undefined, { entity: 'plan', planCode, limits, price, currency })
  return rows[0]
}

async function customerRows(sql: Sql) {
  return sql`
    select tenant.id as "tenantId", tenant.name as "businessName", tenant.status as "customerStatus",
      workspace.id as "workspaceId", workspace.status as "workspaceStatus",
      workspace.database_version as "databaseVersion", workspace.migration_version as "migrationVersion",
      workspace.login_url as "loginUrl", subscription.plan_code as "currentPlan",
      subscription.status as "subscriptionStatus", subscription.starts_at as "subscriptionStartsAt",
      subscription.ends_at as "subscriptionEndsAt", metrics.last_login_at as "lastLogin",
      coalesce(metrics.storage_bytes, usage.bytes_used, 0) as "storageUsage",
      metrics.users_count as "users", metrics.branches_count as "branches",
      metrics.warehouses_count as "warehouses", metrics.pos_devices_count as "posDevices",
      metrics.products_count as "products", metrics.customers_count as "customers",
      metrics.suppliers_count as "suppliers", metrics.invoices_count as "invoices",
      plan.limits as "planLimits", plan.price as "planPrice", plan.currency as "planCurrency"
    from omnistore.tenants tenant
    left join omnistore.workspaces workspace on workspace.tenant_id = tenant.id
    left join omnistore_admin.customer_subscriptions subscription on subscription.tenant_id = tenant.id
    left join omnistore_admin.plan_catalog plan on plan.code = subscription.plan_code
    left join omnistore_admin.customer_metrics metrics on metrics.tenant_id = tenant.id
    left join omnistore.tenant_storage_usage usage on usage.tenant_id = tenant.id
    order by tenant.created_at desc
    limit 1000
  `
}

async function ownerAuthDetails(sql: Sql, client: any, tenantId: string) {
  const rows = await sql`select user_id from omnistore.user_profiles where tenant_id = ${tenantId} and role_code = 'owner' limit 1`
  if (!rows.length) return { ownerUserId: null, ownerEmail: null, lastLogin: null }
  const result = await client.auth.admin.getUserById(rows[0].user_id)
  if (result.error || !result.data.user) return { ownerUserId: rows[0].user_id, ownerEmail: null, lastLogin: null }
  return { ownerUserId: result.data.user.id, ownerEmail: result.data.user.email || null, lastLogin: result.data.user.last_sign_in_at || null }
}

async function refreshMetrics(sql: Sql, client: any, tenantId: string) {
  const auth = await ownerAuthDetails(sql, client, tenantId)
  const counts = await sql`
    select
      (select count(*)::int from omnistore.user_profiles where tenant_id = ${tenantId}) as users,
      (select count(*)::int from omnistore.branches where tenant_id = ${tenantId}) as branches,
      (select count(*)::int from omnistore.warehouses where tenant_id = ${tenantId}) as warehouses,
      (select count(*)::int from omnistore.products where tenant_id = ${tenantId}) as products,
      (select count(*)::int from omnistore.customers where tenant_id = ${tenantId}) as customers,
      (select count(*)::int from omnistore.suppliers where tenant_id = ${tenantId}) as suppliers,
      ((select count(*) from omnistore.sales_invoices where tenant_id = ${tenantId}) +
       (select count(*) from omnistore.purchase_invoices where tenant_id = ${tenantId}))::int as invoices,
      (select count(distinct branch_id)::int from omnistore.pos_transactions where tenant_id = ${tenantId}) as pos_devices,
      (select coalesce(bytes_used, 0)::bigint from omnistore.tenant_storage_usage where tenant_id = ${tenantId}) as storage_bytes
  `
  const value = counts[0]
  await sql`
    insert into omnistore_admin.customer_metrics(
      tenant_id, last_login_at, storage_bytes, users_count, branches_count, warehouses_count,
      pos_devices_count, products_count, customers_count, suppliers_count, invoices_count, measured_at
    ) values (
      ${tenantId}, ${auth.lastLogin}, ${value.storage_bytes || 0}, ${value.users || 0}, ${value.branches || 0},
      ${value.warehouses || 0}, ${value.pos_devices || 0}, ${value.products || 0}, ${value.customers || 0},
      ${value.suppliers || 0}, ${value.invoices || 0}, now()
    )
    on conflict (tenant_id) do update set
      last_login_at = excluded.last_login_at, storage_bytes = excluded.storage_bytes,
      users_count = excluded.users_count, branches_count = excluded.branches_count,
      warehouses_count = excluded.warehouses_count, pos_devices_count = excluded.pos_devices_count,
      products_count = excluded.products_count, customers_count = excluded.customers_count,
      suppliers_count = excluded.suppliers_count, invoices_count = excluded.invoices_count, measured_at = now()
  `
  return { ...auth, ...value }
}

async function customerDetails(sql: Sql, client: any, tenantId: string) {
  await refreshMetrics(sql, client, tenantId)
  const rows = await customerRows(sql)
  const customer = rows.find(row => row.tenantId === tenantId)
  if (!customer) throw new Error('CUSTOMER_NOT_FOUND')
  const licenses = await sql`
    select id, key_prefix, plan_code, status,
      case when status = 'active' and expires_at is not null and expires_at < now() then 'expired' else status end as effective_status,
      starts_at, expires_at, renewed_at, revoked_at, last_validated_at, created_at
    from omnistore_admin.licenses where tenant_id = ${tenantId} order by created_at desc
  `
  return { ...customer, licenses }
}

async function setCustomerStatus(sql: Sql, client: any, actorId: string, tenantId: string, status: 'active' | 'suspended', action: string) {
  const oldRows = await sql`select status from omnistore.tenants where id = ${tenantId}`
  if (oldRows.length !== 1) throw new Error('CUSTOMER_NOT_FOUND')
  const users = await sql`select user_id from omnistore.user_profiles where tenant_id = ${tenantId}`
  await sql.begin(async transaction => {
    await transaction`update omnistore.tenants set status = ${status}, updated_at = now() where id = ${tenantId}`
    await transaction`update omnistore.workspaces set status = ${status}, updated_at = now() where tenant_id = ${tenantId}`
    await transaction`
      update omnistore_admin.customer_subscriptions
      set status = ${status}, updated_at = now()
      where tenant_id = ${tenantId}
    `
    await transaction`
      insert into omnistore_admin.subscription_history(tenant_id, action, old_status, new_status, actor_id)
      values (${tenantId}, ${action}, ${oldRows[0].status}, ${status}, ${actorId})
    `
  })
  const authWarnings: string[] = []
  for (const user of users) {
    const result = await client.auth.admin.updateUserById(user.user_id, { ban_duration: status === 'suspended' ? '876000h' : 'none' })
    if (result.error) authWarnings.push(String(result.error.message || result.error))
  }
  return { tenantId, status, usersUpdated: users.length - authWarnings.length, authWarnings }
}

async function changePlan(sql: Sql, actorId: string, tenantId: string, planCode: string) {
  const planRows = await sql`select * from omnistore_admin.plan_catalog where code = ${planCode} and active`
  if (!planRows.length) throw new Error('PLAN_NOT_FOUND')
  const oldRows = await sql`select plan_code, status from omnistore_admin.customer_subscriptions where tenant_id = ${tenantId}`
  const old = oldRows[0] || { plan_code: null, status: null }
  const starts = new Date()
  const ends = planCode === 'trial' ? new Date(starts.getTime() + 14 * 86400000) : addMonths(starts, planRows[0].billing_months)
  await sql.begin(async transaction => {
    await transaction`
      insert into omnistore_admin.customer_subscriptions(tenant_id, plan_code, status, starts_at, ends_at)
      values (${tenantId}, ${planCode}, ${planCode === 'trial' ? 'trial' : 'active'}, ${starts}, ${ends})
      on conflict (tenant_id) do update set plan_code = excluded.plan_code, status = excluded.status,
        starts_at = excluded.starts_at, ends_at = excluded.ends_at, updated_at = now()
    `
    await transaction`
      insert into omnistore_admin.subscription_history(tenant_id, action, old_plan, new_plan, old_status, new_status, actor_id)
      values (${tenantId}, 'change_plan', ${old.plan_code}, ${planCode}, ${old.status}, ${planCode === 'trial' ? 'trial' : 'active'}, ${actorId})
    `
  })
  return { tenantId, oldPlan: old.plan_code, newPlan: planCode, startsAt: starts, endsAt: ends }
}

async function renewSubscription(sql: Sql, actorId: string, tenantId: string, planCode?: string) {
  const currentRows = await sql`select * from omnistore_admin.customer_subscriptions where tenant_id = ${tenantId}`
  if (!currentRows.length) throw new Error('SUBSCRIPTION_NOT_FOUND')
  const targetPlan = planCode || currentRows[0].plan_code
  const planRows = await sql`select * from omnistore_admin.plan_catalog where code = ${targetPlan} and active`
  if (!planRows.length) throw new Error('PLAN_NOT_FOUND')
  const base = currentRows[0].ends_at && new Date(currentRows[0].ends_at) > new Date() ? new Date(currentRows[0].ends_at) : new Date()
  const ends = targetPlan === 'trial' ? new Date(base.getTime() + 14 * 86400000) : addMonths(base, planRows[0].billing_months)
  await sql.begin(async transaction => {
    await transaction`
      update omnistore_admin.customer_subscriptions
      set plan_code = ${targetPlan}, status = 'active', ends_at = ${ends}, updated_at = now()
      where tenant_id = ${tenantId}
    `
    await transaction`
      insert into omnistore_admin.subscription_history(tenant_id, action, old_plan, new_plan, old_status, new_status, actor_id, details)
      values (${tenantId}, 'renew', ${currentRows[0].plan_code}, ${targetPlan}, ${currentRows[0].status}, 'active', ${actorId}, ${JSON.stringify({ endsAt: ends })}::jsonb)
    `
  })
  return { tenantId, planCode: targetPlan, endsAt: ends, renewed: true }
}

async function generateLicense(sql: Sql, actorId: string, tenantId: string, planCode: string, customExpiresAt?: string) {
  const plans = await sql`select * from omnistore_admin.plan_catalog where code = ${planCode} and active`
  if (!plans.length) throw new Error('PLAN_NOT_FOUND')
  const key = licenseKey()
  const hash = await sha256(key)
  const starts = new Date()
  let expires = planCode === 'trial' ? new Date(starts.getTime() + 14 * 86400000) : addMonths(starts, plans[0].billing_months)
  if (planCode === 'custom' && customExpiresAt) expires = new Date(customExpiresAt)
  const rows = await sql`
    insert into omnistore_admin.licenses(tenant_id, license_hash, key_prefix, plan_code, status, starts_at, expires_at)
    values (${tenantId}, ${hash}, ${key.slice(0, 18)}, ${planCode}, 'active', ${starts}, ${expires})
    returning id, key_prefix, plan_code, status, starts_at, expires_at
  `
  await audit(sql, actorId, 'generate', tenantId, rows[0].id, { planCode, expiresAt: expires })
  return { ...rows[0], tenantId, licenseKey: key, shownOnce: true, hashStoredOnly: true }
}

async function validateLicense(sql: Sql, actorId: string, key: string) {
  const hash = await sha256(key)
  const rows = await sql`
    select id, tenant_id, key_prefix, plan_code, status, starts_at, expires_at, revoked_at
    from omnistore_admin.licenses where license_hash = ${hash}
  `
  if (!rows.length) return { valid: false, status: 'not_found' }
  const license = rows[0]
  const expired = license.expires_at && new Date(license.expires_at) < new Date()
  const effectiveStatus = license.status === 'revoked' ? 'revoked' : expired ? 'expired' : license.status
  await sql`update omnistore_admin.licenses set last_validated_at = now(), status = ${effectiveStatus} where id = ${license.id}`
  await audit(sql, actorId, 'validate', license.tenant_id, license.id, { effectiveStatus })
  return { valid: effectiveStatus === 'active', status: effectiveStatus, licenseId: license.id, tenantId: license.tenant_id, planCode: license.plan_code, expiresAt: license.expires_at }
}

async function renewLicense(sql: Sql, actorId: string, licenseId: string, months?: number) {
  const rows = await sql`
    select license.*, plan.billing_months from omnistore_admin.licenses license
    join omnistore_admin.plan_catalog plan on plan.code = license.plan_code
    where license.id = ${licenseId}
  `
  if (!rows.length) throw new Error('LICENSE_NOT_FOUND')
  const value = rows[0]
  const base = value.expires_at && new Date(value.expires_at) > new Date() ? new Date(value.expires_at) : new Date()
  const duration = months == null ? value.billing_months : months
  const expires = value.plan_code === 'lifetime' ? null : addMonths(base, duration || 1)
  await sql`update omnistore_admin.licenses set status = 'active', expires_at = ${expires}, renewed_at = now(), revoked_at = null where id = ${licenseId}`
  await audit(sql, actorId, 'renew', value.tenant_id, licenseId, { expiresAt: expires })
  return { licenseId, status: 'active', expiresAt: expires }
}

async function revokeLicense(sql: Sql, actorId: string, licenseId: string) {
  const rows = await sql`update omnistore_admin.licenses set status = 'revoked', revoked_at = now() where id = ${licenseId} returning tenant_id`
  if (!rows.length) throw new Error('LICENSE_NOT_FOUND')
  await audit(sql, actorId, 'revoke', rows[0].tenant_id, licenseId)
  return { licenseId, status: 'revoked' }
}

async function billingPreview(sql: Sql, tenantId?: string) {
  const filter = tenantId ? sql`where subscription.tenant_id = ${tenantId}` : sql``
  const subscriptions = await sql`
    select subscription.*, plan.name, plan.price, plan.currency, plan.billing_months
    from omnistore_admin.customer_subscriptions subscription
    join omnistore_admin.plan_catalog plan on plan.code = subscription.plan_code
    ${filter}
  `
  const invoices = subscriptions.map(item => ({
    tenantId: item.tenant_id,
    planCode: item.plan_code,
    amount: item.price,
    currency: item.currency,
    status: 'preview',
    paymentGateway: 'none',
    renewalAt: item.ends_at,
    previewOnly: true
  }))
  const history = tenantId
    ? await sql`select * from omnistore_admin.subscription_history where tenant_id = ${tenantId} order by created_at desc limit 200`
    : await sql`select * from omnistore_admin.subscription_history order by created_at desc limit 500`
  return {
    invoices,
    payments: [],
    renewals: invoices.filter(item => item.renewalAt),
    subscriptionHistory: history,
    revenuePreview: invoices.reduce((sum, item) => sum + Number(item.amount || 0), 0),
    realGatewayConnected: false
  }
}

async function notificationsPreview(sql: Sql) {
  const expiring = await sql`
    select tenant_id, expires_at from omnistore_admin.licenses
    where status = 'active' and expires_at between now() and now() + interval '14 days'
  `
  const usage = await customerRows(sql)
  const storageLimits = usage.filter(item => Number(item.storageUsage || 0) >= Number(item.planLimits?.storageBytes || Infinity) * 0.8)
  const planLimits = usage.filter(item => {
    const limits = item.planLimits || {}
    return ['users','branches','warehouses','posDevices','products','customers','suppliers','invoices']
      .some(key => Number(item[key] || 0) >= Number(limits[key] || Infinity) * 0.9)
  })
  const inactive = usage.filter(item => !item.lastLogin || new Date(item.lastLogin) < new Date(Date.now() - 30 * 86400000))
  const failed = await sql`select tenant_id, details, created_at from omnistore.provision_history where status = 'failed' order by created_at desc limit 100`
  return {
    licenseExpiration: expiring,
    storageLimits,
    planLimits,
    inactiveCustomer: inactive,
    failedProvision: failed,
    notificationsSent: 0,
    previewOnly: true
  }
}

async function dashboard(sql: Sql) {
  const customers = await customerRows(sql)
  const licenses = await sql`
    select count(*)::int as total,
      count(*) filter (where status = 'active' and (expires_at is null or expires_at >= now()))::int as active,
      count(*) filter (where status = 'revoked')::int as revoked,
      count(*) filter (where expires_at between now() and now() + interval '14 days')::int as expiring
    from omnistore_admin.licenses
  `
  const billing = await billingPreview(sql)
  return {
    customers: customers.length,
    activeCustomers: customers.filter(item => item.customerStatus === 'active').length,
    suspendedCustomers: customers.filter(item => item.customerStatus === 'suspended').length,
    licenses: licenses[0],
    revenuePreview: billing.revenuePreview,
    currency: 'USD',
    version: SAAS_ADMIN_VERSION
  }
}

Deno.serve(async req => {
  const origin = allowedOrigin(req)
  if (req.method === 'OPTIONS') return origin ? response({ ok: true }, 200, origin) : response({ error: 'ORIGIN_NOT_ALLOWED' }, 403, '')
  if (!origin) return response({ error: 'ORIGIN_NOT_ALLOWED' }, 403, '')
  if (req.method !== 'POST') return response({ error: 'METHOD_NOT_ALLOWED' }, 405, origin)
  let sql: Sql | null = null
  try {
    const owner = await platformOwner(req)
    const body = await req.json()
    sql = database()
    if (body.action === 'initialize') return response(await initialize(sql, owner.id), 200, origin)
    if (body.action === 'health') return response({ healthy: true, initialized: await initialized(sql), version: SAAS_ADMIN_VERSION, platformOwner: true }, 200, origin)
    if (!(await initialized(sql))) throw new Error('SAAS_ADMIN_SCHEMA_NOT_INITIALIZED')
    if (body.action === 'plans') return response({ plans: await plans(sql) }, 200, origin)
    if (body.action === 'update-plan') return response({ plan: await updatePlan(sql, owner.id, String(body.planCode || ''), body) }, 200, origin)
    if (body.action === 'dashboard') return response({ dashboard: await dashboard(sql) }, 200, origin)
    if (body.action === 'customers') return response({ customers: await customerRows(sql) }, 200, origin)
    if (body.action === 'customer-details') return response({ customer: await customerDetails(sql, owner.client, String(body.tenantId || '')) }, 200, origin)
    if (body.action === 'activate-customer') return response({ result: await setCustomerStatus(sql, owner.client, owner.id, String(body.tenantId || ''), 'active', 'activate') }, 200, origin)
    if (body.action === 'suspend-customer') return response({ result: await setCustomerStatus(sql, owner.client, owner.id, String(body.tenantId || ''), 'suspended', 'suspend') }, 200, origin)
    if (body.action === 'resume-customer') return response({ result: await setCustomerStatus(sql, owner.client, owner.id, String(body.tenantId || ''), 'active', 'resume') }, 200, origin)
    if (body.action === 'change-plan') return response({ result: await changePlan(sql, owner.id, String(body.tenantId || ''), String(body.planCode || '')) }, 200, origin)
    if (body.action === 'renew-subscription') return response({ result: await renewSubscription(sql, owner.id, String(body.tenantId || ''), body.planCode ? String(body.planCode) : undefined) }, 200, origin)
    if (body.action === 'reset-password') {
      const auth = await ownerAuthDetails(sql, owner.client, String(body.tenantId || ''))
      if (!auth.ownerEmail) throw new Error('OWNER_EMAIL_NOT_FOUND')
      const redirectTo = Deno.env.get('APP_PASSWORD_RESET_URL') || `${origin}/?password-recovery=1`
      const result = await owner.client.auth.resetPasswordForEmail(auth.ownerEmail, { redirectTo })
      if (result.error) throw result.error
      await audit(sql, owner.id, 'password_reset_requested', String(body.tenantId || ''), undefined, { ownerUserId: auth.ownerUserId })
      return response({ sent: true, email: auth.ownerEmail.replace(/^(.{2}).*(@.*)$/, '$1***$2') }, 200, origin)
    }
    if (body.action === 'generate-license') return response({ license: await generateLicense(sql, owner.id, String(body.tenantId || ''), String(body.planCode || ''), body.customExpiresAt ? String(body.customExpiresAt) : undefined) }, 200, origin)
    if (body.action === 'validate-license') return response({ validation: await validateLicense(sql, owner.id, String(body.licenseKey || '')) }, 200, origin)
    if (body.action === 'renew-license') return response({ license: await renewLicense(sql, owner.id, String(body.licenseId || ''), body.months == null ? undefined : Number(body.months)) }, 200, origin)
    if (body.action === 'revoke-license') return response({ license: await revokeLicense(sql, owner.id, String(body.licenseId || '')) }, 200, origin)
    if (body.action === 'billing-preview') return response({ billing: await billingPreview(sql, body.tenantId ? String(body.tenantId) : undefined) }, 200, origin)
    if (body.action === 'notifications-preview') return response({ notifications: await notificationsPreview(sql) }, 200, origin)
    if (body.action === 'license-audit') return response({ audit: await sql`select * from omnistore_admin.license_audit order by created_at desc limit 500` }, 200, origin)
    if (body.action === 'subscription-history') return response({ history: await sql`select * from omnistore_admin.subscription_history order by created_at desc limit 500` }, 200, origin)
    if (body.action === 'workspace-report') return response({ report: await customerDetails(sql, owner.client, String(body.tenantId || '')), generatedAt: new Date().toISOString() }, 200, origin)
    return response({ error: 'UNSUPPORTED_ACTION' }, 400, origin)
  } catch (error) {
    const message = String(error instanceof Error ? error.message : error).replace(/postgres(?:ql)?:\/\/[^\s]+/gi, '[redacted-database-url]')
    return response({ error: message }, 400, origin)
  } finally {
    if (sql) await sql.end({ timeout: 2 })
  }
})
