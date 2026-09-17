const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const projectRoot = path.resolve(__dirname, '..', '..', '..');
const schemaRoot = path.join(projectRoot, 'database', 'accounting');
const serviceRoot = path.join(projectRoot, 'services', 'accountingPersistence');
const serviceFiles = [
  'AccountingSchemaValidator.js',
  'PostingPersistenceMapper.js',
  'JournalPersistencePreview.js',
  'AccountingMigrationReadinessChecker.js',
  'AccountingRollbackPlanner.js'
];

const context = vm.createContext({ console, globalThis: {} });
context.window = context.globalThis;
serviceFiles.forEach(file => {
  const code = fs.readFileSync(path.join(serviceRoot, file), 'utf8');
  new vm.Script(code, { filename: file }).runInContext(context);
});

const persistence = context.globalThis.OmniAccountingPersistence;

function readSchemaFiles() {
  return Object.fromEntries(persistence.AccountingSchemaValidator.REQUIRED_FILES.map(file => [
    file,
    fs.readFileSync(path.join(schemaRoot, file), 'utf8')
  ]));
}

function run() {
  const fileMap = readSchemaFiles();
  const allSql = Object.values(fileMap).join('\n');
  assert.strictEqual(persistence.AccountingSchemaValidator.validateFiles(fileMap).length, 0, 'all schema files should exist');
  assert.strictEqual(persistence.AccountingSchemaValidator.validateTables(allSql).length, 0, 'all required tables should exist');
  assert.strictEqual(Object.keys(persistence.AccountingSchemaValidator.validateColumns(allSql)).length, 0, 'all required columns should exist');

  const rollback = persistence.AccountingSchemaValidator.validateRollback(fileMap['rollback_accounting_schema.sql']);
  assert.strictEqual(rollback.missingTables.length, 0, 'rollback should cover all tables');
  assert.strictEqual(rollback.policyKeywordMissing, false, 'rollback should cover policies');

  const rls = persistence.AccountingSchemaValidator.validateRls(fileMap['007_permissions_rls.sql']);
  assert.strictEqual(rls.missingEnable.length, 0, 'RLS enable draft should cover all tables');
  assert.strictEqual(rls.missingPolicy.length, 0, 'RLS policy draft should cover all tables');

  const forbidden = /createClient|supabase\.|fetch\s*\(|localStorage|db\.query|executeSql|INSERT\s+INTO\s+accounting_|UPDATE\s+accounting_|DELETE\s+FROM\s+accounting_/i;
  serviceFiles.forEach(file => {
    const source = fs.readFileSync(path.join(serviceRoot, file), 'utf8');
    assert.strictEqual(forbidden.test(source), false, `${file} must not access live database or execute SQL`);
  });

  const readiness = persistence.AccountingMigrationReadinessChecker.check(fileMap);
  assert.strictEqual(readiness.readyForManualReview, true, 'schema should be ready for manual review');
  assert.strictEqual(readiness.forbiddenRuntime.length, 0, 'no runtime database access tokens');

  const mapped = persistence.JournalPersistencePreview.preview({
    voucherNumber: 'JV-1',
    voucherType: 'JV',
    postingDate: '2026-06-29',
    lines: [
      { account: 'cash_on_hand', debit: 100, credit: 0 },
      { account: 'sales_revenue', debit: 0, credit: 100 }
    ]
  });
  assert.strictEqual(mapped.sqlExecutionPlanned, false, 'preview must not execute SQL');
  assert.strictEqual(mapped.willConnectToDatabase, false, 'preview must not connect to database');
  assert.strictEqual(mapped.mappedRows.lines.length, 2, 'journal line mapping should preserve lines');

  const plan = persistence.AccountingRollbackPlanner.plan();
  assert.strictEqual(plan.mode, 'draft-only');
  assert.ok(plan.files.includes('database/accounting/rollback_accounting_schema.sql'));

  return {
    tests: 13,
    schemaFiles: Object.keys(fileMap).length,
    requiredTables: persistence.AccountingSchemaValidator.REQUIRED_TABLES.length,
    requiredFileCount: persistence.AccountingSchemaValidator.REQUIRED_FILES.length
  };
}

if (require.main === module) {
  console.log(JSON.stringify(run(), null, 2));
}

module.exports = { run };
