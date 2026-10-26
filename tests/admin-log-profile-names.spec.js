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
  server = spawn(process.execPath, ['server.js'], { cwd: path.join(__dirname, '../server'),
    env: { ...process.env, PORT: String(port), CHIBATORU_LOG_DIR: logDir,
      CHIBATORU_LOG_ADMIN_PASSWORD: 'profile-log-test', CHIBATORU_D1_API_TOKEN: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
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
  await page.goto(`${base}/admin/logs`);
  await expect(page.getByRole('columnheader', { name: '対戦', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'あさまる vs チバトル太郎', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'プレイヤー vs 対戦相手', exact: true })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('profile-log-list.png'), fullPage: true });
  await page.getByRole('link', { name: 'あさまる vs チバトル太郎', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('あさまる vs チバトル太郎');
  await expect(page.getByText('gameId: profile-match', { exact: true })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('profile-log-detail.png'), fullPage: true });
});
