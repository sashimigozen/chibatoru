const { test, expect } = require('@playwright/test');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const url = pathToFileURL(path.join(__dirname, '..', 'index.html')).href;
async function setup(page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(url);
  await page.evaluate(() => {
    startCardTest('general_student');
    for (const side of ['player', 'opponent']) {
      state.players[side].hand = ['yuta', 'general_student', 'ruler'].map(id => createCardFromBase(id, side));
      state.players[side].trash = [];
    }
    render();
  });
  await expect.poll(() => page.evaluate(() => battlePresentationBusy())).toBe(false);
}
for (const side of ['player', 'opponent']) test(`${side}の手札2枚を同時に公開し校外へ送る`, async ({ page }) => {
  await setup(page);
  const before = await page.locator(side === 'player' ? '#playerHand .card' : '#opponentHand > *').first().boundingBox();
  await page.evaluate(side => {
    state.players[side].hand.slice(0, 2).forEach(card => moveHandCardToTrash(side, card, { effectDiscard: true }));
    render(); render();
  }, side);
  const flights = page.locator(`.hand-trash-flight[data-trash-side="${side}"]`);
  await expect(flights).toHaveCount(2);
  await page.waitForFunction(side => document.querySelector(`.hand-trash-flight[data-trash-side="${side}"]`)?.dataset.trashPhase === 'preview', side);
  const boxes = await flights.evaluateAll(nodes => nodes.map(node => {
    const rect = node.getBoundingClientRect();
    return { y: rect.y, transform: node.firstElementChild.getBoundingClientRect().width, width: rect.width };
  }));
  expect(boxes.every(box => side === 'player' ? box.y < before.y : box.y > before.y)).toBe(true);
  expect(boxes.every(box => box.transform > box.width * .9)).toBe(true);
  await page.screenshot({ path: test.info().outputPath(`${side}-trash-preview.png`) });
  expect(await page.evaluate(() => battleNewActionBlocked())).toBe(true);
  await page.locator('#endTurnButton').dispatchEvent('click');
  expect(await page.evaluate(() => state.currentSide)).toBe('player');
  await expect(flights).toHaveCount(0);
  expect(await page.evaluate(side => ({ hand: state.players[side].hand.length, trash: state.players[side].trash.length }), side)).toEqual({ hand: 1, trash: 2 });
});
test('オンラインの非公開手札は校外へ送られたカードだけ公開する', async ({ page }) => {
  await setup(page);
  await page.evaluate(() => {
    state.players.opponent.hand = [{ hidden: true }, { hidden: true }, { hidden: true }]; render();
    const card = createCardFromBase('dark_yuta', 'opponent');
    card.trashFromHand = true;
    state.players.opponent.hand.pop(); state.players.opponent.trash.push(card); render();
  });
  await expect(page.locator('.hand-trash-flight')).toHaveCount(1);
  await expect(page.locator('.hand-trash-flight .draw-flight-front')).toContainText('裏U太');
  expect(await page.evaluate(() => state.players.opponent.hand.every(card => card.hidden))).toBe(true);
  await expect(page.locator('.hand-trash-flight')).toHaveCount(0);
});
test('盤面からの校外送りやデッキからの校外送りは手札演出を出さない', async ({ page }) => {
  await setup(page);
  await page.evaluate(() => { moveToTrash('player', createCardFromBase('ae_student', 'player'), { sourceZone: 'deck' }); render(); });
  await expect(page.locator('.hand-trash-flight')).toHaveCount(0);
});

for (const sourceSide of ['player', 'opponent']) {
  for (const baseId of ['logic_hunter', 'sniper']) {
    test(`${sourceSide}の${baseId}は公開済みの校外送りを二重に再生しない`, async ({ page }) => {
      await setup(page);
      await page.evaluate(({ sourceSide, baseId }) => {
        window.duplicateTrashFlightSeen = false;
        window.trashFlightObserver = new MutationObserver(() => {
          if (document.querySelector('.hand-trash-flight')) window.duplicateTrashFlightSeen = true;
        });
        window.trashFlightObserver.observe(document.body, { childList: true, subtree: true });
        const source = createCardFromBase(baseId, sourceSide);
        if (baseId === 'logic_hunter') {
          const targetSide = oppositeSide(sourceSide);
          const chosen = state.players[targetSide].hand[0];
          discardOpponentHandCardById(sourceSide, chosen.instanceId, source, false);
        } else {
          resolveAttendEffects(sourceSide, source, 'seat', 0, { attendanceSource: ATTENDANCE_SOURCE.HAND });
        }
        render();
        render();
      }, { sourceSide, baseId });
      await expect(page.locator('#playRevealOverlay')).toBeVisible();
      await expect(page.locator('#playRevealCard')).toHaveClass(/to-trash/);
      if (sourceSide === 'player' && baseId === 'logic_hunter') {
        await page.waitForTimeout(400);
        await page.screenshot({ path: test.info().outputPath('logic-hunter-single-reveal.png') });
      }
      await expect.poll(() => page.evaluate(() => battlePresentationBusy())).toBe(false);
      expect(await page.evaluate(sourceSide => {
        const target = state.players[oppositeSide(sourceSide)];
        return { hand: target.hand.length, trash: target.trash.length,
          repeat: window.duplicateTrashFlightSeen, generic: target.trash[0].trashFromHand };
      }, sourceSide)).toEqual({ hand: 2, trash: 1, repeat: false, generic: false });
    });
  }
}
