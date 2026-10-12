const { test, expect } = require('@playwright/test');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const url = pathToFileURL(path.join(__dirname, '..', 'index.html')).href;
test.setTimeout(30000);
async function setup(page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(url);
  await page.evaluate(() => {
    startCardTest('alpha');
    scheduleOpponentAI = () => {};
    state.players.player.hand = [createCardFromBase('alpha', 'player')];
    render();
  });
  await expect.poll(() => page.evaluate(() => battlePresentationBusy())).toBe(false);
}
test('アルファからベータの追加と校外送りが終わるまで自分のターンを維持する', async ({ page }) => {
  await setup(page);
  await page.evaluate(() => finishEndTurn('player'));
  // Above evaluate awaits the returned promise, so inspect the next turn too.
  expect(await page.evaluate(() => state.currentSide)).toBe('opponent');
  expect(await page.evaluate(() => state.players.player.hand.map(c => c.baseId))).toEqual(['beta']);
});
test('講義室チェック中はターンと操作を固定し、ベータを表示する', async ({ page }) => {
  await setup(page);
  await page.evaluate(() => { finishEndTurn('player'); });
  expect(await page.evaluate(() => ({ side: state.currentSide, check: state.lectureRoomCheck, blocked: battleNewActionBlocked() })))
    .toEqual({ side: 'player', check: true, blocked: true });
  expect(await page.evaluate(() => onlineCreateSnapshot().state.remoteResolutionPending)).toBe(true);
  await page.waitForFunction(() => document.querySelector('.hand-add-flight')?.dataset.drawPhase === 'preview');
  await expect(page.locator('.hand-add-flight')).toContainText('ベータ');
  await expect(page.locator('.hand-trash-flight')).toHaveCount(0);
  expect(await page.evaluate(() => state.players.player.trash.filter(c => c.baseId === 'alpha').length)).toBe(1);
  await page.screenshot({ path: test.info().outputPath('beta-hand-add.png') });
  expect(await page.evaluate(() => state.currentSide)).toBe('player');
  await expect.poll(() => page.evaluate(() => state.currentSide)).toBe('opponent');
  await expect(page.locator('.hand-add-flight, .hand-trash-flight')).toHaveCount(0);
});
test('ターン終了を押した直後にボタンが薄くなり、チェック中の再押下を受け付けない', async ({ page }) => {
  await setup(page);
  const button = page.locator('#endTurnButton');
  await expect(button).toBeEnabled();
  await button.click();
  await expect(button).toBeDisabled();
  expect(await button.evaluate(node => getComputedStyle(node).opacity)).toBe('0.5');
  expect(await page.evaluate(() => ({ side: state.currentSide, check: state.lectureRoomCheck })))
    .toEqual({ side: 'player', check: true });
  await button.dispatchEvent('click');
  expect(await page.evaluate(() => state.players.player.trash.filter(c => c.baseId === 'alpha').length)).toBe(1);
  await page.screenshot({ path: test.info().outputPath('end-turn-accepted.png') });
  await expect.poll(() => page.evaluate(() => state.currentSide)).toBe('opponent');
  expect(await page.evaluate(() => state.lectureRoomCheck)).toBe(false);
});
test('操作ロック中は禁止カーソルになり、必要な選択とロック解除時は元に戻る', async ({ page }) => {
  await setup(page);
  await page.mouse.move(710, 700);
  await page.evaluate(() => { showCardPlayAnimation(state.players.player.hand[0], 'trash'); });
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.querySelector('.slot')).cursor)).toBe('not-allowed');
  await expect.poll(() => page.evaluate(() => battlePresentationBusy())).toBe(false);
  await expect.poll(() => page.evaluate(() => document.documentElement.classList.contains('battle-input-blocked'))).toBe(false);
  await page.evaluate(() => { state.pendingRemoteHandTrim = { mode: 'thin_item_keep' }; });
  await expect.poll(() => page.evaluate(() => document.documentElement.classList.contains('battle-input-blocked'))).toBe(true);
  await page.evaluate(() => {
    state.pendingRemoteHandTrim = null;
    openCardChoice({ mode: 'logic_hunter', title: '選択', cards: state.players.player.hand, min: 1, max: 1 });
    render();
  });
  await page.locator('#threeGesturesStage button').first().hover();
  await expect.poll(() => page.evaluate(() => document.documentElement.classList.contains('battle-input-blocked'))).toBe(false);
  await page.evaluate(() => { state.pendingCardChoice = null; state.pendingRemoteHandTrim = { mode: 'thin_item_keep' }; render(); });
  await expect.poll(() => page.evaluate(() => document.documentElement.classList.contains('battle-input-blocked'))).toBe(true);
  await page.evaluate(() => { state.screen = 'home'; render(); });
  await expect.poll(() => page.evaluate(() => document.documentElement.classList.contains('battle-input-blocked'))).toBe(false);
});
test('相手の公開された生成カードはまとめて見せて裏返しながら手札へ入れる', async ({ page }) => {
  await setup(page);
  await page.evaluate(() => {
    state.currentSide = 'opponent';
    state.players.opponent.hand = [createCardFromBase('aggro_army', 'opponent')];
    render();
  });
  await expect.poll(() => page.evaluate(() => battlePresentationBusy())).toBe(false);
  await page.evaluate(() => castImmediateItem('opponent', state.players.opponent.hand[0], true));
  await page.waitForFunction(() => document.querySelectorAll('.hand-add-flight[data-draw-phase="preview"]').length === 3);
  await expect(page.locator('.hand-add-flight')).toContainText(['アグロ大学生', 'アグロキング', 'アグロクイーン']);
  await page.screenshot({ path: test.info().outputPath('opponent-public-generated.png') });
  const snapshot = await page.evaluate(() => onlineCreateSnapshot().state.publicHandAddEvents);
  expect(snapshot.map(e => e.card.baseId)).toEqual(['aggro_student', 'aggro_king', 'aggro_queen']);
  await page.waitForFunction(() => document.querySelector('.hand-add-flight')?.dataset.drawPhase === 'returning');
  expect(await page.evaluate(() => [...document.querySelectorAll('.hand-add-flight')].some(n => n.getAnimations({ subtree: true }).length > 1))).toBe(true);
  await expect.poll(() => page.evaluate(() => battlePresentationBusy())).toBe(false);
  await expect(page.locator('.hand-add-flight')).toHaveCount(0);
});
test('通常の出席者は中央から選んだ出席マスへ移動してから出席する', async ({ page }) => {
  await setup(page);
  await page.evaluate(() => {
    state.players.player.hand = [createCardFromBase('general_student', 'player')];
    state.players.player.board.seats.fill(null);
    state.players.player.will = 10;
    render();
  });
  await expect.poll(() => page.evaluate(() => battlePresentationBusy())).toBe(false);
  await page.evaluate(() => placeCardFromHand('player', state.players.player.hand[0].instanceId, 'seat', 'player', 4, true));
  await expect(page.locator('#playRevealCard')).toHaveClass(/to-board/);
  expect(await page.evaluate(() => state.players.player.board.seats[4])).toBe(null);
  expect(await page.evaluate(() => elements.playRevealCard.style.getPropertyValue('--play-target-x'))).not.toBe('');
  await page.waitForTimeout(400);
  await page.screenshot({ path: test.info().outputPath('attendee-target.png') });
  await expect.poll(() => page.evaluate(() => state.players.player.board.seats[4]?.baseId)).toBe('general_student');
  await expect.poll(() => page.evaluate(() => battlePresentationBusy())).toBe(false);
});
test('生成とデッキから手札に加えるカードを表示し、複数枚をまとめて収める', async ({ page }) => {
  await setup(page);
  await page.evaluate(() => {
    const found = state.players.player.deck.shift();
    state.players.player.hand.push(found, createCardFromBase('yuta', 'player'));
    render(); render();
  });
  await expect(page.locator('.hand-add-flight')).toHaveCount(2);
  await page.waitForFunction(() => [...document.querySelectorAll('.hand-add-flight')].every(n => n.dataset.drawPhase === 'preview'));
  await page.screenshot({ path: test.info().outputPath('generated-hand-add.png') });
  await expect(page.locator('.hand-add-flight')).toHaveCount(0);
});
test('相手が使用した持ち物は中央に表示し、手札廃棄の飛行カードを出さない', async ({ page }) => {
  await setup(page);
  await page.evaluate(() => {
    state.currentSide = 'opponent';
    state.players.opponent.hand = [createCardFromBase('onigiri_draw', 'opponent')];
    render();
  });
  await expect.poll(() => page.evaluate(() => battlePresentationBusy())).toBe(false);
  await page.evaluate(() => castImmediateItem('opponent', state.players.opponent.hand[0], true));
  await expect(page.locator('#playRevealOverlay')).not.toHaveClass(/hidden/);
  await expect(page.locator('#playRevealCard')).toContainText('おにぎり');
  await expect(page.locator('.hand-trash-flight')).toHaveCount(0);
  await page.waitForTimeout(220);
  await page.screenshot({ path: test.info().outputPath('opponent-item-center.png') });
});
test('画面を離れた講義室チェックは次の対戦へ残らない', async ({ page }) => {
  await setup(page);
  await page.evaluate(() => { finishEndTurn('player'); state.screen = 'home'; render(); });
  expect(await page.evaluate(() => state.lectureRoomCheck)).toBe(false);
  await page.evaluate(() => startCardTest('general_student'));
  await expect.poll(() => page.evaluate(() => battlePresentationBusy())).toBe(false);
  expect(await page.evaluate(() => state.lectureRoomCheck)).toBe(false);
});
test('オンラインの公開生成イベントは非公開手札を漏らさず、一度だけ表示する', async ({ page }) => {
  await setup(page);
  const payload = await page.evaluate(() => {
    state.players.player.hand.push(publicHandCard('aggro_student', 'player'));
    const snapshot = onlineCreateSnapshot().state;
    const publicIndex = snapshot.publicHandAddEvents[0].index;
    state.players.player.hand.reverse();
    const again = onlineCreateSnapshot().state;
    onlineRedactSnapshotHand(snapshot, 'player');
    return { events: snapshot.publicHandAddEvents, hidden: snapshot.players.player.hand,
      fixedIndex: again.publicHandAddEvents[0].index === publicIndex };
  });
  expect(payload.hidden.every(c => c.hidden && !c.baseId)).toBe(true);
  expect(payload.fixedIndex).toBe(true);
  await page.evaluate(events => {
    isOnlineGuest = () => true;
    state.players.player.hand = state.players.player.hand.filter(c => c.baseId === 'alpha');
    state.players.opponent.hand = [{ hidden: true }, { hidden: true }];
    state.publicHandAddEvents = events.map(e => ({ ...e, owner: 'opponent', index: 1,
      card: { ...e.card, owner: 'opponent' } }));
    render(); render();
  }, payload.events);
  await expect(page.locator('.hand-add-flight')).toHaveCount(1);
  await expect(page.locator('.hand-add-flight')).toContainText('アグロ大学生');
  await expect.poll(() => page.evaluate(() => battlePresentationBusy())).toBe(false);
  await page.evaluate(() => render());
  await expect(page.locator('.hand-add-flight')).toHaveCount(0);
});
test('ベータからガンマに変わるときも校外送りを重複しない', async ({ page }) => {
  await setup(page);
  await page.evaluate(() => {
    const beta = createCardFromBase('beta', 'player');
    beta.createdActionTurn = state.actionTurn - 1;
    state.players.player.hand = [beta];
    state.players.opponent.board.seats.fill(null);
    render();
  });
  await expect.poll(() => page.evaluate(() => battlePresentationBusy())).toBe(false);
  await page.evaluate(() => { finishEndTurn('player'); });
  await page.waitForFunction(() => document.querySelector('.hand-add-flight')?.dataset.drawPhase === 'preview');
  await expect(page.locator('.hand-trash-flight')).toHaveCount(0);
  await expect(page.locator('.hand-add-flight')).toContainText('ガンマ');
  expect(await page.evaluate(() => state.players.player.trash.filter(c => c.baseId === 'beta').length)).toBe(1);
  await expect.poll(() => page.evaluate(() => state.currentSide)).toBe('opponent');
});
for (const side of ['player', 'opponent']) test(`生成カードは${side}の手札の右端から現れる`, async ({ page }) => {
  await setup(page);
  await page.evaluate(side => {
    state.players[side].hand.push(publicHandCard('aggro_student', side));
    render();
  }, side);
  await page.waitForFunction(() => document.querySelector('.hand-add-flight')?.dataset.drawPhase === 'moving');
  const position = await page.evaluate(side => {
    const ghost = document.querySelector('.hand-add-flight');
    const hand = document.getElementById(side === 'player' ? 'playerHand' : 'opponentHand');
    const rects = [...hand.children].map(node => node.getBoundingClientRect());
    const frames = ghost.getAnimations()[0].effect.getKeyframes();
    const coords = frame => new DOMMatrix(frame.transform);
    const origin = coords(frames[0]), destination = coords(frames.at(-1));
    const generatedIndex = state.players[side].hand.length - 1;
    const target = hand.children[side === 'opponent' ? 0 : generatedIndex].getBoundingClientRect();
    return { x: origin.m41, expectedX: Math.max(...rects.map(r => r.right)) - target.width,
      y: origin.m42, expectedY: target.y, destinationY: destination.m42,
      handTop: Math.min(...rects.map(r => r.top)), handBottom: Math.max(...rects.map(r => r.bottom)),
      deckX: document.getElementById(side === 'player' ? 'playerDeckPile' : 'opponentDeckPile').getBoundingClientRect().x };
  }, side);
  expect(position.x).toBeCloseTo(position.expectedX, 1);
  expect(position.y).toBeCloseTo(position.expectedY, 1);
  expect(Math.abs(position.x - position.deckX)).toBeGreaterThan(30);
  if (side === 'player') expect(position.destinationY).toBeLessThan(position.handTop);
  else expect(position.destinationY).toBeGreaterThan(position.handBottom);
  await page.waitForFunction(() => document.querySelector('.hand-add-flight')?.dataset.drawPhase === 'preview');
  await page.screenshot({ path: test.info().outputPath(`generated-right-${side}.png`) });
  await expect.poll(() => page.evaluate(() => battlePresentationBusy())).toBe(false);
});
