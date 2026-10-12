const { test, expect: baseExpect } = require('@playwright/test');
const expect = baseExpect.configure({ timeout: 25000 });
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const url = pathToFileURL(path.join(__dirname, '..', 'index.html')).href;
test.setTimeout(40000);
test.use({ actionTimeout: 25000 });

async function setup(page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(url);
  await page.evaluate(() => {
    const api = window.__chibattle;
    api.startCardTest('general_student');
    api.state.players.player.hand = [];
    api.state.players.player.deck = ['yuta', 'general_student', 'ae_student'].map(id => api.createCardFromBase(id, 'player'));
    api.state.players.opponent.hand = [];
    api.state.players.opponent.deck = ['dark_yuta'].map(id => api.createCardFromBase(id, 'opponent'));
    render();
  });
  await expect.poll(() => page.evaluate(() => battlePresentationBusy())).toBe(false);
}

test('ドロー開始直後から操作を止め、終了後に操作を戻す', async ({ page }) => {
  await setup(page);
  const id = await page.evaluate(() => {
    const card = createCardFromBase('general_student', 'player');
    state.players.player.hand.push(card);
    drawCards('player', 1, false); render();
    handleHandCardClick(card.instanceId); endTurn();
    return card.instanceId;
  });
  await expect(page.locator('.draw-flight')).toHaveCount(1);
  await page.locator('#endTurnButton').dispatchEvent('click');
  await page.locator('#battleMenuButton').dispatchEvent('click');
  expect(await page.evaluate(() => ({ side: state.currentSide, selected: state.selectedHandId })))
    .toEqual({ side: 'player', selected: null });
  await page.screenshot({ path: test.info().outputPath('input-locked-draw.png') });
  await expect(page.locator('.draw-flight')).toHaveCount(0);
  await page.evaluate(id => handleHandCardClick(id), id);
  expect(await page.evaluate(() => state.selectedHandId)).toBe(id);
});

test('相手の選択待ちでは出席・ターン終了とオンラインコマンドを拒否する', async ({ page }) => {
  await setup(page);
  await page.evaluate(() => { state.players.player.hand.push(createCardFromBase('general_student', 'player')); render(); });
  await expect.poll(() => page.evaluate(() => battlePresentationBusy())).toBe(false);
  const result = await page.evaluate(() => {
    const card = state.players.player.hand[0];
    state.pendingRemoteHandTrim = { requestId: 'thin-test', targetSide: 'opponent' };
    render();
    handleHandCardClick(card.instanceId); playCard(card.instanceId, 'seat', 'player', 0); endTurn();
    const local = { side: state.currentSide, selected: state.selectedHandId, hand: state.players.player.hand.length };
    state.currentSide = 'opponent';
    const rejected = ['play', 'attack', 'endTurn', 'lecture'].every(type => !onlineCanApplyRemoteCommand({ type }));
    const snapshotBusy = onlineCreateSnapshot().state.remoteResolutionPending;
    state.pendingRemoteHandTrim = null;
    const resumed = onlineCanApplyRemoteCommand({ type: 'endTurn' });
    return { local, rejected, snapshotBusy, resumed };
  });
  expect(result).toEqual({ local: { side: 'player', selected: null, hand: 1 }, rejected: true, snapshotBusy: true, resumed: true });
});

test('効果の選択だけ操作でき、裏で手札やターン終了を操作できない', async ({ page }) => {
  await setup(page);
  await page.evaluate(() => {
    const cards = Array.from({ length: 5 }, () => createCardFromBase('general_student', 'player'));
    state.players.player.hand = cards;
    openCardChoice({ mode: 'thin_item_keep', title: '細い', cards, min: 4, max: 4 });
    render();
  });
  await expect.poll(() => page.evaluate(() => battlePresentationBusy())).toBe(false);
  const results = await page.evaluate(() => ({
    choice: battleInputAllowed(document.querySelector('#thinItemKeepConfirmButton')),
    end: battleInputAllowed(document.querySelector('#endTurnButton')),
    hand: battleInputAllowed(document.querySelector('#playerHand'))
  }));
  expect(results).toEqual({ choice: true, end: false, hand: false });
  await page.locator('#endTurnButton').dispatchEvent('click');
  expect(await page.evaluate(() => state.currentSide)).toBe('player');
  for (let i = 0; i < 4; i++) await page.locator('#mulliganHand .mulligan-card').nth(i).click();
  await page.locator('#thinItemKeepConfirmButton').click();
  expect(await page.evaluate(() => state.pendingCardChoice)).toBeNull();
  expect(await page.evaluate(() => state.players.player.hand.length)).toBe(4);
});

