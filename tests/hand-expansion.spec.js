const {test, expect} = require('@playwright/test');
const {pathToFileURL} = require('node:url');
const path = require('node:path');

async function prepare(page, width = 1440, height = 960) {
  await page.setViewportSize({width, height});
  await page.goto(pathToFileURL(path.join(__dirname, '..', 'index.html')).href);
  await page.evaluate(() => {
    startCardTest('ruler'); scheduleOpponentAI = () => {};
    state.phase = 'battle'; state.currentSide = 'player'; state.training.skipAnimations = true;
    for (const side of ['player', 'opponent']) Object.assign(state.players[side], {
      board: {teacher:null, seats:Array(9).fill(null)}, hand:[], deck:[], trash:[], will:20, maxWill:20
    });
    state.players.player.hand = ['ruler','ruler','general_student','yuta','tissue_distributor','cafeteria','ttb','uma_bone','front_door','aggro_king'].map(id => createCardFromBase(id, 'player'));
    render();
  });
  await expect.poll(() => page.evaluate(() => battlePresentationBusy())).toBe(false);
}

async function expand(page) {
  const card = page.locator('#playerHand .hand-card').first();
  const box = await card.boundingBox();
  await page.mouse.move(box.x + 15, box.y + 45);
  await page.mouse.down();
  await expect(page.locator('#handExpandPrompt')).toBeVisible();
  await page.mouse.up();
  await expect(page.locator('#handExpandCount')).toHaveText('手札 10枚');
  await page.locator('#handExpandButton').click();
  await expect(page.locator('#expandedHandPanel')).toBeVisible();
}

test('長押しから拡大し、元のカードと枚数を保って外側クリックで戻る', async ({page}) => {
  await prepare(page);
  const ids = await page.locator('#playerHand .hand-card').evaluateAll(cards => cards.map(c => c.dataset.cardId));
  await expand(page);
  expect(await page.locator('#expandedHandPanel .hand-card').evaluateAll(cards => cards.map(c => c.dataset.cardId))).toEqual(ids);
  const boxes = await page.locator('#playerHand .hand-card').evaluateAll(cards => cards.map(c => c.getBoundingClientRect().toJSON()));
  for (let i = 1; i < boxes.length; i++) expect(boxes[i].left).toBeGreaterThanOrEqual(boxes[i-1].right);
  await page.screenshot({path:test.info().outputPath('expanded-desktop.png')});
  await page.locator('#battleLogButton').click();
  await expect(page.locator('#expandedHandPanel')).toBeHidden();
  await expect(page.locator('.player-hand-table #playerHand .hand-card')).toHaveCount(10);
});

test('拡大した実カードをドラッグして融合でき、枚数も更新される', async ({page}) => {
  await prepare(page); await expand(page);
  const cards = page.locator('#playerHand .hand-card');
  const source = await cards.nth(0).boundingBox(), target = await cards.nth(1).boundingBox();
  await page.mouse.move(source.x+45, source.y+65); await page.mouse.down();
  await page.mouse.move(target.x+45, target.y+65, {steps:12});
  await expect(cards.nth(1)).toHaveClass(/drop-ready/);
  await page.mouse.up();
  await expect.poll(() => page.evaluate(() => state.players.player.hand.some(c => c.baseId === 'double_diamond'))).toBe(true);
  await expect(page.locator('#expandedHandCount')).toHaveText('手札 9枚');
  await expect(page.locator('#expandedHandPanel')).toBeVisible();
});

test('拡大中も通常のカード選択から出席できる', async ({page}) => {
  await prepare(page); await expand(page);
  await page.locator('#playerHand [data-base-id="general_student"]').click();
  await page.locator('#playerSeatGrid .slot[data-index="0"]').click();
  await expect.poll(() => page.evaluate(() => state.players.player.board.seats[0]?.baseId)).toBe('general_student');
  await expect(page.locator('#expandedHandPanel')).toBeHidden();
});

