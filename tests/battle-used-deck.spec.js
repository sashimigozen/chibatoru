const { test, expect } = require('@playwright/test');
const { pathToFileURL } = require('node:url');
const path = require('node:path');

test('使用中デッキは手札・校外・生成によらず開始時の内容で、全レアリティの枚数が前面に表示される', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(pathToFileURL(path.join(__dirname, '..', 'index.html')).href);
  await page.evaluate(() => {
    startCardTest('general_student'); scheduleOpponentAI = () => {};
    state.training.skipAnimations = true;
    state.players.player.originalDeckCounts = { general_student: 3, king_ghidorah_bed: 2 };
    state.players.player.deck = [];
    state.players.player.hand = [createCardFromBase('general_student', 'player')];
    state.players.player.trash = [createCardFromBase('king_ghidorah_bed', 'player'), createCardFromBase('ruler', 'player')];
    Object.assign(state.online, { role: 'guest', started: true });
    state.remoteResolutionPending = true;
    render();
  });
  for (const mode of ['normal', 'rare', 'superRare', 'ultraRare', 'secretRare', 'prism']) {
    await page.evaluate(mode => {
      state.online.localCardStyles = { king_ghidorah_bed: mode };
      openDeckWindow();
    }, mode);
    await expect(page.locator('#deckWindowInfo')).toHaveText('使用中デッキ 5枚');
    await expect(page.locator('#deckWindowGrid > button')).toHaveCount(2);
    const card = page.locator('#deckWindowGrid > button').last();
    await expect(card.locator('.deck-copy-badge')).toHaveText('x2');
    const topmost = await card.locator('.deck-copy-badge').evaluate(badge => {
      badge.style.pointerEvents = 'auto';
      const r = badge.getBoundingClientRect();
      const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      badge.style.removeProperty('pointer-events');
      return top === badge;
    });
    expect(topmost).toBe(true);
    if (mode === 'ultraRare') await page.screenshot({ path: test.info().outputPath('used-deck-rarity-count.png') });
    await page.locator('#deckModalClose').click();
    await expect(page.locator('#deckModal')).toBeHidden();
  }
  expect(await page.evaluate(() => state.players.player.originalDeckCounts)).toEqual({ general_student: 3, king_ghidorah_bed: 2 });
});
