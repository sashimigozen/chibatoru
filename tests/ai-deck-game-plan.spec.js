const { test, expect } = require('@playwright/test');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

test.beforeEach(async ({ page }) => {
  await page.goto(pathToFileURL(path.join(__dirname, '..', 'index.html')).href);
  await page.evaluate(() => {
    const { state } = __chibattle;
    state.training.skipAnimations = true;
    state.preBattleToken += 1000;
    Object.assign(state, { screen: 'battle', phase: 'battle', currentSide: 'opponent', actionTurn: 9,
      firstSide: 'player', environment: null, gameOver: false });
    for (const side of ['player', 'opponent']) {
      Object.assign(state.players[side], { life: 20, will: 10, maxWill: 10, hand: [], deck: [], trash: [],
        late: [], turnsTaken: 5, originalDeckCounts: {} });
      state.players[side].board = { teacher: null, seats: Array(9).fill(null) };
    }
  });
});

test('一般教室は空の環境には置かず、相手の環境を張り替える', async ({ page }) => {
  expect(await page.evaluate(() => {
    const a = __chibattle, c = a.createCardFromBase('classroom', 'opponent');
    a.state.players.opponent.hand = [c];
    const empty = a.scoreAiEnvironment(c);
    const move = a.findAiPlayMove();
    a.state.environment = a.createCardFromBase('full_lock', 'player');
    return { empty, move, replacement: a.scoreAiEnvironment(c) };
  })).toMatchObject({ empty: 0, move: null, replacement: 15 });
});

test('パンパンは強い不真面目な学生より弱い出席者を選び、損な交換を見送る', async ({ page }) => {
  expect(await page.evaluate(() => {
    const a = __chibattle, s = a.state;
    const strong = a.makeBoardCard(a.createCardFromBase('lazy_student', 'opponent'));
    const weak = a.makeBoardCard(a.createCardFromBase('aggro_student', 'opponent'));
    const enemy = a.makeBoardCard(a.createCardFromBase('general_student', 'player'));
    s.players.opponent.board.seats[0] = strong;
    s.players.opponent.board.seats[1] = weak;
    s.players.player.board.seats[0] = enemy;
    const item = a.createCardFromBase('panpan', 'opponent');
    const target = a.planAiPanpan('opponent', item).friendly.card.baseId;
    s.players.opponent.board.seats[1] = null;
    return { target, score: a.planAiPanpan('opponent', item).score };
  })).toEqual({ target: 'aggro_student', score: 0 });
});

test('低戦意の出席者を先に出席させてからパンパンで破壊する', async ({ page }) => {
  expect(await page.evaluate(async () => {
    const a = __chibattle, s = a.state;
    s.players.opponent.board.seats[0] = a.makeBoardCard(a.createCardFromBase('lazy_student', 'opponent'));
    const enemy = a.makeBoardCard(a.createCardFromBase('protein_drinker', 'player'));
    enemy.currentHp = enemy.maxHp = 9;
    s.players.player.board.seats[0] = enemy;
    s.players.opponent.hand = ['panpan', 'aggro_student'].map(id => a.createCardFromBase(id, 'opponent'));
    const setup = a.planAiSacrificeSetup('opponent')?.card.baseId;
    await tryUseAiItems({ timing: 'beforeBoard' });
    return { setup, strong: s.players.opponent.board.seats[0]?.baseId,
      enemy: Boolean(s.players.player.board.seats[0]),
      trash: s.players.opponent.trash.map(c => c.baseId) };
  })).toMatchObject({ setup: 'aggro_student', strong: 'lazy_student', enemy: false,
    trash: expect.arrayContaining(['aggro_student', 'panpan']) });
});

test('破壊させる嘘は強い出席者をドローのために失わない', async ({ page }) => {
  expect(await page.evaluate(() => {
    const a = __chibattle, s = a.state;
    s.players.opponent.board.seats[0] = a.makeBoardCard(a.createCardFromBase('lazy_student', 'opponent'));
    s.players.opponent.deck = ['general_student', 'general_student'].map(id => a.createCardFromBase(id, 'opponent'));
    const item = a.createCardFromBase('destructive_lie', 'opponent');
    s.players.opponent.hand = [item];
    const used = a.useAiItem(item);
    return { used, strong: Boolean(s.players.opponent.board.seats[0]) };
  })).toEqual({ used: false, strong: true });
});

test('パンパンは敗北を防ぐ必要があるなら強い出席者の犠牲も許容する', async ({ page }) => {
  expect(await page.evaluate(() => {
    const a = __chibattle, s = a.state;
    s.players.opponent.life = 1;
    s.players.opponent.board.seats[0] = a.makeBoardCard(a.createCardFromBase('lazy_student', 'opponent'));
    s.players.player.board.seats[0] = a.makeBoardCard(a.createCardFromBase('general_student', 'player'));
    return a.planAiPanpan('opponent', a.createCardFromBase('panpan', 'opponent')).score;
  })).toBeGreaterThan(0);
});

