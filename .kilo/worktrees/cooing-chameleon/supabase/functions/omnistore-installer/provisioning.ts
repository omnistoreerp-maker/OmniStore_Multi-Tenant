import { MIGRATION_VERSION } from './migrations.ts'

type Sql = any
type AdminClient = any
type Admin = { id: string; email: string; role: string }

const BUSINESS_TYPES = ['computer_shop','auto_parts','restaurant','supermarket','pharmacy','mobile_shop','clothes','jewelry','hardware','bookstore','agriculture','generic_store']
const PLANS = ['free','basic','pro','enterprise']
const LANGUAGES = ['ar','en']

function requiredText(value: unknown) {
  return String(value || '').trim()
}

function slugify(value: string) {
  return value.toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').replace(/[\s_]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'workspace'
}

function validateProvisionInput(body: Record<string, unknown>) {
  const errors: string[] = []
  const required = ['requestId','businessName','ownerName','email','password','country','timezone','currency','businessType','subscriptionPlan','language']
  for (const field of required) if (!requiredText(body[field])) errors.push(`${field.toUpperCase()}_REQUIRED`)
  if (body.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(body.email))) errors.push('INVALID_EMAIL')
  if (body.password && String(body.password).length < 10) errors.push('PASSWORD_MINIMUM_10')
  if (body.requestId && !/^[0-9a-f-]{36}$/i.test(String(body.requestId))) errors.push('INVALID_REQUEST_ID')
  if (body.businessType && !BUSINESS_TYPES.includes(String(body.businessType))) errors.push('INVALID_BUSINESS_TYPE')
  if (body.subscriptionPlan && !PLANS.includes(String(body.subscriptionPlan))) errors.push('INVALID_SUBSCRIPTION_PLAN')
  if (body.language && !LANGUAGES.includes(String(body.language))) errors.push('INVALID_LANGUAGE')
  if (body.companyLogo) {
    const logo = body.companyLogo as Record<string, unknown>
    if (!/^image\/(png|jpeg|webp|svg\+xml)$/i.test(String(logo.mimeType || ''))) errors.push('INVALID_LOGO_TYPE')
    if (String(logo.base64 || '').length > 2_800_000) errors.push('LOGO_TOO_LARGE')
  }
  return errors
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest)).map(byte => byte.toString(16).padStart(2, '0')).join('')
}

function jsonValue(value: unknown) {
  return JSON.stringify(value)
}

async function ensureLogoBucket(client: AdminClient) {
  const { error } = await client.storage.createBucket('tenant-logos', {
    public: false,
    allowedMimeTypes: ['image/png','image/jpeg','image/webp','image/svg+xml'],
    fileSizeLimit: 2_000_000
  })
  if (error && !/already exists|duplicate/i.test(String(error.message || error))) throw error
}

async function uploadLogo(client: AdminClient, tenantId: string, logo: Record<string, unknown> | null) {
  if (!logo || !logo.base64) return null
  await ensureLogoBucket(client)
  const mimeType = String(logo.mimeType)
  const extension = mimeType === 'image/png' ? 'png' : mimeType === 'image/webp' ? 'webp' : mimeType === 'image/svg+xml' ? 'svg' : 'jpg'
  const bytes = Uint8Array.from(atob(String(logo.base64)), character => character.charCodeAt(0))
  const path = `${tenantId}/company-logo.${extension}`
  const { error } = await client.storage.from('tenant-logos').upload(path, bytes, { contentType: mimeType, upsert: true })
  if (error) throw error
  return path
}

async function removeTenantLogo(client: AdminClient, tenantId: string) {
  const { data, error } = await client.storage.from('tenant-logos').list(tenantId, { limit: 100 })
  if (error) return { removed: false, warning: String(error.message || error) }
  const paths = (data || []).map((item: { name: string }) => `${tenantId}/${item.name}`)
  if (!paths.length) return { removed: true, count: 0 }
  const result = await client.storage.from('tenant-logos').remove(paths)
  return result.error ? { removed: false, warning: String(result.error.message || result.error) } : { removed: true, count: paths.length }
}

