'use strict';
// Local preview only. Does not run the normal battle or D1 log service.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { WebSocketServer } = require('../server/node_modules/ws');
const { createNarabeRooms } = require('../server/narabe-rooms');
const root = path.resolve(__dirname, '..');
const port = Number(process.env.NARABE_PORT || 8790);
const rooms = createNarabeRooms();
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.json': 'application/json', '.jpg': 'image/jpeg' };
const server = http.createServer((req, res) => {
  let pathname; try { pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); } catch { res.writeHead(400).end(); return; }
  if (pathname.endsWith('/')) pathname += 'index.html';
  const filename = path.resolve(root, '.' + pathname), ext = path.extname(filename);
  if (!filename.startsWith(root + path.sep) || pathname.split('/').some(x => x.startsWith('.')) || pathname.includes('node_modules') || !mime[ext]) { res.writeHead(404).end(); return; }
  fs.readFile(filename, (err, data) => { if (err) { res.writeHead(404).end(); return; } res.writeHead(200, { 'content-type': mime[ext] + (['.html', '.js', '.css', '.json'].includes(ext) ? '; charset=utf-8' : ''), 'cache-control': 'no-store' }); res.end(data); });
});
const wss = new WebSocketServer({ server, path: '/narabe', maxPayload: 4096 });
wss.on('connection', ws => rooms.connect(ws));
server.listen(port, '127.0.0.1', () => console.log(`チバトル並べ: http://127.0.0.1:${port}/narabe-test/`));
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => { rooms.close(); wss.close(); server.close(() => process.exit(0)); });
