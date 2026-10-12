const { test, expect } = require('@playwright/test');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const url = pathToFileURL(path.join(__dirname, '..', 'index.html')).href;

for (const baseId of ['yuta', 'tsurai_nara', 'company_one_day', 'enough_to_fly', 'ii_daro_tte']) {
  test(`${baseId}の関連カードからUltimate U太を開いて戻れる`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(url);
    await page.evaluate(() => { startCardTest('yuta'); scheduleOpponentAI = () => {}; });
    await expect.poll(() => page.evaluate(() => battlePresentationBusy())).toBe(false);
    const originalName = await page.evaluate(id => {
      const card = createCardFromBase(id, 'player');
      showBattleCardPreview(card);
      return card.name;
    }, baseId);
    const preview = page.locator('#battleCardPreview');
    const related = preview.locator('[data-related-card="ultimate_yuta"]');
    await expect(related).toHaveCount(1);
    await expect(related).toHaveText('Ultimate U太');
    await related.click();
    await expect(preview).toContainText('このカードを手札から出席させたとき、このゲームに勝利する。');
    if (baseId === 'yuta') await page.screenshot({ path: test.info().outputPath('ultimate-uta-related.png') });
    await preview.locator('[data-related-card-back]').click();
    await expect(preview).toContainText(originalName);
    await expect(preview.locator('[data-related-card="ultimate_yuta"]')).toHaveCount(1);
  });
}
