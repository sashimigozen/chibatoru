const { test, expect } = require('@playwright/test');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const url = pathToFileURL(path.join(__dirname, '..', 'index.html')).href;

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(url);
  await page.evaluate(() => {
    startCardTest('general_student'); scheduleOpponentAI = () => {};
    state.players.player.hand = ['general_student', 'ruler'].map(id => createCardFromBase(id, 'player'));
    for (const side of ['player', 'opponent']) {
      state.players[side].board.seats.fill(null); state.players[side].board.teacher = null;
      for (const index of [0, 1]) {
        const card = makeBoardCard(createCardFromBase('general_student', side));
        card.playedOnTurn = state.actionTurn - 1; state.players[side].board.seats[index] = card;
      }
    }
    render();
  });
  await expect.poll(() => page.evaluate(() => battlePresentationBusy())).toBe(false);
});

async function holdPresentation(page) {
  await page.evaluate(() => { showCardPlayAnimation(state.players.player.hand[1], 'trash'); clearTimeout(playRevealTimer); });
}

async function liftCard(page) {
  const rect = await page.locator('#playerHand .card').first().boundingBox();
  await page.mouse.move(rect.x + rect.width / 2, rect.y + 25);
  await page.mouse.down();
  await page.mouse.move(rect.x + rect.width / 2 + 45, rect.y - 80, { steps: 6 });
  await expect(page.locator('.drag-ghost-card')).toHaveCount(1);
  expect(await page.evaluate(() => getComputedStyle(document.body).cursor)).toBe('grabbing');
}

test('演出中はカードを持てるが、離しても出席・使用や予約はしない', async ({ page }) => {
  await holdPresentation(page);
  const before = await page.evaluate(() => ({ hand: state.players.player.hand.map(c => c.instanceId), will: state.players.player.will }));
  await liftCard(page);
  const slot = await page.locator('#playerSeatGrid .slot[data-index="2"]').boundingBox();
  await page.mouse.move(slot.x + slot.width / 2, slot.y + slot.height / 2, { steps: 8 });
  await page.screenshot({ path: test.info().outputPath('holding-during-presentation.png') });
  await page.mouse.up();
  await expect(page.locator('.drag-ghost-card')).toHaveCount(0);
  expect(await page.evaluate(() => ({ hand: state.players.player.hand.map(c => c.instanceId), will: state.players.player.will }))).toEqual(before);
  expect(await page.evaluate(() => state.players.player.board.seats[2])).toBeNull();
  expect(await page.evaluate(() => playerActionReservation?.attacks.length || 0)).toBe(0);
  expect(await page.evaluate(() => document.documentElement.classList.contains('hand-card-dragging'))).toBe(false);
});

test('持っている間に演出が終われば、その後のドロップは通常の出席になる', async ({ page }) => {
  await holdPresentation(page); await liftCard(page);
  await page.evaluate(() => { hidePlayReveal(); render(); });
  const slot = await page.locator('#playerSeatGrid .slot[data-index="2"]').boundingBox();
  await page.mouse.move(slot.x + slot.width / 2, slot.y + slot.height / 2, { steps: 8 });
  await page.mouse.up();
  await expect.poll(() => page.evaluate(() => state.players.player.board.seats[2]?.baseId)).toBe('general_student');
});

test('持っていたカードが手札から消えたらドラッグを解除する', async ({ page }) => {
  await holdPresentation(page); await liftCard(page);
  await page.evaluate(() => { state.players.player.hand.shift(); render(); });
  await expect(page.locator('.drag-ghost-card')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.classList.contains('hand-card-dragging'))).toBe(false);
  await page.mouse.up();
});

test('演出中に次の攻撃とターン終了を予約し、攻撃後にターンを返す', async ({ page }) => {
  await holdPresentation(page);
  await page.locator('#playerSeatGrid .board-card[data-index="1"]').click();
  await page.locator('#opponentSeatGrid .board-card[data-index="1"]').click();
  expect(await page.evaluate(() => playerActionReservation?.attacks.length)).toBe(1);
  await page.locator('#endTurnButton').click();
  await expect(page.locator('#endTurnButton')).toHaveText('ターン終了');
  await expect(page.locator('#endTurnButton')).toHaveClass(/turn-end-reserved/);
  expect(await page.evaluate(() => state.players.opponent.board.seats[1].currentHp)).toBe(2);
  await page.evaluate(() => { hidePlayReveal(); render(); });
  await expect.poll(() => page.evaluate(() => state.currentSide), { timeout: 15000 }).toBe('opponent');
  expect(await page.evaluate(() => state.players.opponent.board.seats[1])).toBeNull();
});

