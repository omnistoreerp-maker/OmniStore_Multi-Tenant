$files = @(
  'backend/controllers/apiKey.controller.js',
  'backend/controllers/employees.controller.js',
  'backend/controllers/webhook.controller.js',
  'backend/middleware/authorize.js',
  'backend/permissions/registry.js',
  'backend/routes/apiKey.routes.js',
  'backend/routes/employees.routes.js',
  'backend/routes/webhook.routes.js',
  'backend/server.js',
  'backend/services/apiKey.service.js',
  'backend/services/audit.service.js',
  'backend/services/employees.service.js',
  'backend/services/purchase.service.js',
  'backend/services/sales.service.js',
  'backend/services/suppliers.service.js',
  'backend/services/treasury.service.js',
  'backend/services/voucher.service.js',
  'backend/services/webhook.service.js',
  'backend/tests/apiKey.integration.test.js',
  'backend/tests/apiKey.test.js',
  'backend/tests/fileStore.test.js',
  'backend/tests/helpers/testServer.js',
  'backend/tests/permissionRegistry.test.js',
  'backend/tests/treasuryAsync.test.js',
  'backend/utils/fileStore.js',
  'backend/utils/tokenStore.js',
  'index.html',
  'services/modulePlatform/moduleLoader.js',
  'services/modulePlatform/moduleRegistry.js',
  'services/modulePlatform/navigationBuilder.js',
  'sw.js'
)

foreach ($f in $files) {
  $exists = Test-Path $f
  $inCommit = git show 105067c9a636ec1c483cc5b6ff5bf16000f57eba:$f 2>$null
  $inCommitExists = $LASTEXITCODE -eq 0
  Write-Output "$exists`t$inCommitExists`t$f"
}
