const { test, expect } = require('@playwright/test');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
test.beforeEach(async ({ page }) => {
  await page.goto(pathToFileURL(path.join(__dirname, '..', 'index.html')).href);
  await page.evaluate(() => {
    startCardTest('general_student'); scheduleOpponentAI = () => {};
    state.phase = 'battle'; state.currentSide = 'opponent'; state.actionTurn = 9;
    state.environment = null; state.training.skipAnimations = true; state.aiLethalForcedTargetId = null;
    for (const side of ['player', 'opponent']) Object.assign(state.players[side], {
      life: 20, will: 0, maxWill: 5, turnsTaken: 5, hand: [], deck: [], trash: [], late: [],
      originalDeckCounts: {}, board: { seats: Array(9).fill(null), teacher: null }
    });
    window.put = (side, index, attack, hp) => {
      const card = makeBoardCard(createCardFromBase('general_student', side));
      Object.assign(card, { attack, currentHp: hp, maxHp: hp, playedOnTurn: 0 });
      state.players[side].board.seats[index] = card; return card;
    };
  });
});
for (const side of ['player', 'opponent']) {
  test(`${side}: 本体に攻撃できる味方より出席者限定の味方で先に処理する`, async ({ page }) => {
    const result = await page.evaluate(side => {
      const enemy = oppositeSide(side);
      const face = put(side, 0, 2, 5);
      const rush = put(side, 1, 3, 5);
      rush.playedOnTurn = state.actionTurn; rush.keywords = ['陽気'];
      put(enemy, 0, 1, 2);
      const before = JSON.stringify(state.players);
      return { first: aiOrderedAttackRefs(side)[0].index, unchanged: before === JSON.stringify(state.players) };
    }, side);
    expect(result).toEqual({ first: 1, unchanged: true });
  });
  test(`${side}: 反撃を受けない味方の処理を先に使う`, async ({ page }) => {
    const index = await page.evaluate(side => {
      put(side, 0, 2, 5);
      const safe = put(side, 1, 3, 5); safe.noCounterAttack = true;
      put(oppositeSide(side), 0, 2, 2);
      return aiOrderedAttackRefs(side)[0].index;
    }, side);
    expect(index).toBe(1);
  });
  test(`${side}: 同じ撃破でも反撃後に別の相手へ倒される攻撃を低く評価する`, async ({ page }) => {
    const values = await page.evaluate(side => {
      const attacker = put(side, 0, 4, 5);
      const target = put(oppositeSide(side), 0, 2, 2);
      const first = aiCombatTradeAdjustment(side, attacker, target);
      put(oppositeSide(side), 1, 3, 8);
      const before = JSON.stringify(state.players);
      const second = aiCombatTradeAdjustment(side, attacker, target);
      return { first, second, unchanged: before === JSON.stringify(state.players) };
    }, side);
    expect(values.second).toBeLessThan(values.first);
    expect(values.unchanged).toBe(true);
  });
}
test('別の味方が安全に倒せるなら、本体打点の大きい味方を処理に使う機会損失を考慮する', async ({ page }) => {
  const values = await page.evaluate(() => {
    const attacker = put('opponent', 0, 6, 6);
    const target = put('player', 0, 1, 2);
    const before = aiCombatTradeAdjustment('opponent', attacker, target);
    const rush = put('opponent', 1, 2, 4);
    rush.keywords = ['陽気']; rush.playedOnTurn = state.actionTurn;
    return [before, aiCombatTradeAdjustment('opponent', attacker, target)];
  });
  expect(values[1]).toBeLessThan(values[0] - 5);
});
test('陽気で注目を処理してから、残った味方が本体を攻撃する実行フロー', async ({ page }) => {
  const result = await page.evaluate(async () => {
    put('opponent', 0, 2, 5);
    const rush = put('opponent', 1, 3, 5);
    rush.keywords = ['陽気']; rush.playedOnTurn = state.actionTurn;
    const blocker = put('player', 0, 1, 2); blocker.keywords = ['注目'];
    await aiAttackWithReadyCards();
    return { life: state.players.player.life, blocker: !!state.players.player.board.seats[0] };
  });
  expect(result).toEqual({ life: 18, blocker: false });
});
test('攻撃順の評価は動けない味方や眠気を確定処理役として扱わない', async ({ page }) => {
  const priorities = await page.evaluate(() => {
    const card = put('opponent', 0, 4, 5);
    card.playedOnTurn = state.actionTurn;
    put('player', 0, 1, 2);
    const ref = { owner: 'opponent', zone: 'seat', index: 0 };
    const sleeping = aiCombatOpeningPriority('opponent', ref);
    card.keywords = ['超陽気', '眠気'];
    return [sleeping, aiCombatOpeningPriority('opponent', ref)];
  });
  expect(priorities).toEqual([0, 0]);
});
