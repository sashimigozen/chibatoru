const { test, expect } = require('@playwright/test');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const url = pathToFileURL(path.join(__dirname, '..', 'index.html')).href;
test.setTimeout(30000);
async function setup(page, id) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(url);
  await page.evaluate(id => {
    startCardTest(id);
    scheduleOpponentAI = () => {};
    for (const side of ['player', 'opponent']) {
      state.players[side].will = state.players[side].maxWill = 10;
      state.players[side].trash = [];
      state.players[side].hand = [createCardFromBase('general_student', side), createCardFromBase('ruler', side)];
    }
    state.players.player.hand.unshift(createCardFromBase(id, 'player'));
    render();
  }, id);
  await expect.poll(() => page.evaluate(() => battlePresentationBusy())).toBe(false);
}
test('ちがうよは中央表示と校外移動の後に引き直し、使用カードを二重に廃棄しない', async ({ page }) => {
  await setup(page, 'chigauyo');
  await page.evaluate(() => {
    window.itemOrder = [];
    const draw = redrawHandToCount;
    redrawHandToCount = (...args) => {
      itemOrder.push({ side: args[0], inTrash: state.players.player.trash.some(c => c.baseId === 'chigauyo'), showing: !elements.playRevealOverlay.classList.contains('hidden') });
      return draw(...args);
    };
    castImmediateItem('player', state.players.player.hand[0], true);
  });
  await expect(page.locator('#playRevealCard')).toContainText('ちがうよ');
  expect(await page.evaluate(() => itemOrder.length)).toBe(0);
  expect(await page.evaluate(() => onlineCreateSnapshot().state.remoteResolutionPending)).toBe(true);
  await page.waitForTimeout(400);
  await page.screenshot({ path: test.info().outputPath('item-before-redraw.png') });
  await expect.poll(() => page.evaluate(() => itemOrder.length)).toBe(2);
  expect(await page.evaluate(() => itemOrder.every(entry => entry.inTrash && !entry.showing))).toBe(true);
  await expect(page.locator('.hand-trash-flight')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => battlePresentationBusy())).toBe(false);
  expect(await page.evaluate(() => state.players.player.trash.filter(c => c.baseId === 'chigauyo').length)).toBe(1);
});
test('ハンディジェットエンジンの使用表示の後に手札の校外送りを表示する', async ({ page }) => {
  await setup(page, 'handy_jet_engine');
  await page.evaluate(() => castImmediateItem('player', state.players.player.hand[0], true));
  await expect(page.locator('#playRevealCard')).toContainText('ハンディ');
  expect(await page.evaluate(() => state.players.opponent.hand.length)).toBe(2);
  await expect(page.locator('.hand-trash-flight')).toHaveCount(0);
  await expect(page.locator('.hand-trash-flight')).toHaveCount(3);
  expect(await page.evaluate(() => state.players.player.trash.filter(c => c.baseId === 'handy_jet_engine').length)).toBe(1);
  await expect(page.locator('.hand-trash-flight')).toHaveCount(0);
});
test('装備は対象へ移動してから装備し、校外には送らない', async ({ page }) => {
  await setup(page, 'yuta_umbrella');
  await page.evaluate(() => {
    state.players.player.board.seats[0] = makeBoardCard(createCardFromBase('yuta', 'player'));
    render();
    castItemOnCard('player', state.players.player.hand[0], 'player', 'seat', 0, true);
  });
  await expect(page.locator('#playRevealCard')).toHaveClass(/to-board/);
  expect(await page.evaluate(() => elements.playRevealCard.style.getPropertyValue('--play-target-x'))).not.toBe('');
  await page.waitForTimeout(400);
  await page.screenshot({ path: test.info().outputPath('equipment-destination.png') });
  await expect.poll(() => page.evaluate(() => battlePresentationBusy())).toBe(false);
  expect(await page.evaluate(() => countUtaEquipment(state.players.player.board.seats[0], 'yuta_umbrella'))).toBe(1);
  expect(await page.evaluate(() => state.players.player.trash.length)).toBe(0);
});
test('演出中に画面を離れると遅延した効果は発動しない', async ({ page }) => {
  await setup(page, 'onigiri_draw');
  await page.evaluate(() => { castImmediateItem('player', state.players.player.hand[0], true); state.screen = 'home'; render(); });
  await page.waitForTimeout(1700);
  expect(await page.evaluate(() => state.players.player.hand.length)).toBe(3);
  expect(await page.evaluate(() => pendingItemPresentation)).toBe(null);
});
test('同じ処理で手札を送りドローしても、廃棄の演出を先に完了する', async ({ page }) => {
  await setup(page, 'onigiri_draw');
  await page.evaluate(() => {
    moveHandCardToTrash('player', state.players.player.hand[1], { effectDiscard: true });
    drawUpTo('player', 1);
    render();
  });
  await page.waitForFunction(() => document.querySelector('.hand-trash-flight')?.dataset.trashPhase === 'preview');
  expect(await page.evaluate(() => [...document.querySelectorAll('.draw-flight:not(.hand-trash-flight)')].every(n => n.dataset.drawPhase !== 'preview'))).toBe(true);
  await expect(page.locator('.hand-trash-flight')).toHaveCount(0);
  await page.waitForFunction(() => document.querySelector('.draw-flight')?.dataset.drawPhase === 'preview');
  await expect.poll(() => page.evaluate(() => battlePresentationBusy())).toBe(false);
});
