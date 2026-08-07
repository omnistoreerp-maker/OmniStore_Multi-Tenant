const fs = require('fs');
const files = fs.readFileSync('E:/Projects/ESO/zip-file-list-clean.txt', 'utf-8').split('\n').filter(f => {
  const line = f.trim();
  return line && 
    line.indexOf('create-zip') < 0 && 
    line.indexOf('zip-file-list') < 0 && 
    line.indexOf('DEPLOY_MANIFEST') < 0 && 
    line.indexOf('build-v6') < 0 && 
    line.indexOf('fix-html') < 0 && 
    line.indexOf('prep-files') < 0 &&
    line.indexOf('v5-replace') < 0;
});
console.log('Files:', files.length);
fs.writeFileSync('E:/Projects/ESO/zip-file-list-v6.txt', files.join('\n'), 'utf-8');

// Create ZIP
const path = require('path');
const zlib = require('zlib');

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

const count = createZip('E:/Projects/ESO/Digitronics_V6_Enterprise_2026-07-08.zip', files);
console.log('ZIP created with', count, 'files');
console.log('Size:', fs.statSync('E:/Projects/ESO/Digitronics_V6_Enterprise_2026-07-08.zip').size, 'bytes');
