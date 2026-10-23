const { test, expect } = require('@playwright/test');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const fs = require('node:fs');

test.beforeEach(async ({ page }) => {
  await page.goto(pathToFileURL(path.join(__dirname, '..', 'index.html')).href);
  await page.evaluate(() => {
    startCardTest('jobs_woody'); scheduleOpponentAI = () => {};
    state.training.skipAnimations = true; state.phase = 'battle'; state.screen = 'battle';
    state.currentSide = 'player'; state.actionTurn = 8; state.environment = null;
    state.cafeteriaEffectPermanentlyActive = false; state.kashikashiActionTurn = null;
    for (const side of ['player', 'opponent']) Object.assign(state.players[side], {
      board: { teacher: null, seats: Array(9).fill(null) }, hand: [], deck: [], trash: [],
      life: 10, will: 20, maxWill: 20, effectUseLockTurnsRemaining: 0
    });
  });
});

test('ジョブズウッディの食堂軽減は-1、通常戦意・ほかのカードは維持する',async({page})=>{
  expect(await page.evaluate(()=>{
    const cards=['player','opponent'].map(side=>createCardFromBase('jobs_woody',side));
    state.environment=createCardFromBase('cafeteria','player');
    const active=cards.map(card=>effectiveCardCost(card));
    state.environment=null;
    const normal=cards.map(card=>effectiveCardCost(card));
    state.cafeteriaEffectPermanentlyActive=true;
    const permanent=cards.map(card=>effectiveCardCost(card));
    return {active,normal,permanent};
  })).toEqual({active:[5,5],normal:[6,6],permanent:[5,5]});
});

test('新カードの能力値・所属・本文・戦意とサーバー登録', async ({ page }) => {
  const result = await page.evaluate(() => ['kakiage_teacher', 'window_eater', 'jobs_woody', 'ittan'].map(id => {
    const card = createCardFromBase(id, 'player');
    const normal = effectiveCardCost(card);
    state.environment = createCardFromBase('cafeteria', 'player');
    const discounted = effectiveCardCost(card); state.environment = null;
    return { id, stats: [card.cost, card.attack ?? 0, card.hp ?? 0], category: card.category,
      normal, discounted, text: cardRulesText(card), deck: ALL_DECK_IDS.includes(id) };
  }));
  expect(result.map(r => r.stats)).toEqual([[6,2,4],[9,4,5],[6,4,4],[8,0,0]]);
  expect(result.map(r => r.discounted)).toEqual([6,7,5,8]);
  expect(result.map(r => r.category)).toEqual(['common','cafeteria','cafeteria','common']);
  expect(result.every(r => r.deck)).toBe(true);
  expect(result[0].text).toBe('[陽気]\nこのカードが教卓マスにいるかぎり、自分のターン終了時に自分本体の気力を1回復する。');
  expect(result[1].text.replaceAll('\n', '')).toBe('このカードを手札から出席させたとき、相手の席マスの列を1つ選び、その列にいる出席者すべてを破壊する。環境が「食堂」なら、1つではなく2つの列を選ぶ。環境が「食堂」であるかぎり、このカードの戦意を-2する。');
  expect(result[3].text).toBe('お互いの講義室にいる出席者すべてを破壊する。');
  expect(result[2].text.replaceAll('\n', '')).toBe('このカードを手札から出席させたとき、自分の空いている席マス1つを選び、そこに「見習いヴァンパイア」を1人出席させる。環境が「食堂」なら、この効果をもう一度発動する。環境が「食堂」であるかぎり、このカードの戦意を-1する。');
  const catalog = require('../server/card-catalog.json');
  const rules = fs.readFileSync(path.join(__dirname, '../card_rules.txt'), 'utf8');
  for (const r of result) {
    expect(catalog.direct).toContain(r.id);
    expect(catalog.specialties[r.category]).toContain(r.id);
    expect(rules).toContain(`${r.id}:`);
  }
});

for (const cafeteria of [false, true]) test(`窓辺は${cafeteria ? 2 : 1}列を指名し教卓を残す`, async ({ page }) => {
  await page.evaluate(cafeteria => {
    if (cafeteria) state.environment = createCardFromBase('cafeteria', 'player');
    for (let i = 0; i < 9; i++) state.players.opponent.board.seats[i] = makeBoardCard(createCardFromBase('general_student', 'opponent'));
    state.players.opponent.board.teacher = makeBoardCard(createCardFromBase('general_teacher', 'opponent'));
    attendCard('player', makeBoardCard(createCardFromBase('window_eater', 'player')), 'seat', 0, { attendanceSource: ATTENDANCE_SOURCE.HAND });
  }, cafeteria);
  await expect.poll(() => page.evaluate(() => state.pendingCardChoice?.context?.kind)).toBe('destroy_columns');
  await page.evaluate(cafeteria => {
    state.pendingCardChoice.selectedIds = cafeteria ? ['window-eater-column-0','window-eater-column-1'] : ['window-eater-column-1'];
    confirmCardChoiceSelection();
  }, cafeteria);
  await expect.poll(() => page.evaluate(() => fusionTasksBusy())).toBe(false);
  expect(await page.evaluate(() => ({ count: listBoardRefs('opponent').length, teacher: !!state.players.opponent.board.teacher })))
    .toEqual({ count: cafeteria ? 4 : 7, teacher: true });
});