export async function provisionCustomer(sql: Sql, adminClient: AdminClient, admin: Admin, body: Record<string, unknown>, origin: string) {
  const errors = validateProvisionInput(body)
  if (errors.length) throw new Error(`PROVISION_VALIDATION:${errors.join(',')}`)

  const requestId = String(body.requestId)
  const existing = await sql`
    select tenant_id, details from omnistore.provision_history
    where request_id = ${requestId} and action = 'provision' and status = 'completed'
    limit 1
  `
  if (existing.length) {
    return {
      idempotent: true,
      tenantId: existing[0].tenant_id,
      workspaceId: existing[0].details?.workspaceId || null,
      loginUrl: existing[0].details?.loginUrl || null,
      apiKey: null,
      apiKeyShownOnce: false,
      message: 'Provisioning was already completed for this request ID.'
    }
  }

  const tenantId = crypto.randomUUID()
  const workspaceId = crypto.randomUUID()
  const apiCredentialId = crypto.randomUUID()
  const businessName = requiredText(body.businessName)
  const workspaceSlug = `${slugify(businessName)}-${tenantId.slice(0, 8)}`
  const appBaseUrl = Deno.env.get('APP_LOGIN_URL') || origin
  const loginUrl = `${appBaseUrl.replace(/\/+$/, '')}/?workspace=${encodeURIComponent(workspaceSlug)}`
  const rawApiKey = `omni_live_${crypto.randomUUID().replace(/-/g, '')}${crypto.randomUUID().replace(/-/g, '')}`
  const apiKeyHash = await sha256(rawApiKey)
  const apiKeyPrefix = rawApiKey.slice(0, 18)
  let ownerUserId = ''
  let logoPath: string | null = null

  try {
    const userResult = await adminClient.auth.admin.createUser({
      email: requiredText(body.email).toLowerCase(),
      password: String(body.password),
      email_confirm: true,
      user_metadata: { display_name: requiredText(body.ownerName) },
      app_metadata: { tenant_id: tenantId, workspace_id: workspaceId, role: 'owner' }
    })
    if (userResult.error || !userResult.data?.user) throw userResult.error || new Error('OWNER_USER_CREATION_FAILED')
    ownerUserId = userResult.data.user.id
    logoPath = await uploadLogo(adminClient, tenantId, body.companyLogo as Record<string, unknown> | null)

    await sql.begin(async (transaction: Sql) => {
      await transaction`select pg_advisory_xact_lock(hashtext(${`omnistore_provision_${tenantId}`}))`
      await transaction`
        insert into omnistore.tenants(id, code, name, status, country, currency, timezone)
        values (${tenantId}, ${workspaceSlug}, ${businessName}, 'provisioning', ${requiredText(body.country)}, ${requiredText(body.currency).toUpperCase()}, ${requiredText(body.timezone)})
      `
      await transaction`
        insert into omnistore.business_profiles(tenant_id, company_name, phone, logo_path)
        values (${tenantId}, ${businessName}, ${requiredText(body.phone) || null}, ${logoPath})
      `
      await transaction`
        insert into omnistore.workspaces(id, tenant_id, slug, status, data_schema, isolation_key, login_url, database_version, migration_version)
        values (${workspaceId}, ${tenantId}, ${workspaceSlug}, 'provisioning', 'omnistore', 'tenant_id', ${loginUrl}, 'postgres', ${MIGRATION_VERSION})
      `
      await transaction`
        insert into omnistore.subscriptions(tenant_id, plan, status, limits)
        values (${tenantId}, ${requiredText(body.subscriptionPlan)}, 'active', ${jsonValue({ users: body.subscriptionPlan === 'enterprise' ? 1000 : 10, branches: body.subscriptionPlan === 'free' ? 1 : 10 })}::jsonb)
      `
      await transaction`
        insert into omnistore.roles(tenant_id, code, name, system_role)
        select ${tenantId}, code, name, true from omnistore.role_templates
      `
      await transaction`
        insert into omnistore.permissions(tenant_id, code, module, description)
        select ${tenantId}, code, module, description from omnistore.permission_templates
      `
      await transaction`
        insert into omnistore.role_permissions(tenant_id, role_id, permission_id)
        select ${tenantId}, role.id, permission.id
        from omnistore.roles role cross join omnistore.permissions permission
        where role.tenant_id = ${tenantId} and permission.tenant_id = ${tenantId} and role.code in ('owner','admin')
      `
      await transaction`
        insert into omnistore.user_profiles(tenant_id, user_id, display_name, role_code)
        values (${tenantId}, ${ownerUserId}, ${requiredText(body.ownerName)}, 'owner')
      `
      await transaction`
        insert into omnistore.branches(tenant_id, code, name)
        values (${tenantId}, 'main', 'Main Branch')
      `
      await transaction`
        insert into omnistore.warehouses(tenant_id, branch_id, code, name)
        select ${tenantId}, id, 'main', 'Main Warehouse' from omnistore.branches where tenant_id = ${tenantId} and code = 'main'
      `
      await transaction`
        insert into omnistore.cashboxes(tenant_id, branch_id, code, name, currency)
        select ${tenantId}, id, 'main', 'Main Cashbox', ${requiredText(body.currency).toUpperCase()}
        from omnistore.branches where tenant_id = ${tenantId} and code = 'main'
      `
      await transaction`insert into omnistore.categories(tenant_id, name) values (${tenantId}, 'General')`
      await transaction`insert into omnistore.taxes(tenant_id, code, name, rate) values (${tenantId}, 'ZERO', 'Zero Tax', 0)`
      await transaction`
        insert into omnistore.chart_of_accounts(tenant_id, account_code, account_name, account_type) values
          (${tenantId}, '1000', 'Cash', 'asset'), (${tenantId}, '1100', 'Bank', 'asset'),
          (${tenantId}, '1200', 'Accounts Receivable', 'asset'), (${tenantId}, '1300', 'Inventory Asset', 'asset'),
          (${tenantId}, '2000', 'Accounts Payable', 'liability'), (${tenantId}, '3000', 'Owner Equity', 'equity'),
          (${tenantId}, '4000', 'Sales Revenue', 'revenue'), (${tenantId}, '5000', 'Cost Of Goods Sold', 'expense'),
          (${tenantId}, '6000', 'Operating Expenses', 'expense')
      `
      await transaction`
        insert into omnistore.pos_settings(tenant_id, settings)
        values (${tenantId}, ${jsonValue({ receiptSize: '80mm', allowNegativeStock: false, postingEnabled: false })}::jsonb)
      `
      await transaction`
        insert into omnistore.accounting_settings(tenant_id, settings)
        values (${tenantId}, ${jsonValue({ postingEnabled: false, inventoryMethod: 'average', currency: requiredText(body.currency).toUpperCase() })}::jsonb)
      `
      await transaction`
        insert into omnistore.printing_settings(tenant_id, settings)
        values (${tenantId}, ${jsonValue({ template: 'standard', showLogo: Boolean(logoPath), receiptSize: '80mm' })}::jsonb)
      `
      await transaction`
        insert into omnistore.system_settings(tenant_id, settings)
        values (${tenantId}, ${jsonValue({ language: body.language, timezone: body.timezone, businessType: body.businessType, country: body.country })}::jsonb)
      `
      await transaction`
        insert into omnistore.report_settings(tenant_id, settings)
        values (${tenantId}, ${jsonValue({ language: body.language, defaultPeriod: 'current_month' })}::jsonb)
      `
      await transaction`insert into omnistore.tenant_storage_usage(tenant_id) values (${tenantId})`
      await transaction`
        insert into omnistore.tenant_api_credentials(id, tenant_id, key_prefix, secret_hash, scopes)
        values (${apiCredentialId}, ${tenantId}, ${apiKeyPrefix}, ${apiKeyHash}, array['workspace:read','workspace:write'])
      `
      const safeDetails = { workspaceId, loginUrl, businessType: body.businessType, subscriptionPlan: body.subscriptionPlan, ownerUserId }
      await transaction`
        insert into omnistore.provision_history(tenant_id, request_id, action, status, actor_id, details)
        values (${tenantId}, ${requestId}, 'provision', 'completed', ${admin.id}, ${jsonValue(safeDetails)}::jsonb)
      `
      await transaction`
        insert into omnistore.workspace_audit(tenant_id, workspace_id, actor_id, event, details)
        values (${tenantId}, ${workspaceId}, ${admin.id}, 'workspace_provisioned', ${jsonValue({ businessName, ownerUserId })}::jsonb)
      `
      await transaction`update omnistore.workspaces set status = 'active', activated_at = now() where id = ${workspaceId} and tenant_id = ${tenantId}`
      await transaction`update omnistore.tenants set status = 'active', updated_at = now() where id = ${tenantId}`
    })
  } catch (error) {
    if (ownerUserId) await adminClient.auth.admin.deleteUser(ownerUserId).catch(() => null)
    if (logoPath) await removeTenantLogo(adminClient, tenantId).catch(() => null)
    throw error
  }

  return {
    idempotent: false,
    tenantId,
    workspaceId,
    workspaceSlug,
    ownerUserId,
    apiCredentialId,
    apiKey: rawApiKey,
    apiKeyShownOnce: true,
    loginUrl,
    status: 'active',
    dataSchema: 'omnistore',
    isolationKey: 'tenant_id',
    databaseVersion: 'postgres',
    migrationVersion: MIGRATION_VERSION,
    setupReport: {
      tenant: true, businessProfile: true, ownerUser: true, workspace: true, migrations: true,
      roles: true, permissions: true, settings: true, warehouse: true, cashbox: true,
      inventoryPosting: false, accountingPosting: false
    }
  }
}

