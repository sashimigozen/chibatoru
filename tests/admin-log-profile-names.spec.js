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
      events: [{ eventType: 'action', eventSeq: 1, turn: 2, cardName: '一般学生', actionType: 'play_card', side: 'player' }] },
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
      deckNames: { player: 'デッキA', opponent: 'デッキB' } }, events: [] },
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
  await expect(page.getByRole('cell', { name: '一般学生', exact: true })).toBeVisible();
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
