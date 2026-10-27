const { test, expect } = require('@playwright/test');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
let server, logDir, base;
test.use({ httpCredentials: { username: 'admin', password: 'profile-log-test' } });
test.beforeAll(async () => {
  const port = await new Promise(resolve => {
    const probe = net.createServer();
    probe.listen(0, '127.0.0.1', () => { const port = probe.address().port; probe.close(() => resolve(port)); });
  });
  base = `http://127.0.0.1:${port}`;
  logDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chibatoru-profile-log-ui-'));
  const cloudFile = path.join(logDir, 'cloud.fixture');
  fs.writeFileSync(cloudFile, JSON.stringify([
    { gameId: 'cloud-match', final: true, receivedAt: '2026-10-26T10:00:00.000Z',
      summary: { playerNames: { player: 'クラウド太郎', opponent: 'クラウド花子' }, winner: 'player' },
      events: [{eventType:'game_start', game:{decks:{player:{deckName:'クラウド学生',deckList:{general_student:3,ruler:2}},opponent:{deckName:'クラウド教師',deckList:{general_teacher:2,smiling_lecturer:1}}}}},
        { eventType: 'action', eventSeq: 1, turn: 2, cardName: '一般学生', actionType: 'play_card', side: 'player' }] },
    { gameId: 'cloud-old', final: false, summary: {}, events: [] }
  ]));
  server = spawn(process.execPath, ['--require', path.join(__dirname, 'fixtures/admin-cloud-store.cjs'), 'server.js'], { cwd: path.join(__dirname, '../server'),
    env: { ...process.env, PORT: String(port), CHIBATORU_LOG_DIR: logDir,
      CHIBATORU_LOG_ADMIN_PASSWORD: 'profile-log-test', CHIBATORU_D1_API_TOKEN: '',
      CHIBATORU_TEST_CLOUD_LOG_FILE: cloudFile }, stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('管理ログの起動待ちがタイムアウトしました')), 5000);
    server.stdout.on('data', data => { if (String(data).includes('listening')) { clearTimeout(timer); resolve(); } });
    server.once('error', reject);
  });
});
test.afterAll(() => { server?.kill('SIGTERM'); if (logDir) fs.rmSync(logDir, { recursive: true, force: true }); });

