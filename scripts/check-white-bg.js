const fs = require('fs');
const c = fs.readFileSync('E:/Projects/ESO/DigiTronics_v5.html', 'utf-8');

// Find all background:#fff or background-color:#fff instances
const matches = [];
let pos = 0;
while ((pos = c.indexOf('background:#fff', pos)) !== -1) {
  const start = Math.max(0, pos - 100);
  const context = c.substring(start, pos + 30).replace(/\n/g, ' ');
  matches.push({pos, context});
  pos++;
}

// Also check background: #fff (with space)
pos = 0;
while ((pos = c.indexOf('background: #fff', pos)) !== -1) {
  const start = Math.max(0, pos - 100);
  const context = c.substring(start, pos + 30).replace(/\n/g, ' ');
  matches.push({pos, context});
  pos++;
}

console.log('Total background:#fff instances:', matches.length);
matches.forEach((m, i) => {
  console.log(`\n${i + 1}. At ${m.pos}:`);
  console.log('   ', m.context.substring(0, 120));
});
