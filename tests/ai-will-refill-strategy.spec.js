const { test, expect } = require('@playwright/test');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

test.beforeEach(async ({ page }) => {
  await page.goto(pathToFileURL(path.join(__dirname, '..', 'index.html')).href);
  await page.evaluate(() => {
    const a = __chibattle, s = a.state;
    Object.assign(s, { screen: 'battle', phase: 'battle', currentSide: 'opponent', actionTurn: 9,
      gameOver: false, environment: null });
    s.preBattleToken += 1000;
    s.training.active = true; s.training.skipAnimations = true;
    for (const side of ['player', 'opponent']) {
      Object.assign(s.players[side], { life: 20, will: 5, maxWill: 5, turnsTaken: 3,
        hand: [], trash: [], late: [], originalDeckCounts: {},
        deck: Array.from({ length: 10 }, () => a.createCardFromBase('general_student', side)),
        board: { teacher: null, seats: Array(9).fill(null) } });
    }
  });
});

test('序盤の小さな被ダメージには気にするなを温存する（左右共通）', async ({ page }) => {
  const scores = await page.evaluate(() => {
    const a = __chibattle;
    return ['player', 'opponent'].map(side => {
      const enemy = side === 'player' ? 'opponent' : 'player';
      for (const owner of ['player', 'opponent']) a.state.players[owner].board.seats.fill(null);
      const card = a.makeBoardCard(a.createCardFromBase('general_student', enemy));
      card.playedOnTurn = 0;
      a.state.players[enemy].board.seats[0] = card;
      return a.scoreAiDontWorry(side, a.createCardFromBase('dont_worry', side));
    });
  });
  expect(scores).toEqual([0, 0]);
});

test('終盤でも決着に関係しない小さな被ダメージには温存する', async ({ page }) => {
  expect(await page.evaluate(() => {
    const a = __chibattle;
    a.state.players.opponent.maxWill = 10;
    const c = a.makeBoardCard(a.createCardFromBase('general_student', 'player')); c.playedOnTurn = 0;
    a.state.players.player.board.seats[0] = c;
    return a.scoreAiDontWorry('opponent', a.createCardFromBase('dont_worry', 'opponent'));
  })).toBe(0);
});

test('次の決着を守れる終盤は気にするなを評価し、勝てる今は使わない', async ({ page }) => {
  const data = await page.evaluate(() => {
    const a = __chibattle, s = a.state;
    s.players.player.life = 5;
    const own = a.makeBoardCard(a.createCardFromBase('general_student', 'opponent'));
    own.attack = own.baseAttack = 10; own.currentHp = own.maxHp = 10; own.playedOnTurn = s.actionTurn;
    s.players.opponent.board.seats[0] = own;
    const enemy = a.makeBoardCard(a.createCardFromBase('general_student', 'player')); enemy.playedOnTurn = 0;
    s.players.player.board.seats[0] = enemy;
    const item = a.createCardFromBase('dont_worry', 'opponent');
    const next = a.scoreAiDontWorry('opponent', item);
    own.playedOnTurn = 0;
    return { next, now: a.scoreAiDontWorry('opponent', item) };
  });
  expect(data.next).toBeGreaterThan(0);
  expect(data.now).toBe(0);
});

test('焼き鳥は傷ついた先頭の学生でなく戦意を多く回復できる学生を選ぶ', async ({ page }) => {
  const data = await page.evaluate(() => {
    const a = __chibattle, s = a.state;
    s.players.opponent.will = 3;
    const hurt = a.makeBoardCard(a.createCardFromBase('general_student', 'opponent'));
    hurt.currentHp = 1; hurt.maxHp = 6;
    s.players.opponent.board.seats[0] = hurt;
    s.players.opponent.board.seats[1] = a.makeBoardCard(a.createCardFromBase('aggro_queen', 'opponent'));
    const item = a.createCardFromBase('yakitori_harassment', 'opponent');
    s.players.opponent.hand = [item, a.createCardFromBase('predator', 'opponent')];
    const plan = a.planAiYakitori('opponent', item);
    const used = a.useAiItem(item);
    return { target: plan.target?.index, afterWill: plan.afterWill, used, will: s.players.opponent.will };
  });
  expect(data).toEqual({ target: 1, afterWill: 5, used: true, will: 5 });
});

