const { test, expect } = require('@playwright/test');
const { pathToFileURL } = require('node:url');
const path = require('node:path');

test('14日のパッチ履歴を古い0.24.1へまとめ、機能追加と以前の履歴は残す', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(pathToFileURL(path.join(__dirname, '..', 'index.html')).href);
  const records = await page.evaluate(() => {
    showUpdatesScreen();
    const entries = UPDATE_HISTORY.filter(entry => entry.date === '2026年10月14日');
    const patch = entries.find(entry => entry.version === 'ver.0.24.1');
    return { versions: entries.map(entry => entry.version), changes: patch.changes,
      olderDate: UPDATE_HISTORY.find(entry => entry.version === 'ver.0.24.0').date,
      texts: ['information_tired_student', 'corridor_student', 'illness'].map(id => ({
        name: CARD_BASES[id].name, text: cardRulesText(createCardFromBase(id, 'player'))
      })) };
  });
  expect(records.versions).toEqual(['ver.0.25.0', 'ver.0.24.1']);
  expect(records.changes.map(change => change.title)).toEqual([
    '病', '対象の選択表示', '高負荷の融合素材', 'マリガン表示', '小刻みリズム学生',
    '強化・弱体化の演出', '情報に疲れた学生', '通路で粘る学生'
  ]);
  expect(records.olderDate).toBe('2026年10月13日');
  for (const card of records.texts) {
    expect(records.changes.find(change => change.title === card.name).after).toBe(card.text);
  }
  await expect(page.locator('.update-entry').first().locator('summary')).toContainText('ver.0.25.0');
  const entry = page.locator('.update-entry').nth(1);
  await entry.locator('summary').click();
  await expect(entry.locator('summary')).toContainText('ver.0.24.1');
  await expect(entry.locator('.update-change')).toHaveCount(8);
  await expect(page.locator('.update-entry > summary').filter({ hasText: 'ver.0.24.2' })).toHaveCount(0);
  await expect(page.locator('.update-entry > summary').filter({ hasText: 'ver.0.25.1' })).toHaveCount(0);
  await page.screenshot({ path: test.info().outputPath('oct14-updates.png') });
});