test('移動した押下では拡大メニューを出さず、山札の長押しも維持する', async ({page}) => {
  await prepare(page);
  const card = page.locator('#playerHand .hand-card').first();
  const box = await card.boundingBox();
  await card.dispatchEvent('pointerdown', {pointerType:'touch',pointerId:5,clientX:box.x+10,clientY:box.y+45});
  await card.dispatchEvent('pointermove', {pointerType:'touch',pointerId:5,clientX:box.x+40,clientY:box.y+5});
  await page.waitForTimeout(600);
  await expect(page.locator('#handExpandPrompt')).toBeHidden();
  await card.dispatchEvent('pointercancel', {pointerType:'touch',pointerId:5});
  await page.locator('#playerDeckPile').dispatchEvent('pointerdown', {pointerType:'touch',pointerId:6});
  await expect(page.locator('#deckInspectPrompt')).toBeVisible();
  await expect(page.locator('#handExpandPrompt')).toBeHidden();
});

test('スマートフォンでもタッチ長押しで開き、多い手札は横に確認できる', async ({page}) => {
  await prepare(page, 390, 844);
  const card = page.locator('#playerHand .hand-card').first();
  const box = await card.boundingBox();
  await card.dispatchEvent('pointerdown', {pointerType:'touch',pointerId:7,clientX:box.x+10,clientY:box.y+40});
  await expect(page.locator('#handExpandPrompt')).toBeVisible();
  await card.dispatchEvent('pointerup', {pointerType:'touch',pointerId:7});
  await page.locator('#handExpandButton').click();
  const panel = await page.locator('#expandedHandPanel').boundingBox();
  expect(panel.x).toBeGreaterThanOrEqual(0); expect(panel.x+panel.width).toBeLessThanOrEqual(390);
  expect(await page.locator('#playerHand').evaluate(e => e.scrollWidth > e.clientWidth)).toBe(true);
  await page.locator('#playerHand').evaluate(e => { e.scrollLeft = e.scrollWidth; });
  await expect(page.locator('#playerHand .hand-card').last()).toBeInViewport();
  await page.screenshot({path:test.info().outputPath('expanded-mobile.png')});
  await page.locator('#handCollapseButton').click();
  await expect(page.locator('#expandedHandPanel')).toBeHidden();
});

test('相手ターンでも閲覧でき、試合を離れたら拡大を閉じる', async ({page}) => {
  await prepare(page);
  await page.evaluate(() => {state.currentSide='opponent'; render();});
  await expand(page);
  await page.locator('#playerSeatGrid .slot[data-index="0"]').click();
  await expect(page.locator('#expandedHandPanel')).toBeHidden();
  expect(await page.evaluate(() => state.players.player.board.seats[0])).toBeNull();
  await page.evaluate(() => {setHandExpanded(true); state.screen='home'; render();});
  await expect(page.locator('#expandedHandPanel')).toBeHidden();
  expect(await page.evaluate(() => elements.playerHand.parentElement.classList.contains('player-hand-table'))).toBe(true);
});


test('手札の余白の長押しでも開き、ゲストの表示を変えても同期状態には混ぜない', async ({page}) => {
  await prepare(page);
  await page.evaluate(() => { state.online.role='guest'; state.online.started=true; state.online.connected=true; });
  const zone = page.locator('.player-hand-zone');
  const before = await page.evaluate(() => JSON.stringify(onlineCreateSnapshot().state.players.player.hand));
  await zone.dispatchEvent('pointerdown', {pointerType:'touch',pointerId:9,clientX:300,clientY:850});
  await expect(page.locator('#handExpandPrompt')).toBeVisible();
  await zone.dispatchEvent('pointerup', {pointerType:'touch',pointerId:9});
  await page.locator('#handExpandButton').click();
  await expect(page.locator('#expandedHandPanel')).toBeVisible();
  expect(await page.evaluate(() => JSON.stringify(onlineCreateSnapshot().state.players.player.hand))).toBe(before);
  await page.evaluate(() => { state.online.role='spectator'; render(); });
  await expect(page.locator('#expandedHandPanel')).toBeHidden();
});