test('戦意5でもクイーン→焼き鳥→捕食者まで実行する', async ({ page }) => {
  const data = await page.evaluate(async () => {
    const a = __chibattle, s = a.state;
    s.players.opponent.hand = ['aggro_queen', 'predator', 'yakitori_harassment'].map(id => a.createCardFromBase(id, 'opponent'));
    const first = a.findAiPlayMove()?.card.baseId;
    await a.playAiBoardMoves();
    return { first, board: s.players.opponent.board.seats.filter(Boolean).map(c => c.baseId),
      trash: s.players.opponent.trash.map(c => c.baseId), hand: s.players.opponent.hand.map(c => c.baseId), will: s.players.opponent.will };
  });
  expect(data.first).toBe('aggro_queen');
  expect(data.board).toContain('predator');
  expect(data.trash).toEqual(expect.arrayContaining(['yakitori_harassment', 'aggro_queen']));
  expect(data.hand).not.toContain('predator');
  expect(data.will).toBe(0);
});

test('例以外でも低戦意の学生→焼き鳥→高戦意の出席につなぐ', async ({ page }) => {
  const data = await page.evaluate(async () => {
    const a = __chibattle, s = a.state;
    s.players.opponent.hand = ['general_student', 'protein_drinker', 'yakitori_harassment'].map(id => a.createCardFromBase(id, 'opponent'));
    const first = a.findAiPlayMove()?.card.baseId;
    await a.playAiBoardMoves();
    return { first, board: s.players.opponent.board.seats.filter(Boolean).map(c => c.baseId), trash: s.players.opponent.trash.map(c => c.baseId) };
  });
  expect(data.first).toBe('general_student');
  expect(data.board).toEqual(expect.arrayContaining(['general_student', 'protein_drinker']));
  expect(data.trash).toContain('yakitori_harassment');
});

test('回復しても次の行動につながらない焼き鳥は使わない', async ({ page }) => {
  expect(await page.evaluate(() => {
    const a = __chibattle, s = a.state;
    s.players.opponent.will = 3;
    s.players.opponent.board.seats[0] = a.makeBoardCard(a.createCardFromBase('general_student', 'opponent'));
    const item = a.createCardFromBase('yakitori_harassment', 'opponent'); s.players.opponent.hand = [item];
    return a.useAiItem(item);
  })).toBe(false);
});

test('左側CPUもクイーン→焼き鳥→捕食者を実行する', async ({ page }) => {
  const board = await page.evaluate(async () => {
    const a = __chibattle, s = a.state;
    s.currentSide = 'player'; s.training.leftController = 'ai';
    scheduleOpponentAI = () => {};
    s.players.player.hand = ['aggro_queen', 'predator', 'yakitori_harassment'].map(id => a.createCardFromBase(id, 'player'));
    await a.runTrainingLeftAI();
    return s.players.player.board.seats.filter(Boolean).map(c => c.baseId);
  });
  expect(board).toContain('predator');
  expect(board).not.toContain('aggro_queen');
});

test('最大戦意の上限と対象の傷を計算し、出せないカードを出せるとは判定しない', async ({ page }) => {
  const result = await page.evaluate(() => {
    const a = __chibattle, s = a.state;
    s.players.opponent.will = 3; s.players.opponent.maxWill = 4;
    const student = a.makeBoardCard(a.createCardFromBase('general_student', 'opponent'));
    s.players.opponent.board.seats[0] = student;
    const item = a.createCardFromBase('yakitori_harassment', 'opponent');
    s.players.opponent.hand = [item, a.createCardFromBase('predator', 'opponent')];
    const capped = a.planAiYakitori('opponent').score;
    s.players.opponent.maxWill = 5; student.maxHp = 6; student.currentHp = 1;
    return { capped, wounded: a.planAiYakitori('opponent').score };
  });
  expect(result).toEqual({ capped: 0, wounded: 0 });
});

test('焼き鳥の使用戦意が足りない順番は計画しない', async ({ page }) => {
  expect(await page.evaluate(() => {
    const a = __chibattle, s = a.state;
    s.players.opponent.will = 4;
    s.players.opponent.hand = ['aggro_queen', 'predator', 'yakitori_harassment'].map(id => a.createCardFromBase(id, 'opponent'));
    return a.planAiYakitori('opponent').score;
  })).toBe(0);
});
