const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const sourceDir = 'E:/Projects/ESO';
const outputZip = 'E:/Projects/ESO/Digitronics_V6_Enterprise_CLEAN_2026-07-08.zip';

const excludePatterns = [
  /\.git/, /node_modules/, /backups/, /\.backup-/, /\.pre-/, /\.rollback-/,
  /PHASE\d+_/, /REPORT_\d{8}/, /_REPORT_\d{8}/, /_GUIDE_\d{8}/, /_CHECKLIST_\d{8}/,
  /_SCENARIOS_\d{8}/, /_TEMPLATE_\d{8}/, /_PLAN_\d{8}/, /_ROLLBACK_\d{8}/,
  /_TEST_\d{8}/, /_SECURITY_\d{8}/, /_MIGRATION_\d{8}/, /_INTEGRATION_\d{8}/,
  /_REGRESSION_\d{8}/, /_RUNTIME_\d{8}/, /_DEMO_\d{8}/, /_SIGNOFF_\d{8}/,
  /_UAT_\d{8}/, /_DEVELOPER_\d{8}/, /_KNOWN_\d{8}/, /_PRODUCTION_\d{8}/,
  /_RELEASE_\d{8}/, /_CUSTOMER_\d{8}/, /_COPY_\d{8}/, /_CONFIGURATION_\d{8}/,
  /_DATALAYER_\d{8}/, /_ISOLATION_\d{8}/, /_PROVISIONING_\d{8}/, /_LICENSE_\d{8}/,
  /_MARIO_/, /_AI_\d{8}/, /_GO_LIVE_\d{8}/, /_PERFORMANCE_\d{8}/, /_RECOVERY_\d{8}/,
  /_AUTOMATION_\d{8}/, /_EXECUTION_\d{8}/, /SUPABASE_/, /ESO_IMPLEMENTATION/,
  /EDGE_FUNCTION/, /MULTI_TENANT/, /OMNISTORE_COMMERCIAL/, /DYNAMIC_BUSINESS/,
  /MODULAR_PLATFORM/, /BUSINESS_PROFILE/, /CLIENT_/, /CUSTOMER_/,
  /\.zip$/, /\.sql$/, /\.md$/, /customerRollout/, /release/, /templates/,
  /database/, /supabase/, /create-zip/, /build-v6/, /fix-html/, /prep-files/,
  /v5-replace/, /verify-/, /check-white/, /deep-audit/, /zip-file-list/,
  /DEPLOY_MANIFEST/, /DASHBOARD_V5/
];

function shouldExclude(filePath) {
  const relativePath = path.relative(sourceDir, filePath);
  for (const pattern of excludePatterns) {
    if (pattern.test(relativePath)) return true;
  }
  return false;
}

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
console.log('Files to include:', includedFiles.length);

function createZip(outputPath, fileEntries) {
  const entries = [];
  let centralDirOffset = 0;
  
  for (const relPath of fileEntries) {
    const fullPath = path.join(sourceDir, relPath);
    if (!fs.existsSync(fullPath)) continue;
    
    const data = fs.readFileSync(fullPath);
    const compressed = zlib.deflateRawSync(data);
    const useCompressed = compressed.length < data.length;
    const finalData = useCompressed ? compressed : data;
    
    const nameBuffer = Buffer.from(relPath.replace(/\\/g, '/'), 'utf-8');
    const crc = crc32(data);
    
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0, 6);
    localHeader.writeUInt16LE(useCompressed ? 8 : 0, 8);
    localHeader.writeUInt16LE(0, 10);
    localHeader.writeUInt16LE(0, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(finalData.length, 18);
    localHeader.writeUInt32LE(data.length, 22);
    localHeader.writeUInt16LE(nameBuffer.length, 26);
    localHeader.writeUInt16LE(0, 28);
    
    entries.push({
      localHeader, nameBuffer, finalData, crc,
      compressedSize: finalData.length, uncompressedSize: data.length,
      compressionMethod: useCompressed ? 8 : 0, offset: centralDirOffset
    });
    
    centralDirOffset += localHeader.length + nameBuffer.length + finalData.length;
  }
  
  let centralDir = Buffer.alloc(0);
  let centralDirSize = 0;
  
  for (const entry of entries) {
    const cdHeader = Buffer.alloc(46);
    cdHeader.writeUInt32LE(0x02014b50, 0);
    cdHeader.writeUInt16LE(20, 4);
    cdHeader.writeUInt16LE(20, 6);
    cdHeader.writeUInt16LE(0, 8);
    cdHeader.writeUInt16LE(entry.compressionMethod, 10);
    cdHeader.writeUInt16LE(0, 12);
    cdHeader.writeUInt16LE(0, 14);
    cdHeader.writeUInt32LE(entry.crc, 16);
    cdHeader.writeUInt32LE(entry.compressedSize, 20);
    cdHeader.writeUInt32LE(entry.uncompressedSize, 24);
    cdHeader.writeUInt16LE(entry.nameBuffer.length, 28);
    cdHeader.writeUInt16LE(0, 30);
    cdHeader.writeUInt16LE(0, 32);
    cdHeader.writeUInt16LE(0, 34);
    cdHeader.writeUInt16LE(0, 36);
    cdHeader.writeUInt32LE(0, 38);
    cdHeader.writeUInt32LE(entry.offset, 42);
    
    centralDir = Buffer.concat([centralDir, cdHeader, entry.nameBuffer]);
    centralDirSize += cdHeader.length + entry.nameBuffer.length;
  }
  
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralDirSize, 12);
  eocd.writeUInt32LE(centralDirOffset, 16);
  eocd.writeUInt16LE(0, 20);
  
  const parts = [];
  for (const entry of entries) {
    parts.push(entry.localHeader, entry.nameBuffer, entry.finalData);
  }
  parts.push(centralDir, eocd);
  
  fs.writeFileSync(outputPath, Buffer.concat(parts));
  return entries.length;
}

function crc32(buf) {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) {
      c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[i] = c;
  }
  let crc = 0 ^ (-1);
  for (let i = 0; i < buf.length; i++) {
    crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xFF];
  }
  return (crc ^ (-1)) >>> 0;
}

const count = createZip(outputZip, includedFiles);
console.log('ZIP created:', outputZip);
console.log('Files:', count);
console.log('Size:', fs.statSync(outputZip).size, 'bytes');
