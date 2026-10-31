const { test, expect } = require('@playwright/test');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

test.beforeEach(async ({ page }) => {
  await page.goto(pathToFileURL(path.join(__dirname, '..', 'index.html')).href);
  await page.evaluate(() => {
    startCardTest('general_student'); scheduleOpponentAI = () => {};
    Object.assign(state, { phase: 'battle', currentSide: 'opponent', actionTurn: 9,
      gameOver: false, environment: null, battleHandLimit: 9, deckToHandLocks: [] });
    state.training.active = true; state.training.leftController = 'ai'; state.training.skipAnimations = true;
    for (const side of ['player', 'opponent']) Object.assign(state.players[side], {
      life: 20, will: 8, maxWill: 8, turnsTaken: 4, hand: [], trash: [], late: [], originalDeckCounts: {},
      retainNextUsedItem: false,
      deck: Array.from({ length: 20 }, () => createCardFromBase('general_student', side)),
      board: { seats: Array(9).fill(null), teacher: null }
    });
  });
});

for (const side of ['player', 'opponent']) {
  test(`通常ドローの1枠を見込み、先に出席させてからドローする ${side}`, async ({ page }) => {
    const result = await page.evaluate(async side => {
      state.currentSide = side;
      const p = state.players[side];
      const draw = createCardFromBase('onigiri_draw', side);
      const body = createCardFromBase('general_student', side);
      p.hand = [draw, body, ...Array.from({ length: 6 }, () => createCardFromBase('alpha', side))];
      const forecast = aiHandSpaceForecast(side, draw);
      const defer = shouldAiMakeHandSpaceFirst(side, draw);
      const played = placeCardFromHand(side, body.instanceId, 'seat', side, 0, false);
      const after = aiHandSpaceForecast(side, draw);
      castImmediateItem(side, draw, false);
      drawOne(side, false); // the next normal draw still fits
      return { forecast, defer, played, after, count: p.hand.length,
        burned: p.trash.filter(c => c.baseId === 'general_student').length };
    }, side);
    expect(result.forecast.burned).toBe(0);
    expect(result.forecast.futureBurn).toBe(1);
    expect(result.defer).toBe(true);
    expect(result.played).toBe(true);
    expect(result.after.futureBurn).toBe(0);
    expect(result.count).toBe(9); expect(result.burned).toBe(0);
  });

  test(`実行結果に合うドロー・生成予測と上限15・上限なし ${side}`, async ({ page }) => {
    const cases = await page.evaluate(async side => {
      state.currentSide = side;
      const p = state.players[side], results = [];
      for (const id of ['onigiri_draw', 'aggro_army', 'private_teacher']) for (const limit of [9, 15, null]) {
        state.battleHandLimit = limit;
        p.hand = Array.from({ length: 8 }, () => createCardFromBase('alpha', side));
        const card = createCardFromBase(id, side); p.hand.push(card); p.trash = [];
        p.will = 8; p.board = { seats: Array(9).fill(null), teacher: null };
        const predicted = aiHandSpaceForecast(side, card);
        const used = card.type === 'item' ? castImmediateItem(side, card, false)
          : placeCardFromHand(side, card.instanceId, 'teacher', side, null, false);
        render(); await waitForOrderedAttendance(); await waitForAiTimedEffects();
        results.push({ id, limit, used, predicted: predicted.burned,
          burned: 8 + (id === 'aggro_army' ? 3 : 2) - p.hand.length,
          hand: p.hand.length });
      }
      return results;
    }, side);
    for (const c of cases) {
      expect(c.used).toBe(true);
      expect(c.burned, JSON.stringify(c)).toBe(c.predicted);
      if (c.limit !== null) expect(c.hand).toBeLessThanOrEqual(c.limit);
    }
  });
}

test('戦意不足・席不足のときは先に出席できると誤認しない', async ({ page }) => {
  expect(await page.evaluate(() => {
    const p = state.players.opponent, draw = createCardFromBase('onigiri_draw', 'opponent');
    p.hand = [draw, ...Array.from({ length: 8 }, () => createCardFromBase('general_student', 'opponent'))];
    p.will = 3; const poor = shouldAiMakeHandSpaceFirst('opponent', draw);
    p.will = 8; p.board.seats = p.board.seats.map(() => makeBoardCard(createCardFromBase('general_student', 'opponent')));
    p.board.teacher = makeBoardCard(createCardFromBase('general_teacher', 'opponent'));
    return [poor, shouldAiMakeHandSpaceFirst('opponent', draw)];
  })).toEqual([false, false]);
});

test('余裕があるなら先ドローを維持し、満杯の不要ドロー・生成を控える', async ({ page }) => {
  const result = await page.evaluate(() => {
    const p = state.players.opponent, draw = createCardFromBase('onigiri_draw', 'opponent');
    p.hand = [draw]; const low = scoreAiItem(draw);
    const early = shouldAiUseItemAtTiming(draw, low, 'beforeBoard');
    p.hand = [draw, ...Array.from({ length: 8 }, () => createCardFromBase('alpha', 'opponent'))];
    const full = scoreAiItem(draw);
    const army = createCardFromBase('aggro_army', 'opponent'); p.hand[0] = army;
    return { low, early, full, generated: scoreAiItem(army) };
  });
  expect(result.low).toBeGreaterThan(0); expect(result.early).toBe(true);
  expect(result.full).toBeLessThanOrEqual(0); expect(result.generated).toBeLessThanOrEqual(0);
});

