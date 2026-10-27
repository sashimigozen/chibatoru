const {test, expect} = require('@playwright/test');
const {pathToFileURL} = require('node:url');
const path = require('node:path');

async function openCards(page, view = 'cards', width = 1440) {
  await page.setViewportSize({width, height:width === 390 ? 844 : 900});
  await page.goto(pathToFileURL(path.join(__dirname, '..', 'index.html')).href);
  await page.locator('#homeNavDeckButton').click();
  await page.locator(`[data-case-view="${view}"]`).click();
}

for (const width of [1440,390]) {
  test(`一覧の詳細は右下からテストへ進み、×でも閉じられる ${width}`, async ({page}) => {
    const errors=[]; page.on('pageerror', e => errors.push(e.message));
    await openCards(page,'cards',width);
    await page.locator('[data-catalog-card="general_student"]').click();
    const modal=page.locator('#cardTestModal');
    await expect(page.locator('#cardTestCancelButton')).toHaveCount(0);
    await expect(page.locator('#cardTestStartButton')).toBeVisible();
    const button=await page.locator('#cardTestStartButton').boundingBox();
    const copy=await modal.locator('.item-confirm-copy').boundingBox();
    expect(button.y+button.height).toBeLessThanOrEqual(copy.y+copy.height+2);
    expect(Math.abs(button.x+button.width-copy.x-copy.width)).toBeLessThan(6);
    await page.screenshot({path:test.info().outputPath('catalog-test-button.png')});
    await modal.locator('.case-close').click();
    await expect(modal).toBeHidden();
    await page.locator('[data-catalog-card="general_student"]').click();
    await page.locator('#cardTestStartButton').click();
    expect(await page.evaluate(() => [state.screen,state.testMode,state.testCardBaseId])).toEqual(['battle',true,'general_student']);
    await expect.poll(() => page.evaluate(() => battlePresentationBusy())).toBe(false);
    if (width === 390) await page.setViewportSize({width:1440,height:900});
  await page.locator('#battleTestExitButton').click();
    await expect(page.locator('#cardsCatalogView')).toBeVisible();
    expect(errors).toEqual([]);
  });
}

test('編成のテストボタン1回で開始し、元の編集中デッキを保って戻る', async ({page}) => {
  await openCards(page,'library');
  await page.locator('#deckLibraryGrid .new-deck').click();
  await page.locator('[data-card-test="general_student"]').click();
  await page.locator('#caseEditorPlus').click();
  await page.locator('#deckSaveNameInput').fill('編集中の名前');
  const before=await page.evaluate(() => JSON.stringify(state.deckBuilder.counts));
  await page.locator('#caseEditorTest').click();
  await expect(page.locator('#cardTestModal')).toBeHidden();
  expect(await page.evaluate(() => [state.screen,state.testCardBaseId])).toEqual(['battle','general_student']);
  await expect.poll(() => page.evaluate(() => battlePresentationBusy())).toBe(false);
  await page.locator('#battleTestExitButton').click();
  await expect(page.locator('#deckEditorView')).toBeVisible();
  await expect(page.locator('#deckSaveNameInput')).toHaveValue('編集中の名前');
  expect(await page.evaluate(() => JSON.stringify(state.deckBuilder.counts))).toBe(before);
});

test('一覧の関連カードを開いた後は表示中のカードをテストする', async ({page}) => {
  await openCards(page);
  await page.locator('#cardsCatalogSearch').fill('偽魏義ッ血');
  await page.locator('[data-catalog-card="gigi_blood"]').click();
  await page.locator('#cardTestText .tooltip-effect [data-related-card="grudge"]').click();
  await expect(page.locator('#cardTestText .tooltip-title')).toHaveText('怨念');
  await page.locator('#cardTestStartButton').click();
  expect(await page.evaluate(() => state.testCardBaseId)).toBe('grudge');
});
