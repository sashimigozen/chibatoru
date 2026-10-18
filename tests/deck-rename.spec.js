const { test, expect } = require('@playwright/test');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const url = pathToFileURL(path.join(__dirname, '..', 'index.html')).href;
async function setup(page, format = 'normal', collision = false) {
  await page.goto(url);
  await page.locator('#homeNavDeckButton').click();
  await page.locator('[data-case-view="library"]').click();
  await page.evaluate(({ format, collision }) => {
    state.deckBuilder.format = format;
    state.deckBuilder.specialtyId = 'big';
    const counts = format === 'specialty' ? createSpecialtyAutoDeckCounts('big')
      : format === 'chaos' ? copyDeckCounts({ general_student: 40 }, { unlimited: true }) : createAutoDeckCounts();
    const decks = activeDeckCollection();
    decks['改名前'] = { counts, createdOrder: 7, ...(format === 'specialty' ? { specialtyId: 'big' } : {}) };
    if (collision) decks['改名後'] = { counts: { general_student: 1 }, createdOrder: 9 };
    beginExistingDeckEditor('改名前');
  }, { format, collision });
  await expect(page.locator('#deckEditorView')).toBeVisible();
}
for (const format of ['normal', 'specialty', 'chaos']) test(`${format}: 名称変更で複製せず、内容と作成順を維持し再起動後も元の名前を残さない`, async ({ page }) => {
  await setup(page, format);
  const before = await page.evaluate(() => activeDeckCollection()['改名前']);
  await page.locator('#deckSaveNameInput').fill('改名後');
  await page.locator('#saveDeckButton').click();
  await expect(page.locator('#deckLibraryView')).toBeVisible();
  const saved = await page.evaluate(() => ({ old: activeDeckCollection()['改名前'] || null, next: activeDeckCollection()['改名後'] }));
  expect(saved.old).toBeNull();
  expect(saved.next.counts).toEqual(before.counts); expect(saved.next.createdOrder).toBe(7);
  if (format === 'specialty') expect(saved.next.specialtyId).toBe('big');
  await page.reload();
  const restored = await page.evaluate(format => {
    state.deckBuilder.format = format;
    return { old: activeDeckCollection()['改名前'] || null, next: activeDeckCollection()['改名後'] };
  }, format);
  expect(restored).toEqual(saved);
});
for (const accepted of [false, true]) test(`既存名への改名は上書き確認で${accepted ? '承認した時だけ置き換える' : 'キャンセルすれば両方残す'}`, async ({ page }) => {
  await setup(page, 'chaos', true);
  page.on('dialog', dialog => accepted ? dialog.accept() : dialog.dismiss());
  await page.locator('#deckSaveNameInput').fill('改名後');
  await page.locator('#saveDeckButton').click();
  const result = await page.evaluate(() => ({ old: activeDeckCollection()['改名前']?.counts.general_student || null,
    next: activeDeckCollection()['改名後'].counts.general_student }));
  expect(result).toEqual(accepted ? { old: null, next: 40 } : { old: 40, next: 1 });
});
test('保存に失敗したら元デッキと上書き先を失わず、編集を続けられる', async ({ page }) => {
  await setup(page, 'chaos', true);
  page.on('dialog', dialog => dialog.accept());
  await page.evaluate(() => { persistChaosDecks = () => false; });
  await page.locator('#deckSaveNameInput').fill('改名後');
  await page.locator('#saveDeckButton').click();
  await expect(page.locator('#deckEditorView')).toBeVisible();
  expect(await page.evaluate(() => ({ old: activeDeckCollection()['改名前'].counts.general_student,
    next: activeDeckCollection()['改名後'].counts.general_student, editing: state.deckBuilder.editingName })))
    .toEqual({ old: 40, next: 1, editing: '改名前' });
});
test('新規保存は既存デッキを消さず、新しいデッキとして保存する', async ({ page }) => {
  await setup(page, 'chaos');
  await page.evaluate(() => { state.deckBuilder.editingName = ''; });
  await page.locator('#deckSaveNameInput').fill('新規');
  await page.locator('#saveDeckButton').click();
  expect(await page.evaluate(() => ['改名前', '新規'].every(name => !!activeDeckCollection()[name]))).toBe(true);
});
test('選択済みの対戦用デッキ名も改名先へ引き継ぐ', async ({ page }) => {
  await setup(page, 'chaos');
  await page.evaluate(() => {
    Object.assign(state.soloSelection, { ruleId: 'chaos', playerDeckName: '改名前', opponentDeckName: '改名前' });
  });
  await page.locator('#deckSaveNameInput').fill('改名後');
  await page.locator('#saveDeckButton').click();
  expect(await page.evaluate(() => [state.soloSelection.playerDeckName, state.soloSelection.opponentDeckName]))
    .toEqual(['改名後', '改名後']);
});
