const fs = require('fs');
const c = fs.readFileSync('E:/Projects/ESO/DigiTronics_v5.html', 'utf-8');

console.log('=== DEEP AUDIT ===');

// 1. Check for duplicate page-dashboard divs
const pageDashMatches = [];
let pos = 0;
while ((pos = c.indexOf('id="page-dashboard"', pos)) !== -1) {
  const start = c.lastIndexOf('<div', pos);
  const context = c.substring(start, pos + 30);
  pageDashMatches.push({pos, context: context.replace(/\n/g, ' ').substring(0, 80)});
  pos++;
}
console.log('page-dashboard occurrences:', pageDashMatches.length);
pageDashMatches.forEach(m => console.log('  at', m.pos, ':', m.context));

// 2. Check for old CSS classes that might conflict
const oldClasses = ['stat-card', 'stat-icon', 'stat-value', 'stat-label', 'dashboard-section', 
  'dashboard-section-title', 'dashboard-chart-wrapper', 'dashboard-alerts-grid', 
  'alert-card', 'alert-card-icon', 'quick-actions-grid', 'quick-action-btn', 
  'quick-action-icon', 'quick-action-label'];
oldClasses.forEach(cls => {
  const count = (c.match(new RegExp('class="[^"]*' + cls + '[^"]*"', 'g')) || []).length;
  if (count > 0) console.log('OLD class "' + cls + '" found:', count, 'times');
});

// 3. Check for demoSafetyBadges in any form
console.log('demoSafetyBadges:', c.includes('demoSafetyBadges'));
console.log('demo-safety-badges:', c.includes('demo-safety-badges'));
console.log('demo-safety-badge:', c.includes('demo-safety-badge'));

// 4. Check for v5- references
console.log('v5- in class attrs:', (c.match(/class="[^"]*v5-/g) || []).length);
console.log('v5- in CSS rules:', (c.match(/\.v5-/g) || []).length);

// 5. Check renderDashboard is defined ONCE
const renderDashDefs = [];
pos = 0;
while ((pos = c.indexOf('function renderDashboard()', pos)) !== -1) {
  renderDashDefs.push(pos);
  pos++;
}
console.log('renderDashboard() definitions:', renderDashDefs.length);

// 6. Check d6- classes exist
console.log('d6- classes:', (c.match(/class="[^"]*d6-/g) || []).length);
console.log('d6 CSS rules:', (c.match(/\.d6[{-]/g) || []).length);

// 7. Check for Chart.js canvas elements
const canvases = (c.match(/id="dashboard\w*Chart"/g) || []);
console.log('Chart canvases:', canvases);

// 8. Check for any inline styles that might create white strips
const whiteStripPatterns = ['background:#fff', 'background: #fff', 'background-color:#fff', 'background-color: #fff'];
whiteStripPatterns.forEach(p => {
  const count = (c.match(new RegExp(p, 'g')) || []).length;
  if (count > 0) console.log('Potential white strip pattern "' + p + '":', count);
});

// 9. Check that all d6 IDs referenced in JS exist in HTML
const d6IdsInJS = [];
const jsIds = c.match(/document\.getElementById\(['"]([^'"]+)['"]\)/g) || [];
jsIds.forEach(match => {
  const id = match.match(/['"]([^'"]+)['"]/)[1];
  if (id.startsWith('d6') || id.startsWith('ds-')) {
    d6IdsInJS.push(id);
  }
});
const uniqueJsIds = [...new Set(d6IdsInJS)];
console.log('\nUnique d6/ds IDs referenced in JS:', uniqueJsIds.length);
uniqueJsIds.forEach(id => {
  const inHtml = c.includes('id="' + id + '"');
  console.log('  ' + id + ':', inHtml ? '✅ in HTML' : '❌ MISSING in HTML');
});

// 10. Check for onclick handlers that reference non-existent functions
const onclickHandlers = (c.match(/onclick="([^"]+)"/g) || []);
const quickActions = onclickHandlers.filter(h => h.includes('showPage'));
console.log('\nQuick action onclick handlers:', quickActions.length);

// 11. Check the structure around the dashboard
const dashStart = c.indexOf('<div class="page" id="page-dashboard">');
const dashEnd = c.indexOf('<!-- SMART BUSINESS INTELLIGENCE -->');
console.log('\nDashboard HTML length:', dashEnd - dashStart);
console.log('Dashboard starts at:', dashStart);
console.log('Dashboard ends at:', dashEnd);

// 12. Check for any remaining old KPI structure
console.log('\nOld KPI structure (ds-sales in old context):', c.includes('dashboard-kpi-row'));
console.log('Old stats-grid:', c.includes('class="stats-grid dashboard-kpi-row"'));

// 13. Verify the renderDashboard function is complete
const renderStart = c.indexOf('function renderDashboard() {');
const nextFuncAfterRender = c.indexOf('function ', renderStart + 1);
console.log('\nrenderDashboard function length:', nextFuncAfterRender - renderStart);

console.log('\n=== AUDIT COMPLETE ===');
