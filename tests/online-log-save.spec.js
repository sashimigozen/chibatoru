const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const url = pathToFileURL(path.join(__dirname, '..', 'index.html')).href;

async function finishOnline(page, role) {
  await page.goto(url);
  await page.evaluate(role => {
    const s = __chibattle.state;
    s.preBattleToken++; s.screen = 'battle'; s.phase = 'battle';
    s.online.role = role; s.online.connected = true; s.online.started = true;
    s.online.conn = { send: () => true };
    analyticsStartGame();
    // Guest normally receives this metadata from the host snapshot.
    s.analytics.game.mode = 'online';
    endGame('player', 'テスト');
    __chibattle.render();
  }, role);
}
test('online result has a top-right save button; host downloads the verified server log', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await finishOnline(page, 'host');
  const button = page.locator('#resultSaveLogButton');
  await expect(button).toBeVisible();
  await expect.poll(async () => {
    const b = await button.boundingBox(), log = await page.locator('#battleLogButton').boundingBox();
    return b.x + b.width < log.x;
  }).toBe(true);
  const box = await button.boundingBox();
  expect(box.x).toBeGreaterThan(1000); expect(box.y).toBeLessThan(60);
  const logBox = await page.locator('#battleLogButton').boundingBox();
  expect(box.x + box.width).toBeLessThan(logBox.x);
  await expect(page.locator('#resultOverlay')).toHaveCSS('opacity', '1');
  await page.screenshot({ path: test.info().outputPath('online-result-save.png') });
  await button.click();
  await expect(button).toBeDisabled();
  const downloadPromise = page.waitForEvent('download');
  await page.evaluate(() => {
    const gameId = __chibattle.state.analytics.game.gameId;
    __chibattle.onlineHandleMessage({ protocol: 1, type: 'battleLogDownload', senderId: 'server', gameId, log: { gameId, trace: { marker: 'full-server-log' } } });
  });
  const download = await downloadPromise;
  const log = JSON.parse(fs.readFileSync(await download.path(), 'utf8'));
  expect(log.trace.marker).toBe('full-server-log');
  await expect(button).toBeEnabled();
});
test('guest saves only its perspective without private replay; narrow viewport stays on screen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await finishOnline(page, 'guest');
  const button = page.locator('#resultSaveLogButton');
  const box = await button.boundingBox();
  expect(box.x + box.width).toBeLessThanOrEqual(390); expect(box.y).toBeGreaterThanOrEqual(0);
  const downloadPromise = page.waitForEvent('download');
  await button.click();
  const download = await downloadPromise;
  const log = JSON.parse(fs.readFileSync(await download.path(), 'utf8'));
  expect(log.source).toBe('online-public-view'); expect(log.trace).toBeUndefined();
});
test('offline and spectator results do not show the save button', async ({ page }) => {
  await page.goto(url);
  await page.evaluate(() => { __chibattle.state.preBattleToken++; endGame('player', 'テスト'); });
  await expect(page.locator('#resultSaveLogButton')).toBeHidden();
  await finishOnline(page, 'spectator');
  await expect(page.locator('#resultSaveLogButton')).toBeHidden();
});

test('host can save a local diagnostic replay if the server does not respond', async ({ page }) => {
  await page.clock.install();
  await finishOnline(page, 'host');
  const downloadPromise = page.waitForEvent('download');
  await page.locator('#resultSaveLogButton').click();
  await page.clock.runFor(5100);
  const download = await downloadPromise;
  const log = JSON.parse(fs.readFileSync(await download.path(), 'utf8'));
  expect(log.source).toBe('online-local-diagnostic');
  expect(log.serverVerifiedHumanMatch).toBeUndefined();
  expect(log.trace.entries.length).toBeGreaterThan(0);
});
