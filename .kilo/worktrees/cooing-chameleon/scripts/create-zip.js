const fs = require('fs');
const path = require('path');

// Create a clean ZIP for Vercel manual upload
// Exclude: backups, old reports, node_modules, .git, temp files

const sourceDir = 'E:/Projects/ESO';
const outputZip = 'E:/Projects/ESO/Digitronics_V5_Dashboard_V5_2026-07-08.zip';

const excludePatterns = [
  /\.git/,
  /node_modules/,
  /backups/,
  /\.backup-/,
  /\.pre-/,
  /\.rollback-/,
  /PHASE\d+_/,
  /REPORT_\d{8}/,
  /_REPORT_\d{8}/,
  /_GUIDE_\d{8}/,
  /_CHECKLIST_\d{8}/,
  /_SCENARIOS_\d{8}/,
  /_TEMPLATE_\d{8}/,
  /_PLAN_\d{8}/,
  /_ROLLBACK_\d{8}/,
  /_TEST_\d{8}/,
  /_SECURITY_\d{8}/,
  /_MIGRATION_\d{8}/,
  /_INTEGRATION_\d{8}/,
  /_REGRESSION_\d{8}/,
  /_RUNTIME_\d{8}/,
  /_DEMO_\d{8}/,
  /_SIGNOFF_\d{8}/,
  /_UAT_\d{8}/,
  /_DEVELOPER_\d{8}/,
  /_KNOWN_\d{8}/,
  /_PRODUCTION_\d{8}/,
  /_RELEASE_\d{8}/,
  /_CUSTOMER_\d{8}/,
  /_COPY_\d{8}/,
  /_CONFIGURATION_\d{8}/,
  /_DATALAYER_\d{8}/,
  /_ISOLATION_\d{8}/,
  /_PROVISIONING_\d{8}/,
  /_LICENSE_\d{8}/,
  /_MARIO_/,
  /_AI_\d{8}/,
  /_GO_LIVE_\d{8}/,
  /_PERFORMANCE_\d{8}/,
  /_RECOVERY_\d{8}/,
  /_AUTOMATION_\d{8}/,
  /_EXECUTION_\d{8}/,
  /SUPABASE_/,
  /ESO_IMPLEMENTATION/,
  /EDGE_FUNCTION/,
  /MULTI_TENANT/,
  /OMNISTORE_COMMERCIAL/,
  /DYNAMIC_BUSINESS/,
  /MODULAR_PLATFORM/,
  /BUSINESS_PROFILE/,
  /CLIENT_/,
  /CUSTOMER_/,
  /\.zip$/,
  /v5-replace\.js$/,
  /\.sql$/,
  /\.md$/,
  /customerRollout/,
  /release/,
  /templates/,
  /database/,
  /supabase/
];

function shouldExclude(filePath) {
  const relativePath = path.relative(sourceDir, filePath);
  for (const pattern of excludePatterns) {
    if (pattern.test(relativePath)) return true;
  }
  return false;
}

// For now, just list what would be included
const includedFiles = [];

function walkDir(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (shouldExclude(fullPath)) continue;
    if (entry.isDirectory()) {
      walkDir(fullPath);
    } else {
      includedFiles.push(path.relative(sourceDir, fullPath));
    }
  }
}

walkDir(sourceDir);

console.log('Files to include in ZIP (' + includedFiles.length + '):');
includedFiles.forEach(f => console.log('  ' + f));

// Write the list to a file for reference
fs.writeFileSync('E:/Projects/ESO/zip-file-list.txt', includedFiles.join('\n'), 'utf-8');
console.log('\nFile list saved to zip-file-list.txt');
