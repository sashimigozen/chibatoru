import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { buildExperimentalHtml } from './transform.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.dirname(here);
const port = Number(process.env.CHIBATTLE_TEST_PORT || 4189);
const types = { '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.ico': 'image/x-icon' };
const server = http.createServer(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  // Experimental clients must never join the production WebSocket service.
  res.setHeader('Content-Security-Policy', "connect-src 'self'; frame-ancestors 'none'");
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if (pathname === '/health') {
      res.setHeader('Content-Type', 'application/json');
      return res.end(JSON.stringify({ mode: 'experimental-rules', version: '0.29.0-test.1' }));
    }
    if (pathname === '/' || pathname === '/index.html') {
      const [source, runtime] = await Promise.all([
        readFile(path.join(root, 'index.html'), 'utf8'),
        readFile(path.join(here, 'runtime.js'), 'utf8')
      ]);
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.end(buildExperimentalHtml(source, runtime));
    }
    const filename = path.resolve(root, `.${pathname}`);
    const extension = path.extname(filename).toLowerCase();
    if (!filename.startsWith(`${root}${path.sep}`) || pathname.split('/').some(p => p.startsWith('.')) || !types[extension]) {
      res.writeHead(404); return res.end('Not found');
    }
    const data = await readFile(filename);
    res.setHeader('Content-Type', types[extension]);
    res.end(data);
  } catch (error) {
    res.writeHead(error.code === 'ENOENT' ? 404 : 500);
    res.end(error.code === 'ENOENT' ? 'Not found' : `テスト版を構築できませんでした：${error.message}`);
  }
});
server.listen(port, '127.0.0.1', () => console.log(`新ルール・ローカルテスト http://127.0.0.1:${port}/`));
