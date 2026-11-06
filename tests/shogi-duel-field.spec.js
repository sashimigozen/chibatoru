const { test, expect } = require('@playwright/test');
const { pathToFileURL } = require('node:url');
const path = require('node:path');

const url = pathToFileURL(path.join(__dirname, '..', 'index.html')).href;
const id = 'shogi_duel_field';
const rules = 'このカードが環境マスにあるかぎり、各プレイヤーのターン終了時、そのプレイヤーの最大気力を2減らす。この効果で最大気力は10未満にならない。';

const life = page => page.evaluate(() => ['player', 'opponent'].map(side => (
  [state.players[side].life, currentLifeCap(side)]
)));
const placeEnvironment = (page, baseId) => page.evaluate(baseId => {
  const card = state.players.player.hand.find(entry => entry.baseId === baseId);
  return placeCardFromHand('player', card.instanceId, 'environment', null, null, false);
}, baseId);
const waitForEffects = page => expect.poll(() => page.evaluate(() => (
  !battlePresentationBusy() && !state.lectureRoomCheck
))).toBe(true);

test('カードテストで両者のターン終了と上書き・回復・再配置を確認する', async ({ page }) => {
  await page.goto(url);
  await page.locator('#homeNavDeckButton').click();
  await page.locator('[data-case-view="cards"]').click();
  await page.locator('#cardsCatalogSearch').fill('将棋部の決闘フィールド');
  await page.locator(`[data-catalog-card="${id}"]`).click();
  await expect(page.locator('#cardTestText')).toContainText(rules);
  await page.locator('#cardTestStartButton').click();
  await page.evaluate(() => { scheduleOpponentAI = () => {}; state.training.skipAnimations = true; });
  await waitForEffects(page);

  expect(await placeEnvironment(page, id)).toBe(true);
  await waitForEffects(page);
  expect(await life(page)).toEqual([[20, 20], [20, 20]]);
  expect(await page.evaluate(() => state.players.player.will)).toBe(6);
  await page.locator('#endTurnButton').click();
  await expect.poll(() => page.evaluate(() => state.currentSide)).toBe('opponent');
  expect(await life(page)).toEqual([[18, 18], [20, 20]]);
  await page.evaluate(() => endTurn({ fromAi: true }));
  await expect.poll(() => page.evaluate(() => state.currentSide)).toBe('player');
  expect(await life(page)).toEqual([[18, 18], [18, 18]]);

  expect(await placeEnvironment(page, 'classroom')).toBe(true);
  await waitForEffects(page);
  expect(await life(page)).toEqual([[18, 20], [18, 20]]);
  await page.evaluate(() => beginItemUse(state.players.player.hand.find(card => card.baseId === 'peaceful_mind')));
  await expect.poll(() => life(page)).toEqual([[20, 20], [20, 20]]);
  await waitForEffects(page);

  expect(await placeEnvironment(page, id)).toBe(true);
  await waitForEffects(page);
  await page.locator('#endTurnButton').click();
  await expect.poll(() => page.evaluate(() => state.currentSide)).toBe('opponent');
  expect(await life(page)).toEqual([[18, 18], [20, 20]]);
});

test('最大気力10で止まり、ゲスト視点でもそれぞれの上限を保つ', async ({ page }) => {
  await page.goto(url);
  expect(await page.evaluate(() => {
    startCardTest('shogi_duel_field');
    const card = makeBoardCard(createCardFromBase('shogi_duel_field', 'opponent'));
    state.environment = card;
    state.players.player.life = 7;
    for (let i = 0; i < 6; i++) resolveEnvironmentEndTurnEffects('player');
    resolveEnvironmentEndTurnEffects('opponent');
    const host = [currentLifeCap('player'), currentLifeCap('opponent'), state.players.player.life];
    state.kashikashiActionTurn = state.actionTurn;
    resolveEnvironmentEndTurnEffects('opponent');
    const suppressedCap = currentLifeCap('opponent');
    state.kashikashiActionTurn = null;
    const guest = onlineTransformSnapshotForGuest({ players: state.players, environment: state.environment });
    state.environment = guest.environment;
    state.players = guest.players;
    return { host, guest: [currentLifeCap('player'), currentLifeCap('opponent')], suppressedCap };
  })).toEqual({ host: [10, 18, 7], guest: [18, 10], suppressedCap: 20 });
});
