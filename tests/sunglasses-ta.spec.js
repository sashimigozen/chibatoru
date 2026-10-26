const { test, expect } = require('@playwright/test');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const fs = require('node:fs');
const url = pathToFileURL(path.join(__dirname, '..', 'index.html')).href;
const text = 'このカードを手札から出席させたとき、自分の講義室に「プロ言の長」がいるなら、相手の講義室にいる学生すべてに1ダメージを与える。';
const proText = 'このカードを手札から教卓マスに出席させたとき、自分の1行1列と1行3列にTAを1人ずつ出席させ、「咆哮」1枚を手札に生成する。\nこのカードが教卓マスにいるかぎり、自分の講義室にいる「TA」とつく出席者すべての体力を+1する。';

test.beforeEach(async ({ page }) => {
  await page.goto(url);
  await page.evaluate(() => {
    startCardTest('sunglasses_ta'); scheduleOpponentAI = () => {};
    state.training.skipAnimations = true; state.environment = null;
    Object.assign(state, { screen: 'battle', phase: 'battle', currentSide: 'player', actionTurn: 8 });
    for (const side of ['player', 'opponent']) Object.assign(state.players[side], createPlayerState(), {
      life: 20, will: 10, maxWill: 10, turnsTaken: 4
    });
    window.put = (id, side, index = null) => {
      const c = makeBoardCard(createCardFromBase(id, side));
      if (index === null) state.players[side].board.teacher = c;
      else state.players[side].board.seats[index] = c;
      return c;
    };
    state.players.player.hand = [createCardFromBase('sunglasses_ta', 'player')];
    render();
  });
  await expect.poll(() => page.evaluate(() => battlePresentationBusy())).toBe(false);
});

async function attend(page, side = 'player', source = 'hand', index = 0) {
  await page.evaluate(({ side, source, index }) => {
    window.sunglasses = makeBoardCard(createCardFromBase('sunglasses_ta', side));
    attendCard(side, sunglasses, 'seat', index, { attendanceSource: source });
    cleanupDestroyedCards(); applyBoardAuras(); render();
  }, { side, source, index });
}

test('能力値・共通カード登録・完成本文・更新情報・サーバー登録を揃える', async ({ page }) => {
  const result = await page.evaluate(() => {
    const c = createCardFromBase('sunglasses_ta', 'player');
    return { name: c.name, stats: [c.cost, c.attack, c.hp], type: c.type, category: c.category,
      text: cardRulesText(c), proText: cardRulesText(createCardFromBase('pro_k', 'player')),
      direct: DIRECT_DECK_CARD_IDS.has(c.baseId), common: SPECIALTY_CARD_IDS.common.includes(c.baseId),
      update: UPDATE_HISTORY[0], commonIds: SPECIALTY_CARD_IDS.common };
  });
  expect(result).toMatchObject({ name: 'グラサンTA', stats: [3, 1, 1], type: 'student', category: 'common', text,
    proText, direct: true, common: true });
  expect(result.update.version).toBe('ver.0.33.0');
  expect(result.update.changes.find(c => c.title === 'グラサンTA').after).toContain(text);
  const proChange = result.update.changes.find(c => c.title === 'プロ言の長');
  expect(proChange.before).toContain('自分のTAすべての体力を+1する。');
  expect(proChange.after.replace(/\n/g, '')).toContain(proText.replace(/\n/g, ''));
  const rules = fs.readFileSync(path.join(__dirname, '../card_rules.txt'), 'utf8');
  expect(rules).toContain(JSON.stringify(text));
  expect(rules).toContain(JSON.stringify(proText.replace('\n', '')));
  const catalog = require('../server/card-catalog.json');
  expect(catalog.direct).toContain('sunglasses_ta');
  expect(catalog.specialties.common).toEqual(result.commonIds);
});

for (const side of ['player', 'opponent']) test(`${side}: 全行・教卓の学生だけに1ダメージを与える`, async ({ page }) => {
  await page.evaluate(side => {
    const other = oppositeSide(side); state.currentSide = side;
    put('pro_k', side); put('general_student', side, 8);
    for (const index of [0, 3, 8]) put('strong_student', other, index);
    put('enemy_student', other); put('general_teacher', other, 1); put('cafeteria_lady', other, 2);
    applyBoardAuras();
    window.before = [0, 3, 8, 1, 2].map(i => state.players[other].board.seats[i].currentHp);
  }, side);
  await attend(page, side);
  expect(await page.evaluate(side => {
    const p = state.players[oppositeSide(side)];
    return { loss: [0, 3, 8, 1, 2].map((i, n) => before[n] - p.board.seats[i].currentHp),
      teacherHp: p.board.teacher.currentHp, life: p.life,
      ownHp: state.players[side].board.seats[8].currentHp, sunglassesHp: sunglasses.maxHp };
  }, side)).toEqual({ loss: [1, 1, 1, 0, 0], teacherHp: 1, life: 20, ownHp: 2, sunglassesHp: 2 });
});

