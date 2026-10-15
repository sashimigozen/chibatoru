const { test, expect } = require('@playwright/test');
const { pathToFileURL } = require('node:url');
const path = require('node:path');

test('マッチングのデッキ確認は保存した全レアリティを表示し、設定と枚数を維持する', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.addInitScript(() => localStorage.setItem('chibattle-dungeon-card-styles-v1', JSON.stringify({
    unlocked: { king_ghidorah_bed: true }, prismUnlocked: { king_ghidorah_bed: true },
    cardUnlocks: { king_ghidorah_bed: { rare: true, superRare: true, ultraRare: true } },
    selected: { king_ghidorah_bed: 'normal' }
  })));
  await page.goto(pathToFileURL(path.join(__dirname, '..', 'index.html')).href);
  await page.evaluate(() => {
    const counts = { king_ghidorah_bed: 3, general_student: 3 };
    state.deckBuilder.savedDecks = { 'レアリティ確認': { counts } };
    state.deckBuilder.counts.player = counts;
    Object.assign(state.soloSelection, { ruleId: 'normal', playerDeckName: 'レアリティ確認',
      opponentDeckName: 'レアリティ確認' });
    Object.assign(state.online, { matchMode: 'random', lobbyView: 'private', localDeckName: '__current' });
  });
  const modes = [ ['normal', null], ['rare', 'rarity-rare'], ['superRare', 'rarity-super-rare'],
    ['ultraRare', 'rarity-ultra-rare'], ['secretRare', 'rarity-secret-rare'], ['prism', 'reward-prism'] ];
  for (const screen of ['online', 'soloDeck']) {
    await page.evaluate(screen => {
      state.screen = screen; state.online.deckPreviewOpen = false; render();
    }, screen);
    await page.locator(screen === 'online' ? '#onlineRandomDeckConfirmButton' : '#soloPlayerDeckConfirmButton').click();
    const panel = page.locator(screen === 'online' ? '#onlineRandomDeckPreviewContent' : '#soloDeckDetail');
    await expect(panel).toBeVisible();
    for (const [mode, className] of modes) {
      await page.evaluate(mode => {
        selectedDungeonCardStyles.king_ghidorah_bed = mode; persistDungeonCardStyles(); render();
      }, mode);
      const card = panel.locator('[data-library-card="king_ghidorah_bed"]');
      await expect(card).toBeVisible();
      if (className) await expect(card).toHaveClass(new RegExp(`\\b${className}\\b`));
      else await expect(card).not.toHaveClass(/rarity-|reward-foil|reward-prism/);
      await expect(card.locator('.rarity-mirror-surface')).toHaveCount(['rare','superRare','ultraRare'].includes(mode) ? 1 : 0);
      await expect(card.locator('.deck-copy-badge')).toHaveText('x3');
      await expect(panel.locator('[data-library-card="general_student"]')).not.toHaveClass(/rarity-|reward-foil/);
      expect(await page.evaluate(() => JSON.parse(localStorage.getItem('chibattle-dungeon-card-styles-v1')).selected.king_ghidorah_bed)).toBe(mode);
      if (mode === 'ultraRare') await page.screenshot({ path: test.info().outputPath(`${screen}-ur.png`) });
    }
  }
});
