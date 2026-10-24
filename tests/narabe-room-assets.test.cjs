const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');

test('並べの入口・画面・動作・スタイルは同じ更新識別子でキャッシュを分離する', () => {
  const html = fs.readFileSync(path.join(root, 'narabe/index.html'), 'utf8');
  const entry = fs.readFileSync(path.join(root, 'narabe-entry.js'), 'utf8');
  const main = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const revision = html.match(/app\.js\?v=([^"']+)/)?.[1];
  assert.ok(revision, '動作ファイルのURLに更新識別子が必要');
  assert.ok(html.includes(`lobby.css?v=${revision}`));
  assert.ok(main.includes(`narabe-entry.js?v=${revision}`));
  assert.ok(entry.includes(`destination.searchParams.set('v', '${revision}')`));
  assert.ok(html.includes('id="addSeat"'));
});