test('複数枚をデッキから一度ずつ引き、表を見せて手札へ収める', async ({ page }) => {
  await setup(page);
  await page.evaluate(() => { drawCards('player', 2, false); render(); });
  await expect(page.locator('.draw-flight')).toHaveCount(2);
  await expect(page.locator('.draw-flight-front .card')).toHaveCount(2);
  expect(await page.evaluate(() => state.players.player.hand.map(card => card.baseId))).toEqual(['yuta', 'general_student']);
  expect(await page.evaluate(() => state.players.player.deck.length)).toBe(1);
  await page.waitForFunction(() => document.querySelector('.draw-flight')?.dataset.drawPhase === 'preview');
  await page.screenshot({ path: test.info().outputPath('draw-reveal.png') });
  const positions = await page.locator('.draw-flight').evaluateAll(nodes => nodes.map(node => {
    const rect = node.getBoundingClientRect();
    return { x: rect.x, width: rect.width, height: rect.height };
  }));
  expect(positions[0].width).toBeLessThanOrEqual(120);
  expect(positions[0].x).toBeGreaterThan(850);
  expect(positions[1].x).toBeGreaterThan(positions[0].x + positions[0].width);
  expect(await page.locator('.draw-flight').last().evaluate(node => node.style.opacity)).toBe('1');
  await expect(page.locator('.draw-flight')).toHaveCount(0, { timeout: 25000 });
  await expect(page.locator('#playerHand .card').first()).toBeVisible();
  expect(await page.locator('#playerHand .card').first().evaluate(node => node.style.visibility)).toBe('');
});

for (const count of [1, 3, 5]) test(`${count}枚ドローは${count}枚だけ表示し、再描画でも二重にならない`, async ({ page }) => {
  await setup(page);
  await page.evaluate(count => {
    state.players.player.deck = Array.from({ length: 6 }, () => createCardFromBase('yuta', 'player'));
    drawCards('player', count, false);
    render();
  }, count);
  await expect(page.locator('.draw-flight')).toHaveCount(count);
  await page.evaluate(() => { render(); render(); });
  await expect(page.locator('.draw-flight')).toHaveCount(count);
  expect(await page.locator('#playerHand .card').evaluateAll(nodes => nodes.every(node => node.style.visibility === 'hidden'))).toBe(true);
  await page.waitForFunction(() => document.querySelector('.draw-flight')?.dataset.drawPhase === 'preview');
  if (count === 3) await page.screenshot({ path: test.info().outputPath('three-draw-reveal.png') });
  await expect(page.locator('.draw-flight')).toHaveCount(0, { timeout: 25000 });
  expect(await page.locator('#playerHand .card').evaluateAll(nodes => nodes.every(node => node.style.visibility === ''))).toBe(true);
});

test('マリガンは既存演出のみで新しい飛行カードを出さない', async ({ page }) => {
  await setup(page);
  await page.evaluate(() => { state.phase = 'mulliganDraw'; drawCards('player', 1, false); render(); });
  await page.waitForTimeout(100);
  await expect(page.locator('.draw-flight')).toHaveCount(0, { timeout: 25000 });
  await expect(page.locator('#playerDeckPile')).toHaveClass(/draw-anim/);
});

test('相手のカードは裏向きで、画面を離れると演出も残らない', async ({ page }) => {
  await setup(page);
  await page.evaluate(() => { drawCards('opponent', 1, false); render(); });
  await expect(page.locator('.draw-flight[data-draw-side="opponent"]')).toHaveCount(1);
  await expect(page.locator('.draw-flight-front')).toHaveCount(0);
  expect(await page.locator('.draw-flight').innerHTML()).not.toContain('裏U太');
  await page.evaluate(() => { state.screen = 'home'; render(); });
  await expect(page.locator('.draw-flight')).toHaveCount(0);
});

