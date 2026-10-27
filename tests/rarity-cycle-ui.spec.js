const { test, expect } = require('@playwright/test');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const url = pathToFileURL(path.join(__dirname, '..', 'index.html')).href;
const key = 'chibattle-dungeon-card-styles-v1';

test('編集左側・カード詳細・プロフィールは同じ回転アイコンで切り替える', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.addInitScript(() => {
    if (localStorage.getItem('chibattle-dungeon-card-styles-v1')) return;
    localStorage.setItem('chibattle-dungeon-card-styles-v1', JSON.stringify({
      unlocked: { king_ghidorah_bed: true }, prismUnlocked: { king_ghidorah_bed: true },
      cardUnlocks: { king_ghidorah_bed: { rare: true, superRare: true, ultraRare: true } },
      selected: { king_ghidorah_bed: 'normal' }
    }));
  });
  await page.goto(url);
  await page.locator('#homeNavDeckButton').click();
  await page.locator('[data-case-view="library"]').click();
  await page.locator('#deckLibraryGrid .new-deck').click();
  await page.locator('[data-card-test="king_ghidorah_bed"]').click();
  const editorButton = page.locator('#caseEditorCard [data-editor-style]');
  await expect(editorButton).toHaveClass('card-style-cycle-button');
  await expect(editorButton).toHaveText('');
  const icon = await editorButton.locator('svg').evaluate(el => el.outerHTML);
  const shape = await editorButton.evaluate(el => ({ radius: getComputedStyle(el).borderRadius, width: el.offsetWidth, height: el.offsetHeight }));
  expect(shape).toEqual({ radius: '999px', width: 34, height: 34 });
  const countsBefore = await page.evaluate(() => window.__chibattle.state.deckBuilder.counts.player);
  const modes = ['normal', 'rare', 'superRare', 'ultraRare', 'secretRare', 'prism', 'normal'];
  for (const mode of modes.slice(1)) {
    await editorButton.focus();
    await editorButton.press('Enter');
    expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)).selected.king_ghidorah_bed, key)).toBe(mode);
  }
  expect(await page.evaluate(() => window.__chibattle.state.deckBuilder.counts.player)).toEqual(countsBefore);
  await editorButton.hover();
  await page.screenshot({ path: test.info().outputPath('editor-cycle-button.png') });
  await page.evaluate(() => openCardTestConfirm('king_ghidorah_bed'));
  const detailButton = page.locator('#cardTestModal [data-card-style-cycle]');
  await expect(detailButton).toHaveClass('card-style-cycle-button');
  expect(await detailButton.locator('svg').evaluate(el => el.outerHTML)).toBe(icon);
  await detailButton.click();
  await expect(page.locator('#cardTestCard .card')).toHaveClass(/rarity-rare/);
  for (const label of ['SR', 'UR', 'SC', 'PR']) {
    await detailButton.click();
    await expect(page.locator('#cardTestCard .card-rarity-label')).toHaveText(label);
    if (label === 'SC' || label === 'PR') {
      await page.screenshot({ path: test.info().outputPath(`rarity-${label}.png`) });
    }
  }
  // Return to R so the remaining profile check keeps the same starting style.
  await detailButton.click();
  await detailButton.click();
  await page.locator('#cardTestModal .case-close').click();
  await page.locator('[data-card-test="general_student"]').click();
  await expect(page.locator('#caseEditorCard [data-editor-style]')).toHaveCount(0);
  await page.reload();
  await page.locator('#homeProfileButton').click();
  await page.locator('#profileFavoriteCardButton').click();
  await page.locator('#profileCardSearchInput').fill('キングギドラベッド');
  const profileButton = page.locator('[data-profile-card-style-cycle="king_ghidorah_bed"]');
  await expect(profileButton).toHaveClass('card-style-cycle-button');
  expect(await profileButton.locator('svg').evaluate(el => el.outerHTML)).toBe(icon);
  await profileButton.click();
  await expect(page.locator('[data-profile-card-id="king_ghidorah_bed"]')).toHaveClass(/rarity-super-rare/);
});