test('保存済みログの一覧と詳細をプロフィール名の対戦見出しで表示する', async ({ page }) => {
  const imported = await page.request.post(`${base}/admin/logs/import`, { data: { logs: [
    { gameId: 'profile-match', final: true, summary: { playerNames: { player: 'あさまる', opponent: 'チバトル太郎' },
      deckNames: { player: 'デッキA', opponent: 'デッキB' } }, events: [
        {eventType:'game_start',game:{decks:{player:{deckName:'デッキA',deckList:{general_student:3,ruler:2,smiling_lecturer:1}},opponent:{deckName:'デッキB',deckList:{general_teacher:2,retired_card:1}}}}},
        {eventType:'game_end',final:{cardStats:[{side:'opponent',cardId:'retired_card',cardName:'当時のカード名'}]}}
      ] },
    { gameId: 'legacy-match', final: true, events: [] }
  ] } });
  expect(imported.ok()).toBeTruthy();
  await page.goto(`${base}/admin/logs?storage=local`);
  await expect(page.getByRole('columnheader', { name: '対戦', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'あさまる vs チバトル太郎', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'プレイヤー vs 対戦相手', exact: true })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('profile-log-list.png'), fullPage: true });
  await page.getByRole('link', { name: 'あさまる vs チバトル太郎', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('あさまる vs チバトル太郎');
  await expect(page.getByText('gameId: profile-match', { exact: true })).toBeVisible();
  const own=page.locator('[data-deck-side="player"]');
  await expect(own).toContainText('6枚・3種類');
  await expect(own.getByRole('row').filter({hasText:'一般学生'})).toHaveText('一般学生3');
  await expect(own).toContainText('微笑み講師');
  const enemy=page.locator('[data-deck-side="opponent"]');
  await expect(enemy).toContainText('3枚・2種類');
  await expect(enemy).toContainText('当時のカード名');
  await page.screenshot({ path: test.info().outputPath('profile-log-detail.png'), fullPage: true });
});

test('最初にクラウド一覧を表示し、対戦名から中身を開いて戻れる', async ({ page }) => {
  await page.goto(`${base}/admin/logs`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('クラウド保存ログ');
  await expect(page.getByRole('link', { name: 'クラウド太郎 vs クラウド花子', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'プレイヤー vs 対戦相手', exact: true })).toBeVisible();
  await expect(page.getByRole('cell', { name: '終了', exact: true })).toBeVisible();
  await expect(page.getByRole('cell', { name: '途中', exact: true })).toBeVisible();
  await expect(page.locator('body')).not.toContainText('サーバー再起動後');
  await page.screenshot({ path: test.info().outputPath('cloud-log-list.png'), fullPage: true });
  await page.getByRole('link', { name: 'クラウド太郎 vs クラウド花子', exact: true }).click();
  await expect(page).toHaveURL(`${base}/admin/logs/archive/cloud-match`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('クラウド太郎 vs クラウド花子');
  await expect(page.getByRole('cell', { name: '一般学生', exact: true }).first()).toBeVisible();
  await expect(page.locator('[data-deck-side="player"]')).toContainText('5枚・2種類');
  await expect(page.locator('[data-deck-side="opponent"]')).toContainText('微笑み講師');
  await expect(page.getByRole('link', { name: 'ログを保存', exact: true })).toHaveAttribute('href', '/admin/logs/archive/cloud-match.json');
  await page.screenshot({ path: test.info().outputPath('cloud-log-detail.png'), fullPage: true });
  const saved = await page.request.get(`${base}/admin/logs/archive/cloud-match.json`);
  expect(saved.headers()['content-disposition']).toContain('attachment;');
  expect((await saved.json()).gameId).toBe('cloud-match');
  await page.getByRole('link', { name: 'ログ一覧へ戻る', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('クラウド保存ログ');
});

test('クラウド一覧と中身は管理者認証が必要で、存在しないログは404になる', async ({ page }) => {
  for (const suffix of ['', '/archive', '/archive/cloud-match', '/archive/cloud-match.json']) {
    const response = await fetch(`${base}/admin/logs${suffix}`);
    expect(response.status).toBe(401);
    await response.text();
  }
  expect((await page.request.get(`${base}/admin/logs/archive/missing`)).status()).toBe(404);
});


test('古い記録にデッキ内容がなければ推測せず未記録と表示する',async({page})=>{
  await page.request.post(`${base}/admin/logs/import`,{data:{gameId:'no-deck',events:[]}});
  await page.goto(`${base}/admin/logs/no-deck`);
  await expect(page.getByText('デッキ内容の記録がありません。',{exact:true})).toHaveCount(2);
});

test('スマホでも両者の内訳を確認でき、ログ内の名前をHTMLとして実行しない',async({page})=>{
  await page.request.post(`${base}/admin/logs/import`,{data:{gameId:'safe-deck',events:[
    {eventType:'game_start',game:{decks:{player:{deckName:'<script>bad</script>',deckList:{old_card:2,general_student:3,unknown_id:1,ruler:-1,invalid:'3'}},opponent:{deckList:{general_teacher:1}}}}},
    {eventType:'game_end',final:{cardStats:[{side:'player',cardId:'old_card',cardName:'<img src=x onerror=alert(1)>'}]}}
  ]}});
  await page.setViewportSize({width:390,height:844});
  await page.goto(`${base}/admin/logs/safe-deck`);
  const own=page.locator('[data-deck-side="player"]');
  await expect(own).toContainText('6枚・3種類');
  await expect(own).toContainText('<script>bad</script>');
  await expect(own).toContainText('<img src=x onerror=alert(1)>');
  await expect(own).toContainText('unknown_id');
  await expect(own.locator('img,script')).toHaveCount(0);
  const [a,b]=await Promise.all([own.boundingBox(),page.locator('[data-deck-side="opponent"]').boundingBox()]);
  expect(b.y).toBeGreaterThan(a.y+a.height);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:test.info().outputPath('deck-detail-mobile.png'),fullPage:true});
});
