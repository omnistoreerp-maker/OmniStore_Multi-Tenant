'use strict';
// Static file server used by release validation to serve release archives for
// the in-app updater download test. Usage: node rc-static-server.js <dir> <port>
const http = require('http');
const fs = require('fs');
const path = require('path');

const dir = path.resolve(process.argv[2] || '.');
const port = parseInt(process.argv[3], 10) || 3100;

http.createServer((req, res) => {
  const file = path.join(dir, decodeURIComponent(req.url.split('?')[0]));
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': data.length });
    res.end(data);
  });
}).listen(port, '127.0.0.1', () => {
  console.log('rc-static-server listening on http://127.0.0.1:' + port + ' serving ' + dir);
});
