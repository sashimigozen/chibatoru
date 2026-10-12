const { test, expect } = require('@playwright/test');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const url = pathToFileURL(path.join(__dirname, '..', 'index.html')).href;

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(url);
  await page.evaluate(() => {
    startCardTest('general_student'); scheduleOpponentAI = () => {};
    for (const side of ['player', 'opponent']) {
      state.players[side].board.seats.fill(null);
      for (const index of [6, 7]) {
        const card = makeBoardCard(createCardFromBase('general_student', side));
        card.playedOnTurn = state.actionTurn - 1;
        state.players[side].board.seats[index] = card;
      }
    }
    render();
  });
  await expect.poll(() => page.evaluate(() => battlePresentationBusy())).toBe(false);
});

test('攻撃役と予約の攻撃役は選択中だけ拡大し、マスは動かない', async ({ page }) => {
  const card = page.locator('#playerSeatGrid .board-card[data-index="6"]');
  const slot = page.locator('#playerSeatGrid .slot[data-index="6"]');
  const before = await card.boundingBox();
  const slotBefore = await slot.boundingBox();
  await card.click();
  expect((await card.boundingBox()).width / before.width).toBeCloseTo(1.08, 2);
  expect(await slot.boundingBox()).toEqual(slotBefore);
  await page.screenshot({ path: test.info().outputPath('selected-attacker.png') });
  await page.evaluate(() => { clearSelections(); queuedBattlePresentations++; render(); });
  await card.click();
  await expect(card).toHaveClass(/selected/);
  expect((await card.boundingBox()).width / before.width).toBeCloseTo(1.08, 2);
  await page.locator('#opponentSeatGrid .board-card[data-index="6"]').click();
  await expect(card).not.toHaveClass(/selected/);
  expect((await card.boundingBox()).width).toBeCloseTo(before.width, 2);
});

test('効果で選んだ相手だけ拡大し、選択解除で元に戻る', async ({ page }) => {
  await page.evaluate(() => {
    const item = createCardFromBase('i_got_it', 'player');
    state.players.player.hand = [item];
    state.selectedHandId = item.instanceId;
    state.pendingMultiItem = { itemId: item.instanceId, targets: [], maxTargets: 2 };
    render();
  });
  await expect.poll(() => page.evaluate(() => battlePresentationBusy())).toBe(false);
  const selected = page.locator('#opponentSeatGrid .board-card[data-index="6"]');
  const candidate = page.locator('#opponentSeatGrid .board-card[data-index="7"]');
  const before = await selected.boundingBox();
  const otherBefore = await candidate.boundingBox();
  await selected.click();
  await expect(selected).toHaveClass(/selected/);
  expect((await selected.boundingBox()).width / before.width).toBeCloseTo(1.08, 2);
  expect(await candidate.boundingBox()).toEqual(otherBefore);
  await page.screenshot({ path: test.info().outputPath('selected-effect-target.png') });
  await selected.click();
  await expect(selected).not.toHaveClass(/selected/);
  expect((await selected.boundingBox()).width).toBeCloseTo(before.width, 2);
});

for (const pending of ['pendingPanpanItem', 'pendingDestroyItem', 'pendingKingGhidorahBed']) {
  test(`${pending}の指名中も同じ倍率`, async ({ page }) => {
    await page.evaluate(pending => {
      const ref = { owner: 'opponent', zone: 'seat', index: 6 };
      state[pending] = pending === 'pendingPanpanItem' ? { enemy: ref } : { target: ref };
      render();
    }, pending);
    const card = page.locator('#opponentSeatGrid .board-card[data-index="6"]');
    await expect(card).toHaveClass(/selected/);
    expect(await card.evaluate(el => getComputedStyle(el).scale)).toBe('1.08');
  });
}
