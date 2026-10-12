const { test, expect } = require('@playwright/test');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const url = pathToFileURL(path.join(__dirname, '..', 'index.html')).href;

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(url);
  await page.evaluate(() => {
    const api = window.__chibattle;
    api.startCardTest('general_student');
    api.state.phase = 'mulligan';
    api.state.firstSide = 'player';
    api.state.players.player.mulliganUsed = false;
    api.state.players.player.mulliganSelection = [];
    api.state.players.player.hand = ['yuta', 'general_student', 'ae_student', 'trpg_member', 'dark_yuta']
      .map(id => api.createCardFromBase(id, 'player'));
    api.render();
  });
});

test('クリックで同じ列のKEEPとCHANGEを往復する', async ({ page }) => {
  const keep = page.locator('[data-mulligan-zone="keep"]');
  const change = page.locator('[data-mulligan-zone="change"]');
  await expect(keep.locator('.card')).toHaveCount(5);
  await keep.locator('.card').nth(2).click();
  await expect(change.locator('.card')).toHaveCount(1);
  await expect(keep.locator('.card')).toHaveCount(4);
  expect(await change.locator('.card').evaluate(node => [...node.parentNode.children].indexOf(node))).toBe(2);
  await change.locator('.card').click();
  await expect(keep.locator('.card')).toHaveCount(5);
  await expect(change.locator('.card')).toHaveCount(0);
});

test('ドラッグで交換先へ移動し、保持へ戻せる', async ({ page }) => {
  await page.locator('[data-mulligan-zone="keep"] .card').first()
    .dragTo(page.locator('[data-mulligan-zone="change"] .mulligan-empty-slot').first());
  await expect(page.locator('[data-mulligan-zone="change"] .card')).toHaveCount(1);
  await page.locator('[data-mulligan-zone="change"] .card').dragTo(page.locator('[data-mulligan-zone="keep"] .mulligan-empty-slot'));
  await expect(page.locator('[data-mulligan-zone="keep"] .card')).toHaveCount(5);
});

for (const viewport of [{ width: 1440, height: 900 }, { width: 1280, height: 720 }, { width: 1108, height: 512 }]) {
  test(`上下2段と確定が画面内に収まる ${viewport.width}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.locator('[data-mulligan-zone="keep"] .card').first().click();
    for (const selector of ['.mulligan-zone', '#mulliganButton', '#mulliganOrder']) {
      for (const node of await page.locator(selector).all()) {
        const rect = await node.boundingBox();
        expect(rect.x).toBeGreaterThanOrEqual(0);
        expect(rect.y).toBeGreaterThanOrEqual(0);
        expect(rect.x + rect.width).toBeLessThanOrEqual(viewport.width);
        expect(rect.y + rect.height).toBeLessThanOrEqual(viewport.height);
      }
    }
    const card = await page.locator('.mulligan-card').first().boundingBox();
    expect(card.height / card.width).toBeCloseTo(1.5, 1);
    await page.waitForFunction(() => Number(getComputedStyle(document.querySelector('#turnOverlay')).opacity) === 0);
    await page.screenshot({ path: test.info().outputPath(`mulligan-${viewport.width}.png`) });
    await expect(page.locator('#mulliganTitle')).toHaveText('引き直すカードを選んでください。');
    await page.locator('#mulliganButton').click({ timeout: 3000 });
    expect(await page.evaluate(() => window.__chibattle.state.players.player.mulliganUsed)).toBe(true);
    await expect.poll(() => page.evaluate(() => window.__chibattle.state.phase)).toBe('battle');
    await expect(page.locator('#mulliganStage')).toBeHidden();
  });
}

test('交換0枚でもクリックで確定できる', async ({ page }) => {
  await page.locator('#mulliganButton').click({ timeout: 3000 });
  await expect.poll(() => page.evaluate(() => window.__chibattle.state.phase)).toBe('battle');
});

test('オンラインホストも選択後にクリックで確定し、相手を待つ', async ({ page }) => {
  await page.evaluate(() => {
    const state = window.__chibattle.state;
    state.online.enabled = true;
    state.online.role = 'host';
    state.online.started = true;
    state.players.opponent.mulliganUsed = false;
    window.__chibattle.render();
  });
  await page.locator('[data-mulligan-zone="keep"] .card').first().click();
  await page.locator('#mulliganButton').click({ timeout: 3000 });
  expect(await page.evaluate(() => window.__chibattle.state.players.player.mulliganUsed)).toBe(true);
  await expect(page.locator('#mulliganButton')).toBeHidden();
  expect(await page.evaluate(() => window.__chibattle.state.phase)).toBe('mulligan');
});