export async function listCustomers(sql: Sql) {
  return sql`
    select tenant.id as "tenantId", tenant.name as "businessName", tenant.status,
      workspace.id as "workspaceId", workspace.slug, workspace.login_url as "loginUrl",
      workspace.database_version as "databaseVersion", workspace.migration_version as "migrationVersion",
      subscription.plan as "subscriptionPlan", subscription.status as "subscriptionStatus",
      usage.bytes_used as "storageBytes", usage.object_count as "storageObjects",
      tenant.created_at as "createdAt"
    from omnistore.tenants tenant
    join omnistore.workspaces workspace on workspace.tenant_id = tenant.id
    left join omnistore.subscriptions subscription on subscription.tenant_id = tenant.id
    left join omnistore.tenant_storage_usage usage on usage.tenant_id = tenant.id
    order by tenant.created_at desc
    limit 500
  `
}

export async function customerDetails(sql: Sql, tenantId: string) {
  const rows = await sql`
    select tenant.*, profile.company_name, profile.phone, profile.logo_path,
      workspace.id as workspace_id, workspace.slug, workspace.status as workspace_status,
      workspace.login_url, workspace.database_version, workspace.migration_version,
      subscription.plan, subscription.status as subscription_status,
      usage.bytes_used, usage.object_count
    from omnistore.tenants tenant
    join omnistore.business_profiles profile on profile.tenant_id = tenant.id
    join omnistore.workspaces workspace on workspace.tenant_id = tenant.id
    left join omnistore.subscriptions subscription on subscription.tenant_id = tenant.id
    left join omnistore.tenant_storage_usage usage on usage.tenant_id = tenant.id
    where tenant.id = ${tenantId}
  `
  if (!rows.length) throw new Error('TENANT_NOT_FOUND')
  return rows[0]
}

