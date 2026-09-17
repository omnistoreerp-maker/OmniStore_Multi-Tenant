const fs = require('fs');
const c = fs.readFileSync('E:/Projects/ESO/DigiTronics_v5.html', 'utf-8');
console.log('=== LOCAL FILE VERIFICATION ===');
console.log('File size:', c.length);
console.log('Has d6-header:', c.includes('d6-header'));
console.log('Has v5-kpi:', c.includes('v5-kpi'));
console.log('Has demoSafetyBadges:', c.includes('demoSafetyBadges'));
console.log('Has page-dashboard:', c.includes('page-dashboard'));
console.log('renderDashboard count:', (c.match(/function renderDashboard/g) || []).length);

const sw = fs.readFileSync('E:/Projects/ESO/sw.js', 'utf-8');
const m = sw.match(/DIGITRONICS_PWA_VERSION.*v[0-9]+/);
console.log('\n=== SW.JS ===');
console.log('SW Version:', m ? m[0] : 'NOT FOUND');
console.log('Has index.html:', sw.includes('index.html'));
console.log('Has DigiTronics_v5.html:', sw.includes('DigiTronics_v5.html'));

const idx = fs.readFileSync('E:/Projects/ESO/index.html', 'utf-8');
console.log('\n=== INDEX.HTML ===');
console.log('DigiTronics size:', c.length);
console.log('index size:', idx.length);
console.log('Files match:', c === idx);

// Check for duplicate dashboard implementations
const dashDivs = (c.match(/id="page-dashboard"/g) || []).length;
console.log('\n=== DUPLICATION CHECK ===');
console.log('page-dashboard divs:', dashDivs);
console.log('d6- classes count:', (c.match(/class="d6-/g) || []).length);
console.log('v5- classes count:', (c.match(/class="v5-/g) || []).length);
console.log('v5- in CSS:', (c.match(/\.v5-/g) || []).length);