test('実際の攻撃中にも別の出席者と攻撃先を予約できる', async ({ page }) => {
  await page.evaluate(() => { state.selectedAttacker = { owner: 'player', zone: 'seat', index: 0 }; void attackCard('opponent', 'seat', 0); });
  expect(await page.evaluate(() => state.attackInProgress)).toBe(true);
  await page.locator('#playerSeatGrid .board-card[data-index="1"]').click();
  await page.locator('#opponentSeatGrid .board-card[data-index="1"]').click();
  await expect.poll(() => page.evaluate(() => state.players.opponent.board.seats[1]), { timeout: 15000 }).toBeNull();
  expect(await page.evaluate(() => state.players.opponent.board.seats[0])).toBeNull();
});

test('複数の攻撃予約を選んだ順に実行してからターン終了する', async ({ page }) => {
  await holdPresentation(page);
  for (const index of [1, 0]) {
    await page.locator(`#playerSeatGrid .board-card[data-index="${index}"]`).click();
    await page.locator(`#opponentSeatGrid .board-card[data-index="${index}"]`).click();
  }
  expect(await page.evaluate(() => playerActionReservation.attacks.map(action => action.attacker.index))).toEqual([1, 0]);
  await page.locator('#endTurnButton').click();
  await page.evaluate(() => { hidePlayReveal(); render(); });
  await expect.poll(() => page.evaluate(() => state.currentSide), { timeout: 15000 }).toBe('opponent');
  expect(await page.evaluate(() => state.players.opponent.board.seats.slice(0, 2))).toEqual([null, null]);
});

test('予約した相手が消えて同じマスに別カードが来ても攻撃しない', async ({ page }) => {
  await holdPresentation(page);
  await page.locator('#playerSeatGrid .board-card[data-index="1"]').click();
  await page.locator('#opponentSeatGrid .board-card[data-index="1"]').click();
  await page.evaluate(() => { state.players.opponent.board.seats[1] = makeBoardCard(createCardFromBase('yuta', 'opponent')); hidePlayReveal(); render(); });
  await expect.poll(() => page.evaluate(() => playerActionReservation)).toBeNull();
  expect(await page.evaluate(() => state.players.opponent.board.seats[1].currentHp)).toBe(3);
  expect(await page.evaluate(() => state.players.player.board.seats[1].hasAttacked)).toBe(false);
});

test('先の予約で注目を倒してから本体へ攻撃する予約も受け付ける', async ({ page }) => {
  await page.evaluate(() => { state.players.opponent.board.seats[0].keywords = ['注目']; render(); });
  await holdPresentation(page);
  await page.locator('#playerSeatGrid .board-card[data-index="0"]').click();
  await page.locator('#opponentSeatGrid .board-card[data-index="0"]').click();
  await page.locator('#playerSeatGrid .board-card[data-index="1"]').click();
  await page.locator('[data-life-target="opponent"]').click();
  expect(await page.evaluate(() => playerActionReservation.attacks.length)).toBe(2);
  await page.evaluate(() => { hidePlayReveal(); render(); });
  await expect.poll(() => page.evaluate(() => state.players.opponent.life), { timeout: 15000 }).toBe(18);
});

test('必要な選択が出たら予約を待機し、終了予約は再押下で取り消せる', async ({ page }) => {
  await holdPresentation(page);
  await page.locator('#endTurnButton').click();
  await page.locator('#endTurnButton').click();
  expect(await page.evaluate(() => playerActionReservation.endTurn)).toBe(false);
  await page.locator('#endTurnButton').click();
  await page.evaluate(() => { hidePlayReveal(); state.pendingRemoteHandTrim = { mode: 'thin_item_keep' }; render(); });
  await page.waitForTimeout(350);
  expect(await page.evaluate(() => state.currentSide)).toBe('player');
  await page.evaluate(() => { state.pendingRemoteHandTrim = null; render(); });
  await expect.poll(() => page.evaluate(() => state.currentSide)).toBe('opponent');
});

test('ゲストの攻撃予約は前の同期と演出が終わってから一度だけ送る', async ({ page }) => {
  await page.evaluate(() => {
    state.online.role = 'guest'; state.remoteResolutionPending = true;
    onlineCanSendCommand = () => true;
    window.reservationCommands = [];
    onlineSendCommand = (type, payload) => {
      window.reservationCommands.push({ type, payload });
      state.remoteResolutionPending = true;
    };
    render();
  });
  await page.locator('#playerSeatGrid .board-card[data-index="1"]').click();
  await page.locator('#opponentSeatGrid .board-card[data-index="1"]').click();
  await page.waitForTimeout(250);
  expect(await page.evaluate(() => window.reservationCommands)).toEqual([]);
  await page.evaluate(() => { state.remoteResolutionPending = false; render(); });
  await expect.poll(() => page.evaluate(() => window.reservationCommands.length)).toBe(1);
  await page.waitForTimeout(250);
  expect(await page.evaluate(() => window.reservationCommands)).toEqual([
    { type: 'attackCard', payload: { attacker: { owner: 'player', zone: 'seat', index: 1 }, target: { owner: 'opponent', zone: 'seat', index: 1 } } }
  ]);
});