for (const count of [1, 3]) test(`相手の${count}枚ドローは裏面を拡大せずに移動する`, async ({ page }) => {
  await setup(page);
  await page.evaluate(count => {
    state.players.opponent.deck = Array.from({ length: count }, () => createCardFromBase('dark_yuta', 'opponent'));
    render();
    drawCards('opponent', count, false);
    render();
  }, count);
  await expect(page.locator('.draw-flight')).toHaveCount(count);
  await expect(page.locator('.draw-flight-front')).toHaveCount(0);
  const sizes = await page.evaluate(() => {
    const deck = elements.opponentDeckPile.getBoundingClientRect();
    return [...document.querySelectorAll('.draw-flight')].map(ghost => ({
      width: parseFloat(ghost.style.width), deckWidth: deck.width
    }));
  });
  for (const size of sizes) {
    expect(size.width).toBeLessThanOrEqual(size.deckWidth);
    expect(size.width).toBeLessThan(100);
  }
  await page.waitForFunction(() => document.querySelector('.draw-flight')?.dataset.drawPhase === 'preview');
  await page.screenshot({ path: test.info().outputPath(`opponent-compact-${count}.png`) });
  await expect.poll(() => page.evaluate(() => battlePresentationBusy())).toBe(false);
  expect(await page.evaluate(() => state.players.opponent.hand.length)).toBe(count);
});

test('動きを減らす設定では演出せず、ドロー処理は変わらない', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await setup(page);
  await page.evaluate(() => { drawCards('player', 2, false); render(); });
  await expect(page.locator('.draw-flight')).toHaveCount(0);
  await expect(page.locator('#playerHand .card')).toHaveCount(2);
});

test('オンライン更新からドローと手札生成を別々に表示する', async ({ page }) => {
  await setup(page);
  await page.evaluate(() => {
    state.phase = 'battle';
    const before = captureOnlineVisualState();
    drawCards('player', 2, false);
    pendingAnimations.length = 0;
    render();
    showOnlineSnapshotVisuals(before);
  });
  await expect(page.locator('.draw-flight-front')).toHaveCount(2);
  await expect(page.locator('.draw-flight')).toHaveCount(0);
  await page.evaluate(() => {
    const before = captureOnlineVisualState();
    state.players.player.hand.push(createCardFromBase('ae_student', 'player'));
    render();
    showOnlineSnapshotVisuals(before);
  });
  await expect(page.locator('.hand-add-flight')).toHaveCount(1);
  await expect(page.locator('.draw-flight')).toHaveCount(0);
});

test('非公開手札のオンライン更新は枚数だけで裏面を動かす', async ({ page }) => {
  await setup(page);
  await page.evaluate(() => {
    state.phase = 'battle';
    const before = captureOnlineVisualState();
    state.players.opponent.deck.shift();
    state.players.opponent.hand.push({ hidden: true });
    render();
    showOnlineSnapshotVisuals(before);
  });
  await expect(page.locator('.draw-flight')).toHaveCount(1);
  await expect(page.locator('.draw-flight-front')).toHaveCount(0);
  await expect(page.locator('.draw-flight')).toHaveCount(0);
});

test('カードの使用演出が終わるまでドローを表示しない', async ({ page }) => {
  await setup(page);
  await page.evaluate(() => {
    showCardPlayAnimation(createCardFromBase('onigiri_draw', 'player'), 'trash');
    drawCards('player', 1, false);
    render();
  });
  await expect(page.locator('.draw-flight')).toHaveCount(1);
  await expect(page.locator('#playRevealOverlay')).not.toHaveClass(/hidden/);
  expect(await page.locator('.draw-flight').evaluate(node => node.style.opacity)).toBe('0');
  await page.waitForFunction(() => document.querySelector('.draw-flight')?.dataset.drawPhase === 'moving');
  await expect(page.locator('#playRevealOverlay')).toHaveClass(/hidden/);
  await expect(page.locator('.draw-flight')).toHaveCount(0);
});

