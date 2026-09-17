const fs = require('fs');
const path = require('path');

const files = fs.readFileSync('E:/Projects/ESO/zip-file-list-clean.txt', 'utf-8').split('\n').filter(f => f.trim());
const cleanFiles = files.map(f => f.trim()).filter(f => f);
fs.writeFileSync('E:/Projects/ESO/zip-file-list-clean.txt', cleanFiles.join('\n'), 'utf-8');
console.log('Clean file list created with ' + cleanFiles.length + ' files');