for (const cafeteria of [false, true]) test(`ウッディは${cafeteria ? 2 : 1}人を選んだ席に生成しコピーしない`, async ({ page }) => {
  await page.evaluate(cafeteria => {
    if (cafeteria) state.environment = createCardFromBase('cafeteria', 'player');
    attendCard('player', makeBoardCard(createCardFromBase('jobs_woody', 'player')), 'seat', 0, { attendanceSource: ATTENDANCE_SOURCE.HAND });
  }, cafeteria);
  for (const index of cafeteria ? [4, 8] : [4]) {
    await expect.poll(() => page.evaluate(() => state.pendingCardChoice?.context?.kind)).toBe('summon_seat');
    await page.evaluate(index => {
      state.pendingCardChoice.selectedIds = [`jobs-woody-seat-${index}`]; confirmCardChoiceSelection();
    }, index);
  }
  await expect.poll(() => page.evaluate(() => fusionTasksBusy())).toBe(false);
  expect(await page.evaluate(() => state.players.player.board.seats.map((c, i) => c?.baseId === 'apprentice_vampire' ? i : -1).filter(i => i >= 0)))
    .toEqual(cafeteria ? [4,8] : [4]);
});

test('見習いは手札の席出席だけコピーする', async ({ page }) => {
  const result = await page.evaluate(() => {
    const counts = [];
    for (const source of [ATTENDANCE_SOURCE.GENERATED, ATTENDANCE_SOURCE.COPY, ATTENDANCE_SOURCE.HAND]) {
      state.players.player.board.seats.fill(null);
      attendCard('player', makeBoardCard(createCardFromBase('apprentice_vampire', 'player')), 'seat', 4, { attendanceSource: source });
      counts.push(listBoardRefs('player').length);
    }
    return { counts, text: cardRulesText(createCardFromBase('apprentice_vampire', 'player')) };
  });
  expect(result.counts).toEqual([1,1,2]);
  expect(result.text).toContain('このカードを手札から席マスに出席させたとき');
});

test('かき揚げは教卓だけ回復し継続効果無効中は回復しない', async ({ page }) => {
  expect(await page.evaluate(() => {
    const card = makeBoardCard(createCardFromBase('kakiage_teacher', 'player'));
    state.players.player.board.seats[0] = card; resolveTeacherEndTurnEffects('player');
    const seat = state.players.player.life;
    state.players.player.board.seats[0] = null; state.players.player.board.teacher = card;
    resolveTeacherEndTurnEffects('player'); const teacher = state.players.player.life;
    state.kashikashiActionTurn = state.actionTurn; resolveTeacherEndTurnEffects('player');
    return [seat, teacher, state.players.player.life, hasKeyword(card, '陽気')];
  })).toEqual([10,11,11,true]);
});

test('一旦は気力1でも自傷せず全体破壊', async ({ page }) => {
  expect(await page.evaluate(() => {
    state.players.player.life = 1;
    for (const side of ['player', 'opponent']) {
      state.players[side].board.seats[0] = makeBoardCard(createCardFromBase('general_student', side));
      state.players[side].board.teacher = makeBoardCard(createCardFromBase('general_teacher', side));
    }
    const item = createCardFromBase('ittan', 'player'); state.players.player.hand = [item];
    castImmediateItem('player', item, false);
    return [state.players.player.life, listBoardRefs('player').length, listBoardRefs('opponent').length, state.players.player.will];
  })).toEqual([1,0,0,12]);
});

test('複数マス出席者は基準マス以外の列からも1人だけ破壊される', async ({ page }) => {
  expect(await page.evaluate(() => {
    const giant = makeBoardCard(createCardFromBase('loud_members', 'opponent'));
    placeMultiSeatCard('opponent', 0, giant);
    const refs = windowEaterColumnRefs('player', [1]);
    const destroyed = destroyBoardRefsToTrash(refs);
    return [refs.length, destroyed.length, state.players.opponent.board.seats.filter(Boolean).length];
  })).toEqual([1,1,0]);
});