test('スプーンの魔術師も場の順番ではなく弱い出席者を犠牲にする', async ({ page }) => {
  expect(await page.evaluate(async () => {
    const a = __chibattle, s = a.state;
    const strong = a.makeBoardCard(a.createCardFromBase('lazy_student', 'opponent'));
    const weak = a.makeBoardCard(a.createCardFromBase('aggro_student', 'opponent'));
    s.players.opponent.board.seats[0] = strong;
    s.players.opponent.board.seats[1] = weak;
    s.players.player.board.seats[0] = a.makeBoardCard(a.createCardFromBase('general_student', 'player'));
    const source = a.createCardFromBase('spoon_wizard', 'opponent');
    s.players.opponent.hand = [source];
    a.placeCardFromHand('opponent', source.instanceId, 'seat', 'opponent', 2, false);
    await a.waitForAiTimedEffects();
    return { strong: Boolean(s.players.opponent.board.seats[0]), weak: Boolean(s.players.opponent.board.seats[1]) };
  })).toEqual({ strong: true, weak: false });
});

test('先に出す出席者と破壊カードの合計戦意が不足するなら準備しない', async ({ page }) => {
  expect(await page.evaluate(() => {
    const a = __chibattle, s = a.state;
    s.players.opponent.will = 2;
    s.players.opponent.hand = ['panpan', 'aggro_student'].map(id => a.createCardFromBase(id, 'opponent'));
    s.players.player.board.seats[0] = a.makeBoardCard(a.createCardFromBase('protein_drinker', 'player'));
    return a.planAiSacrificeSetup('opponent');
  })).toBeNull();
});

test('どこ骨デッキは本体ダメージの完成品とコピーを高く評価する', async ({ page }) => {
  const result = await page.evaluate(() => {
    const a = __chibattle, s = a.state;
    s.players.opponent.originalDeckCounts = { fusion_bone: 1, fusion_where: 1, tiny_rhythm_student: 3 };
    const bone = a.createCardFromBase('where_bone', 'opponent');
    const normal = a.aiDeckPlanCardBonus('opponent', bone);
    s.players.player.life = 3;
    return { plan: a.aiDeckGamePlan('opponent'), normal, lethal: a.aiDeckPlanCardBonus('opponent', bone) };
  });
  expect(result.plan).toBe('boneBurn');
  expect(result.normal).toBeGreaterThan(0);
  expect(result.lethal).toBeGreaterThan(result.normal);
});

test('どこ骨デッキはコピー元としてどこの骨を優先する', async ({ page }) => {
  expect(await page.evaluate(async () => {
    const a = __chibattle;
    a.state.players.opponent.originalDeckCounts = { fusion_bone: 1, fusion_where: 1 };
    const cards = ['where_bone', 'where_maibo'].map(id => a.createCardFromBase(id, 'opponent'));
    const picked = await chooseFusionEffectCards('opponent', a.createCardFromBase('tiny_rhythm_student', 'opponent'), cards, 1, 'attendance_optional');
    return picked[0].baseId;
  })).toBe('where_bone');
});

for (const situation of ['回復', '複数体の処理']) {
  test(`順当な融合は4素材があっても状況に合わせる：${situation}`, async ({ page }) => {
    const result = await page.evaluate(situation => {
      const a = __chibattle, s = a.state;
      const ids = ['fusion_uma', 'fusion_maibo', 'fusion_bone', 'fusion_where'];
      s.players.opponent.originalDeckCounts = Object.fromEntries(ids.map(id => [id, 1]));
      s.players.opponent.will = 5;
      s.players.opponent.hand = ids.map(id => a.createCardFromBase(id, 'opponent'));
      if (situation === '回復') s.players.opponent.life = 2;
      else for (let i = 0; i < 3; i++) {
        const c = a.makeBoardCard(a.createCardFromBase('general_student', 'player'));
        c.currentHp = 2; s.players.player.board.seats[i] = c;
      }
      const used = a.tryFuseHorseForAi('opponent');
      return { used, result: s.players.opponent.hand.find(c => c.fusionResult)?.baseId };
    }, situation);
    expect(result).toEqual({ used: true, result: situation === '回復' ? 'umaibo' : 'maibo_bone' });
  });
}

test('コイントス研究会は強化される出席者の展開を評価する', async ({ page }) => {
  expect(await page.evaluate(() => {
    const a = __chibattle;
    a.state.players.opponent.originalDeckCounts = { adjective_student: 3, adjective_vs_cynical: 3 };
    return { plan: a.aiDeckGamePlan('opponent'),
      score: a.aiDeckPlanCardBonus('opponent', a.createCardFromBase('adjective_student', 'opponent')) };
  })).toEqual({ plan: 'coinBoard', score: 5 });
});
