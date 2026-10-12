const { test, expect } = require('@playwright/test');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const url = pathToFileURL(path.join(__dirname, '..', 'index.html')).href;
test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(url);
  await page.evaluate(() => {
    startCardTest('general_student');
    for (const side of ['player', 'opponent']) {
      state.players[side].hand = [];
      state.players[side].trash = [];
      state.players[side].deck = Array.from({ length: 15 }, () => createCardFromBase('yuta', side));
    }
    render();
  });
  await expect.poll(() => page.evaluate(() => battlePresentationBusy())).toBe(false);
});

for (const side of ['player', 'opponent']) {
  for (const count of [3, 12]) {
    test(`${side}のデッキ${count}枚を公開して校外へ送る`, async ({ page }) => {
      await page.evaluate(({ side, count }) => { moveTopDeckCardsToTrash(side, count); render(); render(); }, { side, count });
      const flights = page.locator('.deck-trash-flight');
      await expect(flights).toHaveCount(count);
      await expect(page.locator('.hand-trash-flight')).toHaveCount(0);
      await page.waitForFunction(() => document.querySelector('.deck-trash-flight')?.dataset.trashPhase === 'preview');
      const rects = await flights.evaluateAll(nodes => nodes.map(node => {
        const rect = node.getBoundingClientRect();
        return { x: rect.x, y: rect.y, right: rect.right, bottom: rect.bottom,
          face: new DOMMatrix(getComputedStyle(node.firstElementChild).transform).m11 };
      }));
      for (const rect of rects) {
        expect(rect.face).toBeCloseTo(-1, 2);
        expect(rect.x).toBeGreaterThanOrEqual(0);
        expect(rect.y).toBeGreaterThanOrEqual(0);
        expect(rect.right).toBeLessThanOrEqual(1440);
        expect(rect.bottom).toBeLessThanOrEqual(900);
      }
      expect(new Set(rects.map(rect => `${Math.round(rect.x)},${Math.round(rect.y)}`)).size).toBe(count);
      expect(await page.evaluate(() => battleNewActionBlocked())).toBe(true);
      await page.locator('#endTurnButton').dispatchEvent('click');
      expect(await page.evaluate(() => state.currentSide)).toBe('player');
      await page.screenshot({ path: test.info().outputPath(`${side}-${count}-deck-trash.png`) });
      await expect(flights).toHaveCount(0);
      expect(await page.evaluate(side => ({ deck: state.players[side].deck.length, trash: state.players[side].trash.length }), side))
        .toEqual({ deck: 15 - count, trash: count });
      await page.evaluate(() => render());
      await expect(flights).toHaveCount(0);
    });
  }
}

test('Dos攻撃の使用表示が終わってから3枚を公開する', async ({ page }) => {
  await page.evaluate(() => {
    const item = createCardFromBase('dos_attack', 'player');
    state.players.player.hand = [item]; render();
  });
  await expect.poll(() => page.evaluate(() => battlePresentationBusy())).toBe(false);
  await page.evaluate(() => { castImmediateItem('player', state.players.player.hand[0]); render(); });
  await expect(page.locator('#playRevealOverlay')).toBeVisible();
  await expect(page.locator('.deck-trash-flight')).toHaveCount(3);
  await page.waitForFunction(() => document.querySelector('.deck-trash-flight')?.dataset.trashPhase === 'moving');
  await expect(page.locator('#playRevealOverlay')).toHaveClass(/hidden/);
  await expect(page.locator('.deck-trash-flight')).toHaveCount(0);
  expect(await page.evaluate(() => state.players.opponent.trash.length)).toBe(3);
});

test('非公開のオンラインデッキは校外へ送ったカードだけを表示する', async ({ page }) => {
  await page.evaluate(() => {
    state.players.opponent.deck = Array.from({ length: 15 }, () => ({ hidden: true }));
    render();
    const card = createCardFromBase('dark_yuta', 'opponent');
    card.trashFromDeck = true;
    state.players.opponent.deck.pop(); state.players.opponent.trash.push(card);
    render(); render();
  });
  await expect(page.locator('.deck-trash-flight')).toHaveCount(1);
  await expect(page.locator('.deck-trash-flight .draw-flight-front')).toContainText('裏U太');
  expect(await page.evaluate(() => state.players.opponent.deck.every(card => card.hidden))).toBe(true);
  await expect(page.locator('.deck-trash-flight')).toHaveCount(0);
});

test('演出省略時は移動処理のみを実行する', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.evaluate(() => { moveTopDeckCardsToTrash('player', 3); render(); });
  await expect(page.locator('.deck-trash-flight')).toHaveCount(0);
  expect(await page.evaluate(() => state.players.player.trash.length)).toBe(3);
});

test('ホストの校外送りをゲストのデッキ位置から表示する', async ({ page }) => {
  await page.evaluate(() => {
    state.online.enabled = true;
    state.online.role = 'host';
    state.online.started = true;
    const before = onlineCreateSnapshot();
    moveTopDeckCardsToTrash('opponent', 3);
    const after = onlineCreateSnapshot();
    state.online.role = 'guest';
    onlineHandleMessage({ type: 'gameState', protocol: 1, snapshot: { ...before, seq: state.online.lastSnapshotSeq + 1 } });
    onlineHandleMessage({ type: 'gameState', protocol: 1, snapshot: { ...after, seq: state.online.lastSnapshotSeq + 1 } });
  });
  await expect(page.locator('.deck-trash-flight[data-trash-side="player"]')).toHaveCount(3);
  await expect(page.locator('.hand-trash-flight')).toHaveCount(0);
  await expect(page.locator('.deck-trash-flight')).toHaveCount(0);
});

test('画面を離れると校外送りの演出と操作ロックを残さない', async ({ page }) => {
  await page.evaluate(() => { moveRandomDeckCardsToTrash('player', 3); render(); });
  await expect(page.locator('.deck-trash-flight')).toHaveCount(3);
  await page.evaluate(() => { state.screen = 'home'; render(); });
  await expect(page.locator('.deck-trash-flight')).toHaveCount(0);
  expect(await page.evaluate(() => window.ChibattleHandTrash.isBusy())).toBe(false);
});