test('溢れる場合も、致死圏からの回復・除去・即時勝利を妨げない', async ({ page }) => {
  const result = await page.evaluate(() => {
    const p = state.players.opponent, enemy = state.players.player;
    p.life = 2;
    const attacker = makeBoardCard(createCardFromBase('general_student', 'player'));
    attacker.attack = 3; attacker.playedOnTurn = 0; enemy.board.seats[0] = attacker;
    const heal = createCardFromBase('onigiri_draw', 'opponent');
    p.hand = [heal, ...Array.from({ length: 8 }, () => createCardFromBase('alpha', 'opponent'))];
    const healing = scoreAiItem(heal);
    const timing = shouldAiUseItemAtTiming(heal, healing, 'beforeBoard');
    const trainingHealing = scoreTrainingYocchanItem('opponent', heal);
    const removal = createCardFromBase('scary_question', 'opponent');
    p.hand[0] = removal; const removalScore = scoreAiItem(removal);
    const lethal = createCardFromBase('grudge', 'opponent'); enemy.life = 2;
    p.hand[0] = lethal;
    return { healing, timing, trainingHealing, removalScore, lethal: scoreAiItem(lethal) };
  });
  expect(result.healing).toBeGreaterThan(0); expect(result.timing).toBe(true);
  expect(result.trainingHealing).toBeGreaterThan(0); expect(result.removalScore).toBeGreaterThan(0);
  expect(result.lethal).toBeGreaterThanOrEqual(900);
});

test('終了時補充・残るドローロック・期限切れロックを区別する', async ({ page }) => {
  const result = await page.evaluate(() => {
    const p = state.players.opponent, draw = createCardFromBase('hondara', 'opponent');
    p.hand = [draw, ...Array.from({ length: 7 }, () => createCardFromBase('alpha', 'opponent'))];
    p.deck[0] = createCardFromBase('acting_out_man_2', 'opponent');
    // Use an actual attention holder without depending on deck order.
    p.deck[0].keywords = ['注目'];
    state.environment = createCardFromBase('dorm_council', 'opponent');
    const end = aiHandSpaceForecast('opponent', draw);
    state.environment = null;
    state.deckToHandLocks = [{owner: 'opponent', releaseAtActionTurn: state.actionTurn + 2}];
    const expires = aiHandSpaceForecast('opponent', draw);
    state.deckToHandLocks = [{owner: 'opponent', releaseAtActionTurn: state.actionTurn + 4}];
    const locked = aiHandSpaceForecast('opponent', draw);
    return { end, expires, locked };
  });
  expect(result.end.futureBurn).toBe(1);
  expect(result.expires.incoming).toBe(0);
  expect(result.expires.existingFutureBurn).toBe(0);
  expect(result.locked.incoming).toBe(0); expect(result.locked.futureBurn).toBe(0);
});

test('山札の順序を読まず、評価中に状態を変更しない。上限なしでは従来評価を維持', async ({ page }) => {
  const result = await page.evaluate(() => {
    const p = state.players.opponent, card = createCardFromBase('onigiri_draw', 'opponent');
    p.hand = [card, ...Array.from({length: 8}, () => createCardFromBase('alpha', 'opponent'))];
    p.deck[0] = createCardFromBase('grudge', 'opponent');
    const before = JSON.stringify(state);
    const first = aiHandSpaceAdjustment('opponent', card);
    const unchanged = before === JSON.stringify(state);
    p.deck.reverse(); const reversed = aiHandSpaceAdjustment('opponent', card);
    state.battleHandLimit = null;
    return { first, reversed, unchanged, adjustment: aiHandSpaceAdjustment('opponent', card),
      normal: scoreAiItem(card), old: scoreAiItemWithoutHandLimit(card),
      training: scoreTrainingYocchanItem('opponent', card), oldTraining: scoreTrainingYocchanItemWithoutHandLimit('opponent', card) };
  });
  expect(result.first).toBe(result.reversed); expect(result.unchanged).toBe(true);
  expect(result.adjustment).toBe(0); expect(result.normal).toBe(result.old);
  expect(result.training).toBe(result.oldTraining);
});

for (const side of ['player', 'opponent']) test(`実際のCPU手番で先に2枚出席し、補充と次ターンドローを溢れさせない ${side}`, async ({ page }) => {
  const result = await page.evaluate(async side => {
    state.currentSide = side; state.testMode = false;
    const p = state.players[side]; p.will = p.maxWill = 7;
    const filler = Array.from({length: 6}, () => {
      const c = createCardFromBase('general_student', side); c.cost = 99; return c;
    });
    p.hand = [createCardFromBase('onigiri_draw', side),
      createCardFromBase('general_student', side), createCardFromBase('general_student', side), ...filler];
    render();
    if (side === 'opponent') await runOpponentAI(); else await runTrainingLeftAI();
    const beforeDraw = p.hand.length;
    drawOne(side, false);
    return { beforeDraw, afterDraw: p.hand.length, drawnBurned: p.trash.filter(c => c.baseId === 'general_student').length,
      usedDraw: p.trash.some(c => c.baseId === 'onigiri_draw'), attendees: p.board.seats.filter(Boolean).length };
  }, side);
  expect(result.usedDraw).toBe(true); expect(result.attendees).toBe(2);
  expect(result.beforeDraw).toBe(8); expect(result.afterDraw).toBe(9); expect(result.drawnBurned).toBe(0);
});