export async function workspaceHealth(sql: Sql, tenantId: string) {
  const details = await customerDetails(sql, tenantId)
  const counts = await sql`
    select
      (select count(*)::int from omnistore.user_profiles where tenant_id = ${tenantId}) as users,
      (select count(*)::int from omnistore.roles where tenant_id = ${tenantId}) as roles,
      (select count(*)::int from omnistore.products where tenant_id = ${tenantId}) as products,
      (select count(*)::int from omnistore.warehouses where tenant_id = ${tenantId}) as warehouses,
      (select count(*)::int from omnistore.chart_of_accounts where tenant_id = ${tenantId}) as accounts
  `
  const rls = await sql`
    select
      (select count(*)::int from information_schema.columns where table_schema = 'omnistore' and column_name = 'tenant_id') as tenant_columns,
      (select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'omnistore' and c.relrowsecurity) as rls_tables,
      (select count(*)::int from pg_policies where schemaname = 'omnistore') as policies
  `
  const isolation = rls[0]
  return {
    tenantId,
    status: details.workspace_status,
    healthy: details.workspace_status === 'active' && counts[0]?.users > 0 && counts[0]?.roles >= 5 && counts[0]?.warehouses > 0 && counts[0]?.accounts > 0,
    counts: counts[0],
    isolation: {
      tenantColumns: isolation?.tenant_columns || 0,
      rlsTables: isolation?.rls_tables || 0,
      policies: isolation?.policies || 0,
      crossTenantAccessAllowed: false
    },
    databaseVersion: details.database_version,
    migrationVersion: details.migration_version,
    checkedAt: new Date().toISOString()
  }
}