test('手札以外の出席では窓辺とウッディの効果は発動しない', async ({ page }) => {
  expect(await page.evaluate(() => {
    for (const [index, id] of ['window_eater', 'jobs_woody'].entries()) {
      attendCard('player', makeBoardCard(createCardFromBase(id, 'player')), 'seat', index, { attendanceSource: ATTENDANCE_SOURCE.GENERATED });
    }
    return [fusionTasksBusy(), !!state.pendingCardChoice, listBoardRefs('player').length];
  })).toEqual([false,false,2]);
});

test('空き席が1つなら食堂でも見習いは1人だけ出席する', async ({ page }) => {
  await page.evaluate(() => {
    state.environment = createCardFromBase('cafeteria', 'player');
    for (let i = 0; i < 8; i++) state.players.player.board.seats[i] = makeBoardCard(createCardFromBase('general_student', 'player'));
    attendCard('player', makeBoardCard(createCardFromBase('jobs_woody', 'player')), 'teacher', null, { attendanceSource: ATTENDANCE_SOURCE.HAND });
  });
  await expect.poll(() => page.evaluate(() => state.pendingCardChoice?.cards.length)).toBe(1);
  await page.evaluate(() => { state.pendingCardChoice.selectedIds = ['jobs-woody-seat-8']; confirmCardChoiceSelection(); });
  await expect.poll(() => page.evaluate(() => fusionTasksBusy())).toBe(false);
  expect(await page.evaluate(() => listBoardRefs('player').map(getBoardCardFromRef).filter(c => c.baseId === 'apprentice_vampire').length)).toBe(1);
});

test('CPUも列の価値を比較して選択し完了する', async ({ page }) => {
  await page.evaluate(() => {
    state.players.player.board.seats[2] = makeBoardCard(createCardFromBase('strong_student', 'player'));
    state.currentSide = 'opponent';
    attendCard('opponent', makeBoardCard(createCardFromBase('window_eater', 'opponent')), 'seat', 0, { attendanceSource: ATTENDANCE_SOURCE.HAND });
  });
  await expect.poll(() => page.evaluate(() => fusionTasksBusy())).toBe(false);
  expect(await page.evaluate(() => listBoardRefs('player').length)).toBe(0);
});

test('オンライン相手側へ選択を送り重複列を拒否して確定する', async ({ page }) => {
  await page.evaluate(() => {
    isOnlineHost = () => true; isOnlineBattle = () => true; isCpuControlledBattleSide = () => false;
    window.sentChoices = []; onlineSend = message => { window.sentChoices.push(message); return true; };
    onlineBroadcastState = () => {};
    state.environment = createCardFromBase('cafeteria', 'player');
    for (let i = 0; i < 9; i++) state.players.player.board.seats[i] = makeBoardCard(createCardFromBase('general_student', 'player'));
    attendCard('opponent', makeBoardCard(createCardFromBase('window_eater', 'opponent')), 'seat', 0, { attendanceSource: ATTENDANCE_SOURCE.HAND });
  });
  await expect.poll(() => page.evaluate(() => window.sentChoices.length)).toBe(1);
  expect(await page.evaluate(() => {
    const message = window.sentChoices[0];
    const invalid = resolveFusionEffectChoice(message.requestId, ['window-eater-column-0', 'window-eater-column-0']);
    const valid = resolveFusionEffectChoice(message.requestId, ['window-eater-column-0', 'window-eater-column-2']);
    return [message.privateChoiceKind, message.cards.length, invalid, valid];
  })).toEqual(['fusion_effect_choice',3,false,true]);
  await expect.poll(() => page.evaluate(() => fusionTasksBusy())).toBe(false);
  expect(await page.evaluate(() => listBoardRefs('player').length)).toBe(3);
});

test('列選択の表示とクリック確定', async ({ page }) => {
  await page.evaluate(() => {
    attendCard('player', makeBoardCard(createCardFromBase('window_eater', 'player')), 'seat', 0, { attendanceSource: ATTENDANCE_SOURCE.HAND });
  });
  await expect(page.locator('#threeGesturesStage')).toBeVisible();
  await expect(page.locator('#threeGesturesMessage')).toContainText('教卓マスは対象に含みません');
  await expect.poll(() => page.evaluate(() => battlePresentationBusy({ ignoreFusionTasks: true }))).toBe(false);
  await page.locator('[data-card-id="window-eater-column-1"]').click();
  await expect(page.locator('#threeGesturesConfirmButton')).toBeEnabled();
  await page.screenshot({ path: '/tmp/chibatoru-window-eater-choice.png' });
  await page.locator('#threeGesturesConfirmButton').click();
  await expect.poll(() => page.evaluate(() => fusionTasksBusy())).toBe(false);
});
