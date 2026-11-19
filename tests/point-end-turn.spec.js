const { test, expect } = require('@playwright/test');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const url = pathToFileURL(path.join(__dirname, '../index.html')).href;

test.beforeEach(async ({ page }) => {
  await page.goto(url);
  await page.evaluate(() => {
    startCardTest('short_sleeve_student');
    scheduleOpponentAI = () => {};
    state.training.skipAnimations = true;
    state.phase = 'battle'; state.currentSide = 'player'; state.actionTurn = 8;
    state.environment = null;
    for (const side of ['player', 'opponent']) Object.assign(state.players[side], {
      board: { seats: Array(9).fill(null), teacher: null }, hand: [], trash: [], late: [],
      deck: Array.from({ length: 20 }, () => createCardFromBase('general_student', side)),
      originalDeckCounts: {}, life: 20, will: 10, maxWill: 10,
      pointScore: 0, pointSystemActive: false
    });
    render();
  });
  await expect.poll(() => page.evaluate(() => battlePresentationBusy())).toBe(false);
});

for (const count of [9, 10, 11]) test(`初期デッキの点数カード${count}枚で終了時獲得を判定する`, async ({ page }) => {
  const result = await page.evaluate(count => {
    state.players.player.originalDeckCounts = {
      short_sleeve_student: 3, long_sleeve_student: 3, group_sniper: 3,
      pinige: count - 9, general_student: 40 - count
    };
    analyticsStartGame();
    resolveEndTurnEffects('player');
    return { count: initialPointCardCount('player'), score: state.players.player.pointScore,
      lines: playerActiveEffectLines('player'), events: state.analytics.events.filter(e => e.effectType === 'point_gain') };
  }, count);
  expect(result.count).toBe(count);
  expect(result.score).toBe(count >= 10 ? 1 : 0);
  expect(result.lines).toContain(`[点数] ${count >= 10 ? 1 : 0}/10`);
  expect(result.events).toHaveLength(count >= 10 ? 1 : 0);
  if (count >= 10) expect(result.events[0]).toMatchObject({ side: 'player', source: null,
    details: { amount: 1, reason: 'ターン終了' } });
});

test('ドロー・生成・デッキ追加で初期デッキの条件は変わらない', async ({ page }) => {
  expect(await page.evaluate(() => {
    const own = state.players.player, other = state.players.opponent;
    own.originalDeckCounts = { short_sleeve_student: 3, long_sleeve_student: 3, pinige: 3, lucky_man: 1 };
    other.originalDeckCounts = { short_sleeve_student: 3, long_sleeve_student: 3, pinige: 3 };
    own.deck = []; own.hand = [];
    other.deck = Array.from({ length: 12 }, () => createCardFromBase('pinige', 'opponent'));
    other.hand = [createCardFromBase('short_sleeve_student', 'opponent')];
    resolveEndTurnEffects('player'); resolveEndTurnEffects('opponent');
    return [own.pointScore, other.pointScore];
  })).toEqual([1, 0]);
});

for (const side of ['player', 'opponent']) test(`終了した側だけが1点獲得する ${side}`, async ({ page }) => {
  expect(await page.evaluate(side => {
    for (const owner of ['player', 'opponent']) state.players[owner].originalDeckCounts = {
      short_sleeve_student: 3, long_sleeve_student: 3, pinige: 3, lucky_man: 1
    };
    state.currentSide = side;
    resolveEndTurnEffects(side);
    return ['player', 'opponent'].map(owner => state.players[owner].pointScore);
  }, side)).toEqual(side === 'player' ? [1, 0] : [0, 1]);
});

test('撃破の加点に加えて終了時に10点となり、次の手番前に単位強化を適用する', async ({ page }) => {
  await page.evaluate(() => {
    const own = state.players.player;
    own.originalDeckCounts = { short_sleeve_student: 3, long_sleeve_student: 3, pinige: 3, lucky_man: 1 };
    own.pointScore = 8;
    own.board.seats[0] = makeBoardCard(createCardFromBase('long_sleeve_student', 'player'));
    const target = makeBoardCard(createCardFromBase('aggro_student', 'opponent'));
    state.players.opponent.board.seats[0] = target;
    dealDamageToCard(target, 2, createCardFromBase('short_sleeve_student', 'player'));
    cleanupDestroyedCards(); render();
  });
  expect(await page.evaluate(() => state.players.player.pointScore)).toBe(9);
  await page.locator('#endTurnButton').click();
  await expect.poll(() => page.evaluate(() => !state.lectureRoomCheck && state.currentSide === 'opponent')).toBe(true);
  expect(await page.evaluate(() => [state.players.player.pointScore, hasAcquiredUnit('player'),
    state.players.player.board.seats[0].attack, state.players.player.board.seats[0].currentHp,
    playerActiveEffectLines('player')[0]])).toEqual([10, true, 4, 6, '[単位] 取得済み']);
  await page.evaluate(() => resolveEndTurnEffects('player'));
  expect(await page.evaluate(() => [state.players.player.pointScore,
    state.players.player.board.seats[0].attack, state.players.player.board.seats[0].currentHp])).toEqual([10, 4, 6]);
});

test('終了ボタンの連打で二重加点せず、飛ばされた相手ターンにも加点しない', async ({ page }) => {
  await page.evaluate(() => {
    for (const side of ['player', 'opponent']) state.players[side].originalDeckCounts = {
      short_sleeve_student: 3, long_sleeve_student: 3, pinige: 3, lucky_man: 1
    };
    state.players.opponent.skipAllTurns = true;
    endTurn(); endTurn();
  });
  await expect.poll(() => page.evaluate(() => !state.lectureRoomCheck && state.actionTurn === 9)).toBe(true);
  expect(await page.evaluate(() => [state.currentSide, state.players.player.pointScore,
    state.players.opponent.pointScore])).toEqual(['player', 1, 0]);
});

test('カードの効果無効化中にもルールの加点を行う', async ({ page }) => {
  expect(await page.evaluate(() => {
    state.players.player.originalDeckCounts = { short_sleeve_student: 3, long_sleeve_student: 3, pinige: 3, lucky_man: 1 };
    state.kashikashiActionTurn = state.actionTurn;
    state.players.player.effectUseLockTurnsRemaining = 1;
    resolveEndTurnEffects('player');
    return state.players.player.pointScore;
  })).toBe(1);
});

test('終了時の負荷で敗北した後は点数を獲得しない', async ({ page }) => {
  await page.evaluate(() => {
    state.players.player.originalDeckCounts = { short_sleeve_student: 3, long_sleeve_student: 3, pinige: 3, lucky_man: 1 };
    state.players.player.life = 1;
    const card = createCardFromBase('general_student', 'player');
    addHandLoad(card); state.players.player.hand = [card];
    endTurn();
  });
  await expect.poll(() => page.evaluate(() => state.gameOver)).toBe(true);
  expect(await page.evaluate(() => state.players.player.pointScore)).toBe(0);
});

test('カード確認とチュートリアルで新しい点数条件を説明する', async ({ page }) => {
  expect(await page.evaluate(() => BATTLE_CARD_TERM_DESCRIPTIONS['点数'])).toContain('合計10枚以上');
  // Inspect the actual tutorial definition independently of the current test battle.
  expect(await page.evaluate(() => JSON.stringify(TUTORIAL_ABILITY_STEPS.points))).toContain('自分のターン終了時');
});
