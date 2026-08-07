const fs = require('fs');
const c = fs.readFileSync('E:/Projects/ESO/sw.js', 'utf-8');
console.log('index.html in cache:', c.includes("'./index.html'"));
console.log('Fallback to index.html:', c.includes("caches.match('./index.html')"));
console.log('Version clean:', c.includes("omnistore-erp-v44-dashboard-v6"));
console.log('DigiTronics_v5 still cached:', c.includes("'./DigiTronics_v5.html'"));

// Also verify index.html matches DigiTronics
const a = fs.readFileSync('E:/Projects/ESO/DigiTronics_v5.html', 'utf-8');
const b = fs.readFileSync('E:/Projects/ESO/index.html', 'utf-8');
console.log('index.html matches DigiTronics:', a === b);
console.log('DigiTronics has d6-header:', a.includes('d6-header'));
console.log('DigiTronics has demoSafetyBadges:', a.includes('demoSafetyBadges'));
console.log('DigiTronics v5- refs:', (a.match(/\.v5-/g) || []).length);
