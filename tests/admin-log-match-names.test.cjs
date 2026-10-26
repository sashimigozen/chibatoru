const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../server/server.js'), 'utf8');
function definition(name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0);
  const end = source.indexOf('\n}', start) + 2;
  return `${source.slice(start, end)};`;
}
function setup() {
  const context = { PLAYER_PROFILE_USERNAME_MAX: 24 };
  vm.createContext(context);
  vm.runInContext(definition('escapeHtml') + definition('logMatchTitle'), context);
  return context;
}

test('管理ログの対戦名はプロフィール名を使い、古い記録は代替名を表示する', () => {
  const c = setup();
  assert.equal(c.logMatchTitle({ summary: { playerNames: { player: 'ホスト名', opponent: 'ゲスト名' },
    deckNames: { player: 'デッキA', opponent: 'デッキB' } } }), 'ホスト名 vs ゲスト名');
  assert.equal(c.logMatchTitle({ summary: {} }), 'プレイヤー vs 対戦相手');
  assert.equal(c.logMatchTitle({ summary: { playerNames: { player: '  ', opponent: {} } } }), 'プレイヤー vs 対戦相手');
});

test('クラウド一覧も同じ対戦名を表示し、名前をHTMLとして実行しない', async () => {
  const c = setup();
  Object.assign(c, {
    cloudLogStore: { list: async () => ({ logs: [
      { gameId: 'cloud-new', summary: { playerNames: { player: '<b>ホスト</b>', opponent: 'ゲスト&友人' } } },
      { gameId: 'cloud-old', summary: {} }
    ] }) },
    htmlResponse: (req, status, body) => { c.response = { status, body }; },
    adminPageShell: body => body
  });
  vm.runInContext(`async ${definition('handleCloudArchive')}`, c);
  await c.handleCloudArchive({}, {}, new URL('http://localhost/admin/logs/archive'));
  assert.equal(c.response.status, 200);
  assert.ok(c.response.body.includes('&lt;b&gt;ホスト&lt;/b&gt; vs ゲスト&amp;友人'));
  assert.ok(c.response.body.includes('プレイヤー vs 対戦相手'));
  assert.ok(c.response.body.includes('/admin/logs/archive/cloud-new.json'));
  assert.ok(c.response.body.includes('href="/admin/logs/archive/cloud-new"'));
  assert.ok(c.response.body.includes('<th>状態</th>'));
  assert.ok(!c.response.body.includes('サーバー再起動後'));
  assert.ok(!c.response.body.includes('<b>ホスト</b>'));
});

test('クラウドのログ選択は内容表示へ進み、保存用JSONはダウンロードのまま', async () => {
  const c = setup();
  const log = { gameId: 'saved', summary: {}, events: [] };
  Object.assign(c, {
    cloudLogStore: { get: async id => id === log.gameId ? log : null },
    normalizeImportedLog: value => value,
    renderAdminLogDetail: (value, options) => { c.detail = { value, options }; return 'ログの中身'; },
    htmlResponse: (res, status, body) => { c.response = { status, body }; },
    jsonResponse: (res, status, body) => { c.response = { status, body }; },
    safeLogFileName: String,
    adminPageShell: body => body
  });
  vm.runInContext(`async ${definition('handleCloudArchive')}`, c);
  const headers = {};
  const res = { setHeader: (key, value) => { headers[key] = value; } };
  await c.handleCloudArchive({}, res, new URL('http://localhost/admin/logs/archive/saved'));
  assert.equal(c.response.status, 200);
  assert.equal(c.response.body, 'ログの中身');
  assert.equal(c.detail.options.archive, true);
  assert.equal(headers['content-disposition'], undefined);
  await c.handleCloudArchive({}, res, new URL('http://localhost/admin/logs/archive/saved.json'));
  assert.equal(c.response.body, log);
  assert.equal(headers['content-disposition'], 'attachment; filename="saved.json"');
  await c.handleCloudArchive({}, res, new URL('http://localhost/admin/logs/archive/missing'));
  assert.equal(c.response.status, 404);
  assert.ok(c.response.body.includes('一覧へ戻る'));
});