test('相手側・手札のプロ言の長は条件にならず、条件なしでも出席できる', async ({ page }) => {
  await page.evaluate(() => {
    put('pro_k', 'opponent'); put('strong_student', 'opponent', 4);
    state.players.player.hand.push(createCardFromBase('pro_k', 'player'));
  });
  expect(await page.evaluate(() => canPlaceCard('player', state.players.player.hand[0], 'seat', 'player', 0))).toBe(true);
  await attend(page);
  expect(await page.evaluate(() => [state.players.opponent.board.seats[4].currentHp, sunglasses.maxHp])).toEqual([7, 1]);
});

test('プロ言の長が席マスにいる場合もダメージ条件を満たすが、体力強化は教卓限定', async ({ page }) => {
  await page.evaluate(() => { put('pro_k', 'player', 8); put('strong_student', 'opponent', 4); });
  await attend(page);
  expect(await page.evaluate(() => [state.players.opponent.board.seats[4].currentHp, sunglasses.maxHp])).toEqual([6, 1]);
});

for (const source of ['generated', 'trash']) test(`${source}: 効果による出席ではダメージを与えないが継続強化は受ける`, async ({ page }) => {
  await page.evaluate(() => { put('pro_k', 'player'); put('strong_student', 'opponent', 4); });
  await attend(page, 'player', source);
  expect(await page.evaluate(() => [state.players.opponent.board.seats[4].currentHp, sunglasses.maxHp])).toEqual([7, 2]);
});

test('TA・TA隊長・TAキラー・グラサンTAを強化し、重ねて再計算しても増えない', async ({ page }) => {
  const result = await page.evaluate(() => {
    put('pro_k', 'player');
    ['ta', 'ta_squad', 'ta_killer', 'sunglasses_ta', 'general_student'].forEach((id, i) => put(id, 'player', i));
    put('sunglasses_ta', 'opponent', 0);
    for (let i = 0; i < 3; i++) applyBoardAuras();
    return { hp: state.players.player.board.seats.filter(Boolean).map(c => c.maxHp),
      enemy: state.players.opponent.board.seats[0].maxHp,
      hand: state.players.player.hand[0].maxHp,
      lines: battleCardStatEffectEntries(state.players.player.board.seats[3]) };
  });
  expect(result).toMatchObject({ hp: [2, 2, 2, 2, 2], enemy: 1, hand: 1 });
  expect(result.lines).toEqual([{ label: '最大体力 +1', lines: ['プロ言の長：+1'] }]);
});

test('プロ言の長の退場・効果無効・カシカシで体力強化と表示が外れる', async ({ page }) => {
  for (const mode of ['leave', 'padlock', 'kashikashi']) {
    const result = await page.evaluate(mode => {
      state.kashikashiActionTurn = null;
      const pro = put('pro_k', 'player'); const target = put('sunglasses_ta', 'player', 0);
      applyBoardAuras();
      if (mode === 'leave') state.players.player.board.teacher = null;
      if (mode === 'padlock') attachPadlock(pro, createCardFromBase('padlock', 'opponent'));
      if (mode === 'kashikashi') state.kashikashiActionTurn = state.actionTurn;
      applyBoardAuras();
      return [target.maxHp, target.currentHp, battleCardStatEffectEntries(target)];
    }, mode);
    expect(result).toEqual([1, 1, []]);
  }
});

test('出席時効果の禁止中は発動しないが、プロ言の長の印刷効果が無効でも在席条件は満たす', async ({ page }) => {
  await page.evaluate(() => {
    const pro = put('pro_k', 'player'); attachPadlock(pro, createCardFromBase('padlock', 'opponent'));
    put('strong_student', 'opponent', 4); state.players.player.effectUseLockTurnsRemaining = 1;
  });
  await attend(page);
  expect(await page.evaluate(() => state.players.opponent.board.seats[4].currentHp)).toBe(7);
  await page.evaluate(() => { state.players.player.effectUseLockTurnsRemaining = 0; });
  await attend(page, 'player', 'hand', 1);
  expect(await page.evaluate(() => [state.players.opponent.board.seats[4].currentHp, sunglasses.maxHp])).toEqual([6, 1]);
});

test('全体ダメージは超注目で範囲を狭めず、複数マスの学生にも1回だけ当たる', async ({ page }) => {
  await page.evaluate(() => {
    put('pro_k', 'player');
    const decoy = put('strong_student', 'opponent', 8); decoy.keywords = ['超注目'];
    const multi = makeBoardCard(createCardFromBase('plump_student', 'opponent'));
    attendCard('opponent', multi, 'seat', 0, { attendanceSource: ATTENDANCE_SOURCE.GENERATED });
    window.multi = multi;
  });
  await attend(page);
  expect(await page.evaluate(() => [multi.currentHp, state.players.opponent.board.seats[8].currentHp])).toEqual([4, 6]);
});

