const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// Create ZIP using Node.js built-in modules only
// We'll write a simple ZIP format manually

const sourceDir = 'E:/Projects/ESO';
const outputZip = 'E:/Projects/ESO/Digitronics_V5_Dashboard_V5_2026-07-08.zip';

const files = fs.readFileSync(path.join(sourceDir, 'zip-file-list.txt'), 'utf-8')
  .split('\n')
  .filter(f => f.trim() && !f.includes('create-zip.js') && !f.includes('zip-file-list.txt') && !f.includes('DEPLOY_MANIFEST.txt'));

// Use Node's built-in child_process to call the system's tar/zip if available
const { execSync } = require('child_process');

try {
  // Try to use Windows built-in powershell compress
  const fileListPath = path.join(sourceDir, 'zip-file-list-clean.txt');
  fs.writeFileSync(fileListPath, files.join('\n'), 'utf-8');
  
  // Use Node's stream approach with a simple custom ZIP writer
  // Since we can't use archiver, let's write a minimal JS-only ZIP
  
  console.log('Creating ZIP with ' + files.length + ' files...');
  
  // Write a Node script that uses the built-in stream approach
  const zipScript = `
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const files = fs.readFileSync('E:/Projects/ESO/zip-file-list-clean.txt', 'utf-8').split('\\n').filter(f => f.trim());

// Simple ZIP writer
function createZip(outputPath, fileEntries) {
  const entries = [];
  let centralDirOffset = 0;
  
  for (const relPath of fileEntries) {
    const fullPath = path.join('E:/Projects/ESO', relPath);
    if (!fs.existsSync(fullPath)) continue;
    
    const data = fs.readFileSync(fullPath);
    const compressed = zlib.deflateRawSync(data);
    const useCompressed = compressed.length < data.length;
    const finalData = useCompressed ? compressed : data;
    
    const nameBuffer = Buffer.from(relPath.replace(/\\/g, '/'), 'utf-8');
    const crc = crc32(data);
    
    // Local file header
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0); // signature
    localHeader.writeUInt16LE(20, 4); // version
    localHeader.writeUInt16LE(0, 6); // flags
    localHeader.writeUInt16LE(useCompressed ? 8 : 0, 8); // compression method
    localHeader.writeUInt16LE(0, 10); // time
    localHeader.writeUInt16LE(0, 12); // date
    localHeader.writeUInt32LE(crc, 14); // crc
    localHeader.writeUInt32LE(finalData.length, 18); // compressed size
    localHeader.writeUInt32LE(data.length, 22); // uncompressed size
    localHeader.writeUInt16LE(nameBuffer.length, 26); // name length
    localHeader.writeUInt16LE(0, 28); // extra length
    
    entries.push({
      localHeader,
      nameBuffer,
      finalData,
      crc,
      compressedSize: finalData.length,
      uncompressedSize: data.length,
      compressionMethod: useCompressed ? 8 : 0,
      offset: centralDirOffset
    });
    
    centralDirOffset += localHeader.length + nameBuffer.length + finalData.length;
  }
  
  // Build central directory
  let centralDir = Buffer.alloc(0);
  let centralDirSize = 0;
  
  for (const entry of entries) {
    const cdHeader = Buffer.alloc(46);
    cdHeader.writeUInt32LE(0x02014b50, 0); // signature
    cdHeader.writeUInt16LE(20, 4); // version made by
    cdHeader.writeUInt16LE(20, 6); // version needed
    cdHeader.writeUInt16LE(0, 8); // flags
    cdHeader.writeUInt16LE(entry.compressionMethod, 10); // compression
    cdHeader.writeUInt16LE(0, 12); // time
    cdHeader.writeUInt16LE(0, 14); // date
    cdHeader.writeUInt32LE(entry.crc, 16); // crc
    cdHeader.writeUInt32LE(entry.compressedSize, 20); // compressed
    cdHeader.writeUInt32LE(entry.uncompressedSize, 24); // uncompressed
    cdHeader.writeUInt16LE(entry.nameBuffer.length, 28); // name length
    cdHeader.writeUInt16LE(0, 30); // extra length
    cdHeader.writeUInt16LE(0, 32); // comment length
    cdHeader.writeUInt16LE(0, 34); // disk number
    cdHeader.writeUInt16LE(0, 36); // internal attrs
    cdHeader.writeUInt32LE(0, 38); // external attrs
    cdHeader.writeUInt32LE(entry.offset, 42); // local header offset
    
    centralDir = Buffer.concat([centralDir, cdHeader, entry.nameBuffer]);
    centralDirSize += cdHeader.length + entry.nameBuffer.length;
  }
  
  // End of central directory
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); // signature
  eocd.writeUInt16LE(0, 4); // disk number
  eocd.writeUInt16LE(0, 6); // disk with central dir
  eocd.writeUInt16LE(entries.length, 8); // entries on disk
  eocd.writeUInt16LE(entries.length, 10); // total entries
  eocd.writeUInt32LE(centralDirSize, 12); // central dir size
  eocd.writeUInt32LE(centralDirOffset, 16); // central dir offset
  eocd.writeUInt16LE(0, 20); // comment length
  
  // Write all parts
  const parts = [];
  for (const entry of entries) {
    parts.push(entry.localHeader, entry.nameBuffer, entry.finalData);
  }
  parts.push(centralDir, eocd);
  
  fs.writeFileSync(outputPath, Buffer.concat(parts));
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

createZip('E:/Projects/ESO/Digitronics_V5_Dashboard_V5_2026-07-08.zip', files);
console.log('ZIP created successfully');
console.log('Size: ' + fs.statSync('E:/Projects/ESO/Digitronics_V5_Dashboard_V5_2026-07-08.zip').size + ' bytes');
`;

  fs.writeFileSync('E:/Projects/ESO/create-zip-built-in.js', zipScript);
  execSync('node E:/Projects/ESO/create-zip-built-in.js', { stdio: 'inherit' });
  
} catch (e) {
  console.error('Error creating ZIP:', e.message);
  console.log('Please create the ZIP manually using Windows Explorer or 7-Zip');
  console.log('Files to include are listed in: E:/Projects/ESO/zip-file-list.txt');
}
