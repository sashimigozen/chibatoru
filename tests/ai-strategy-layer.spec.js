const { test, expect } = require('@playwright/test');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
test.beforeEach(async ({ page }) => {
  await page.goto(pathToFileURL(path.join(__dirname, '..', 'index.html')).href);
  await page.evaluate(() => {
    startCardTest('general_student'); scheduleOpponentAI = () => {};
    state.phase = 'battle'; state.currentSide = 'opponent'; state.actionTurn = 9; state.environment = null;
    state.training.skipAnimations = true;
    for (const side of ['player', 'opponent']) Object.assign(state.players[side], {
      life: 20, will: 5, maxWill: 5, turnsTaken: 5, hand: [], deck: [], trash: [], late: [],
      board: { seats: Array(9).fill(null), teacher: null }
    });
  });
});
test('別マスの2枚の戦意配分を加点し、同じカードや同じマスは二重計上しない', async ({ page }) => {
  const result = await page.evaluate(() => {
    const first = { card: createCardFromBase('general_student', 'opponent'), zone: 'seat', index: 0, score: 10 };
    const second = { card: createCardFromBase('general_student', 'opponent'), zone: 'seat', index: 1, score: 12 };
    const forecast = { opponentCounterLethal: false, immediateLethal: false };
    return {
      pair: aiPlacementStrategyAdjustment(first, [first, second], forecast),
      sameCard: aiPlacementUsesSeparateSlots(first, { ...first, index: 1 }),
      sameSlot: aiPlacementUsesSeparateSlots(first, { ...second, index: 0 }),
      before: state.players.opponent.will,
      hp: first.card.currentHp
    };
  });
  expect(result.pair).toBeGreaterThan(0);
  expect(result.sameCard).toBe(false); expect(result.sameSlot).toBe(false);
  expect(result.before).toBe(5); expect(result.hp).toBe(2);
});
test('危機・リーサル・カード固有の強い判断には一般加点を適用しない', async ({ page }) => {
  const scores = await page.evaluate(() => {
    const move = { card: createCardFromBase('general_student', 'opponent'), zone: 'seat', index: 0, score: 10 };
    return [
      aiPlacementStrategyAdjustment(move, [move], { opponentCounterLethal: true }),
      aiPlacementStrategyAdjustment(move, [move], { immediateLethal: true }),
      aiPlacementStrategyAdjustment({ ...move, score: 80 }, [move], {})
    ];
  });
  expect(scores).toEqual([0, 0, 0]);
});
test('安全な優勢盤面では余分な通常出席者を温存し、支援役は温存対象にしない', async ({ page }) => {
  const scores = await page.evaluate(() => {
    for (let index = 0; index < 3; index++) {
      const card = createCardFromBase('general_student', 'opponent');
      card.attack = 4; card.playedOnTurn = 1;
      state.players.opponent.board.seats[index] = card;
    }
    const body = createCardFromBase('general_student', 'opponent');
    const support = createCardFromBase('where_bone', 'opponent');
    state.players.opponent.hand = [body, support];
    const forecast = { nextTurnLethal: true, opponentCounterLethal: false, immediateLethal: false };
    return [body, support].map(card => aiPlacementStrategyAdjustment({ card, zone: 'seat', index: 4, score: 10 }, [], forecast));
  });
  expect(scores[0]).toBeLessThan(-10); expect(scores[1]).toBe(0);
});
test('将来の盤面生存予測は相手の非公開手札の種類に左右されない', async ({ page }) => {
  const values = await page.evaluate(() => {
    state.players.player.hand = [createCardFromBase('general_student', 'player')];
    const before = aiBoardSurvivalFactor('opponent');
    state.players.player.hand = [createCardFromBase('panpan', 'player')];
    return [before, aiBoardSurvivalFactor('opponent')];
  });
  expect(values[0]).toBe(values[1]);
});
test('単体の高得点より、戦意5で使える2枚の組合せを選ぶ', async ({ page }) => {
  const result = await page.evaluate(() => {
    const cards = [5, 3, 2].map(cost => {
      const card = createCardFromBase('general_student', 'opponent'); card.cost = cost; return card;
    });
    state.players.opponent.hand = cards;
    // Isolate the additive budget decision from card-specific score changes.
    scoreAiPlacement = card => ({ 5: 14, 3: 12, 2: 11 })[card.cost];
    const before = JSON.stringify(state.players.opponent);
    const move = findAiPlayMove();
    return { cost: move.card.cost, unchanged: before === JSON.stringify(state.players.opponent) };
  });
  expect(result).toEqual({ cost: 3, unchanged: true });
});
test('継続的に本体を削る出席者は、不要な相打ちより生存できる攻撃を選ぶ', async ({ page }) => {
  const result = await page.evaluate(() => {
    const attacker = makeBoardCard(createCardFromBase('where_bone', 'opponent'));
    attacker.attack = 3; attacker.currentHp = 2; attacker.playedOnTurn = state.actionTurn;
    attacker.keywords = ['陽気'];
    state.players.opponent.board.seats[0] = attacker;
    const strong = makeBoardCard(createCardFromBase('general_student', 'player'));
    strong.attack = 8; strong.currentHp = 1; strong.playedOnTurn = 0;
    const weak = makeBoardCard(createCardFromBase('general_student', 'player'));
    weak.attack = 1; weak.currentHp = 4; weak.maxHp = 4; weak.playedOnTurn = 0;
    state.players.player.board.seats[0] = strong;
    state.players.player.board.seats[1] = weak;
    return findAiAttackTarget(attacker)?.index;
  });
  expect(result).toBe(1);
});