test('防御と学生へのダメージ軽減を適用する', async ({ page }) => {
  await page.evaluate(() => {
    put('pro_k', 'player');
    const protectedStudent = put('strong_student', 'opponent', 8);
    protectedStudent.defense = protectedStudent.baseDefense = 1;
    put('acting_out_woman', 'opponent', 0); put('acting_out_man_2', 'opponent', 1);
    applyBoardAuras();
  });
  await attend(page);
  expect(await page.evaluate(() => [state.players.opponent.board.seats[8].currentHp,
    state.players.opponent.board.seats[0].currentHp, state.players.opponent.board.seats[1].currentHp])).toEqual([7, 3, 3]);
});

test('AIはプロ言の長がいる場合だけ全体ダメージを評価し、TAの強化も見積もる', async ({ page }) => {
  const result = await page.evaluate(() => {
    const c = createCardFromBase('sunglasses_ta', 'opponent'); put('general_student', 'player', 4);
    const without = scoreAiAttendanceRemoval('opponent', c, 'seat', 0);
    put('pro_k', 'opponent');
    const active = scoreAiAttendanceRemoval('opponent', c, 'seat', 0);
    const aura = scoreAiPlacementAuras('opponent', c, 'seat', 0);
    state.players.opponent.effectUseLockTurnsRemaining = 1;
    return { without, active, aura, suppressed: scoreAiAttendanceRemoval('opponent', c, 'seat', 0) };
  });
  expect(result.without).toBe(0); expect(result.active).toBeGreaterThan(0);
  expect(result.aura).toBeGreaterThan(0); expect(result.suppressed).toBe(0);
});

test('カードテストで条件を用意し、手札から出席して強化表示まで確認できる', async ({ page }) => {
  await page.evaluate(() => {
    startCardTest('sunglasses_ta'); state.training.skipAnimations = true;
  });
  await expect.poll(() => page.evaluate(() => battlePresentationBusy())).toBe(false);
  expect(await page.evaluate(() => [state.players.player.board.teacher.baseId,
    state.players.player.hand.some(c => c.baseId === 'sunglasses_ta')])).toEqual(['pro_k', true]);
  await page.evaluate(() => {
    const c = state.players.player.hand.find(c => c.baseId === 'sunglasses_ta');
    const seat = PLAYER_SEAT_ORDER.find(i => isBoardSlotOpen('player', 'seat', i));
    placeCardFromHand('player', c.instanceId, 'seat', 'player', seat, true);
  });
  await expect.poll(() => page.evaluate(() => battlePresentationBusy())).toBe(false);
  expect(await page.evaluate(() => listBoardRefs('player').map(getBoardCardFromRef)
    .find(c => c.baseId === 'sunglasses_ta').maxHp)).toBe(2);
  await page.screenshot({ path: test.info().outputPath('sunglasses-ta-board.png') });
});

test('ゲストの出席コマンドでもダメージと体力強化をホストで処理して同期する', async ({ page: host, browser }) => {
  const guest = await browser.newPage();
  try {
    await guest.goto(url);
    await guest.evaluate(() => { startCardTest('sunglasses_ta'); scheduleOpponentAI = () => {}; state.training.skipAnimations = true; });
    for (const [page, role] of [[host, 'host'], [guest, 'guest']]) await page.evaluate(role => {
      Object.assign(state.online, { role, started: true, connected: true, conn: {} });
      window.outbox = []; onlineSend = m => { outbox.push(JSON.parse(JSON.stringify(m))); return true; };
    }, role);
    const snapshot = await host.evaluate(() => {
      state.currentSide = 'opponent'; put('pro_k', 'opponent'); put('strong_student', 'player', 4);
      state.players.opponent.hand = [createCardFromBase('sunglasses_ta', 'opponent')]; render();
      return onlineCreateSnapshot();
    });
    await guest.evaluate(snapshot => onlineHandleMessage({ type: 'gameState', protocol: ONLINE_PROTOCOL_VERSION, snapshot }), snapshot);
    await guest.evaluate(() => onlineSendCommand('playCard', { instanceId: state.players.player.hand[0].instanceId,
      zone: 'seat', owner: 'player', index: 0 }));
    const command = await guest.evaluate(() => outbox.find(m => m.command));
    await host.evaluate(message => onlineHandleMessage({ ...message, type: 'command', protocol: ONLINE_PROTOCOL_VERSION }), command);
    await expect.poll(() => host.evaluate(() => state.players.opponent.board.seats[0]?.maxHp)).toBe(2);
    await expect.poll(() => host.evaluate(() => battlePresentationBusy())).toBe(false);
    const resolved = await host.evaluate(() => onlineCreateSnapshot());
    await guest.evaluate(snapshot => onlineHandleMessage({ type: 'gameState', protocol: ONLINE_PROTOCOL_VERSION, snapshot }), resolved);
    expect(await guest.evaluate(() => [state.players.player.board.seats[0].baseId,
      state.players.player.board.seats[0].maxHp, state.players.opponent.board.seats[4].currentHp,
      state.players.player.will])).toEqual(['sunglasses_ta', 2, 6, 7]);
  } finally { await guest.close(); }
});