export async function provisionHistory(sql: Sql, tenantId?: string) {
  return tenantId
    ? sql`select * from omnistore.provision_history where tenant_id = ${tenantId} order by created_at desc limit 200`
    : sql`select * from omnistore.provision_history order by created_at desc limit 200`
}

export async function workspaceAudit(sql: Sql, tenantId?: string) {
  return tenantId
    ? sql`select * from omnistore.workspace_audit where tenant_id = ${tenantId} order by created_at desc limit 200`
    : sql`select * from omnistore.workspace_audit order by created_at desc limit 200`
}

export async function rollbackPreview(sql: Sql, tenantId: string) {
  const details = await customerDetails(sql, tenantId)
  const counts = await sql`
    select
      (select count(*)::int from omnistore.user_profiles where tenant_id = ${tenantId}) as users,
      (select count(*)::int from omnistore.products where tenant_id = ${tenantId}) as products,
      (select count(*)::int from omnistore.inventory_transactions where tenant_id = ${tenantId}) as inventory_transactions,
      (select count(*)::int from omnistore.journal_vouchers where tenant_id = ${tenantId}) as journal_vouchers,
      (select count(*)::int from omnistore.sales_invoices where tenant_id = ${tenantId}) as sales_invoices,
      (select count(*)::int from omnistore.purchase_invoices where tenant_id = ${tenantId}) as purchase_invoices
  `
  return {
    tenantId,
    businessName: details.name,
    workspaceId: details.workspace_id,
    counts: counts[0],
    targetScope: 'single-tenant-only',
    confirmation: `DELETE_CUSTOMER:${tenantId}`,
    otherTenantsAffected: 0,
    deletionExecuted: false
  }
}

export async function deleteCustomer(sql: Sql, adminClient: AdminClient, admin: Admin, tenantId: string, confirmation: string) {
  if (confirmation !== `DELETE_CUSTOMER:${tenantId}`) throw new Error('CUSTOMER_DELETE_CONFIRMATION_MISMATCH')
  const preview = await rollbackPreview(sql, tenantId)
  const userRows = await sql`select user_id from omnistore.user_profiles where tenant_id = ${tenantId}`
  const workspaceRows = await sql`select id from omnistore.workspaces where tenant_id = ${tenantId}`
  const requestId = crypto.randomUUID()
  await sql.begin(async (transaction: Sql) => {
    await transaction`select pg_advisory_xact_lock(hashtext(${`omnistore_delete_${tenantId}`}))`
    await transaction`
      insert into omnistore.provision_history(tenant_id, request_id, action, status, actor_id, details)
      values (${tenantId}, ${requestId}, 'delete', 'completed', ${admin.id}, ${jsonValue({ preview, workspaceId: workspaceRows[0]?.id || null })}::jsonb)
    `
    await transaction`
      insert into omnistore.workspace_audit(tenant_id, workspace_id, actor_id, event, details)
      values (${tenantId}, ${workspaceRows[0]?.id || null}, ${admin.id}, 'workspace_deleted', ${jsonValue({ targetScope: 'single-tenant-only' })}::jsonb)
    `
    const deleted = await transaction`delete from omnistore.tenants where id = ${tenantId} returning id`
    if (deleted.length !== 1) throw new Error('TENANT_DELETE_SCOPE_VIOLATION')
  })
  const authWarnings: string[] = []
  for (const row of userRows) {
    const result = await adminClient.auth.admin.deleteUser(row.user_id)
    if (result.error) authWarnings.push(String(result.error.message || result.error))
  }
  const storage = await removeTenantLogo(adminClient, tenantId)
  return {
    tenantId,
    deleted: true,
    deletedTenantCount: 1,
    otherTenantsAffected: 0,
    authUsersDeleted: userRows.length - authWarnings.length,
    authWarnings,
    storage,
    completedAt: new Date().toISOString()
  }
}
