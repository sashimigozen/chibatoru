const { test, expect } = require('@playwright/test');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const url = pathToFileURL(path.join(__dirname, '..', 'index.html')).href;
test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 }); await page.goto(url);
  await page.evaluate(() => {
    startCardTest('general_student'); scheduleOpponentAI = () => {}; state.training.skipAnimations = true;
    state.environment = null;
    for (const side of ['player', 'opponent']) Object.assign(state.players[side], {
      board: { teacher: null, seats: Array(9).fill(null) }, hand: [], deck: [], trash: [], late: [], will: 10, life: 20
    });
    render();
  });
  await expect.poll(() => page.evaluate(() => battlePresentationBusy())).toBe(false);
});

for (const owner of ['player', 'opponent']) test(`目黒区図書館は${owner}が置いた場合も、置いた側だけ手札を送る`, async ({ page }) => {
  expect(await page.evaluate(owner => {
    state.environment = createCardFromBase('meguro_library', owner);
    for (const side of ['player', 'opponent']) state.players[side].hand = [createCardFromBase('general_student', side)];
    const choices = ['player', 'opponent'].map(side => needsMeguroHandChoice(side));
    for (const side of ['player', 'opponent']) resolveEnvironmentEndTurnEffects(side, { meguroDiscardId: state.players[side].hand[0]?.instanceId });
    return { choices, hand: ['player', 'opponent'].map(side => state.players[side].hand.length),
      trash: ['player', 'opponent'].map(side => state.players[side].trash.length),
      text: cardRulesText(createCardFromBase('meguro_library', owner)) };
  }, owner)).toEqual({ choices: owner === 'player' ? [true, false] : [false, true],
    hand: owner === 'player' ? [0, 1] : [1, 0], trash: owner === 'player' ? [1, 0] : [0, 1],
    text: 'お互いにプレイヤー本体を攻撃できない。\nこのカードをプレイしたプレイヤーは、このカードが環境マスにある間、自分のターン終了時に手札1枚を選び、校外エリアへ送る。' });
});

for (const id of ['uma_bone', 'where_uma']) test(`${id}のターン終了時バフは画面更新で消えず最後まで再生する`, async ({ page }) => {
  await page.evaluate(id => {
    state.players.player.board.seats[0] = makeBoardCard(createCardFromBase(id, 'player'));
    state.players.player.board.seats[1] = makeBoardCard(createCardFromBase('general_student', 'player'));
    render(); resolveHorseEndTurn('player', state.players.player.board.seats[0]);
  }, id);
  if (id === 'uma_bone') {
    await page.locator('.board-card.selection-candidate').click();
    await page.locator('#itemTargetConfirmButton').click();
  }
  await expect.poll(() => page.evaluate(() => fusionTasksBusy())).toBe(false);
  const layer = page.locator('.slot[data-owner="player"][data-index="1"] .board-change-feedback');
  await expect(layer).toHaveAttribute('aria-label', id === 'uma_bone' ? /攻撃力強化/ : /体力強化/);
  await layer.evaluate(node => node.dataset.testRetained = 'yes');
  await page.evaluate(() => { render(); render(); });
  await expect(layer).toHaveAttribute('data-test-retained', 'yes');
  await page.screenshot({ path: test.info().outputPath(`${id}-buff.png`) });
  await expect(layer).toHaveCount(0, { timeout: 2500 });
});

test('初回表示前の共通バフ・デバフ処理にも演出が付き、無変更では付かない', async ({ page }) => {
  await page.evaluate(() => {
    const card = makeBoardCard(createCardFromBase('general_student', 'player'));
    state.players.player.board.seats[0] = card;
    applyPermanentStatBuff(card, 2, 1); render();
  });
  const layer = page.locator('.board-card .board-change-feedback');
  await expect(layer).toHaveAttribute('aria-label', /攻撃力強化 \+2/);
  await expect(layer).toHaveCount(0, { timeout: 2500 });
  await page.evaluate(() => { applyPermanentStatBuff(state.players.player.board.seats[0], -1, -1); render(); render(); });
  await expect(layer).toHaveAttribute('aria-label', /攻撃力弱体化 -1/);
  await expect(layer).toHaveCount(0, { timeout: 2500 });
  await page.evaluate(() => { applyPermanentStatBuff(state.players.player.board.seats[0], 0, 0); render(); });
  await expect(layer).toHaveCount(0);
});

test('オンライン受信側も強化・弱体化を表示し、続く同期で演出が消えない', async ({ page: host, browser }) => {
  const guest = await browser.newPage(); await guest.goto(url);
  await guest.evaluate(() => { state.online.role = 'guest'; state.online.started = true; state.online.connected = true; });
  const first = await host.evaluate(() => {
    Object.assign(state.online, { role: 'host', started: true, connected: true, conn: {} });
    state.players.player.board.seats[0] = makeBoardCard(createCardFromBase('general_student', 'player'));
    render(); return onlineCreateSnapshot();
  });
  const apply = snapshot => guest.evaluate(snapshot => onlineHandleMessage({ type: 'gameState', protocol: ONLINE_PROTOCOL_VERSION, snapshot }), snapshot);
  await apply(first);
  for (const amount of [2, -1]) {
    const snapshot = await host.evaluate(amount => {
      applyPermanentStatBuff(state.players.player.board.seats[0], amount, amount);
      render(); return onlineCreateSnapshot();
    }, amount);
    await apply(snapshot);
    const layer = guest.locator('.board-change-feedback');
    await expect(layer).toHaveAttribute('aria-label', amount > 0 ? /攻撃力強化 \+2/ : /攻撃力弱体化 -1/);
    await layer.evaluate(node => node.dataset.testRetained = 'yes');
    await apply(await host.evaluate(() => onlineCreateSnapshot()));
    await expect(layer).toHaveAttribute('data-test-retained', 'yes');
    await expect(layer).toHaveCount(0, { timeout: 2500 });
  }
  await guest.close();
});