test('移動とめくりが同時に進み、到着時には表向きになる', async ({ page }) => {
  await setup(page);
  await page.evaluate(() => { drawCards('player', 1, false); render(); });
  await expect(page.locator('.draw-flight')).toHaveAttribute('data-draw-phase', 'moving');
  await page.waitForTimeout(100);
  const progress = await page.locator('.draw-flight').evaluate(node => ({
    phase: node.dataset.drawPhase,
    move: node.getAnimations()[0]?.currentTime,
    turn: node.firstElementChild.getAnimations()[0]?.effect.getComputedTiming().progress
  }));
  expect(progress.phase).toBe('moving');
  expect(progress.move).toBeLessThan(360);
  expect(progress.turn).toBeGreaterThan(0);
  expect(progress.turn).toBeLessThan(1);
  await page.screenshot({ path: test.info().outputPath('draw-moving-turn.png') });
  await expect(page.locator('.draw-flight')).toHaveAttribute('data-draw-phase', 'preview');
  const end = await page.locator('.draw-flight-turn').evaluate(node => new DOMMatrix(getComputedStyle(node).transform).m11);
  expect(end).toBeCloseTo(-1, 2);
  await expect(page.locator('.draw-flight')).toHaveCount(0);
});

test('TRPGの3枚は同時にめくって並べ、同時に手札へ収める', async ({ page }) => {
  await setup(page);
  await page.evaluate(() => {
    const card = makeBoardCard(createCardFromBase('trpg_member', 'player'));
    showCardPlayAnimation(card, 'board');
    attendCard('player', card, 'seat', 0, { attendanceSource: ATTENDANCE_SOURCE.HAND });
    render();
  });
  await expect(page.locator('.draw-flight')).toHaveCount(3);
  await page.waitForFunction(() => document.querySelectorAll('.draw-flight[data-draw-phase="moving"]').length === 3);
  await expect(page.locator('#playRevealOverlay')).toHaveClass(/hidden/);
  await page.waitForTimeout(100);
  const turns = await page.locator('.draw-flight-turn').evaluateAll(nodes => nodes.map(node => node.getAnimations()[0].effect.getComputedTiming().progress));
  expect(turns.every(progress => progress > 0 && progress <= 1)).toBe(true);
  expect(Math.max(...turns) - Math.min(...turns)).toBeLessThan(.05);
  await page.waitForFunction(() => document.querySelectorAll('.draw-flight[data-draw-phase="preview"]').length === 3);
  await page.screenshot({ path: test.info().outputPath('trpg-three-draw.png') });
  await page.waitForFunction(() => document.querySelectorAll('.draw-flight[data-draw-phase="returning"]').length === 3);
  expect(await page.locator('#playerHand .card').evaluateAll(nodes => nodes.every(node => node.style.visibility === 'hidden'))).toBe(true);
  await expect(page.locator('.draw-flight')).toHaveCount(0);
  expect(await page.locator('#playerHand .card').count()).toBe(3);
  expect(await page.locator('#playerHand .card').evaluateAll(nodes => nodes.every(node => node.style.visibility === ''))).toBe(true);
});

test('効果の表示終了後にドローし、相手側は気力の隣に表示する', async ({ page }) => {
  await setup(page);
  await page.evaluate(() => {
    showFloatingTextForLife('opponent', '-1', 'damage');
    drawCards('opponent', 1, false);
    render();
  });
  await expect(page.locator('.draw-flight')).toHaveCount(1);
  await page.waitForTimeout(800);
  expect(await page.locator('.draw-flight').evaluate(node => node.style.opacity)).toBe('0');
  await page.waitForFunction(() => document.querySelector('.draw-flight')?.dataset.drawPhase === 'preview');
  await expect(page.locator('.floating-pop')).toHaveCount(0);
  const bounds = await page.locator('.draw-flight').boundingBox();
  const life = await page.locator('#opponentLifeTarget').boundingBox();
  expect(bounds.x).toBeGreaterThan(life.x + life.width);
  expect(Math.abs(bounds.y - life.y)).toBeLessThan(2);
  await page.screenshot({ path: test.info().outputPath('opponent-draw.png') });
});
