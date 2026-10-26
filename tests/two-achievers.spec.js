const { test, expect } = require('@playwright/test');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const fs = require('node:fs');
const url = pathToFileURL(path.join(__dirname, '..', 'index.html')).href;
const body = 'このカードは横に連続した席マスを2つ使用する。このカードを手札から出席させたとき、相手の講義室にいる出席者1人をランダムに選び、1ダメージを与える。これを4回行う。その後、次の効果から1つを選ぶ。\n1. 自分のデッキから学生カードをランダムに2枚まで手札に加える。\n2. 相手の手札からカードをランダムに2枚まで選び、負荷を付与する。';

test.beforeEach(async ({ page }) => {
  await page.goto(url);
  await page.evaluate(() => {
    startCardTest('two_achievers'); scheduleOpponentAI = () => {};
    state.training.skipAnimations = true;
    state.phase = 'battle'; state.screen = 'battle'; state.currentSide = 'player';
    state.environment = null; state.kashikashiActionTurn = null;
    for (const side of ['player', 'opponent']) Object.assign(state.players[side], createPlayerState(), {
      will: 10, maxWill: 10, turnsTaken: 4, life: 20
    });
    state.players.player.hand = [createCardFromBase('two_achievers', 'player')];
    state.players.player.deck = ['general_student', 'ruler', 'aggro_student', 'general_teacher'].map(id => createCardFromBase(id, 'player'));
    state.players.opponent.hand = ['general_student', 'ruler'].map(id => createCardFromBase(id, 'opponent'));
    render();
  });
  await expect.poll(() => page.evaluate(() => battlePresentationBusy())).toBe(false);
});

async function attend(page, source = 'hand', side = 'player') {
  await page.evaluate(({ source, side }) => {
    const card = makeBoardCard(createCardFromBase('two_achievers', side));
    window.pair = card;
    attendCard(side, card, 'seat', 0, { attendanceSource: source }); render();
  }, { source, side });
}

async function choose(page, id) {
  await expect.poll(() => page.evaluate(() => state.pendingCardChoice?.context?.kind)).toBe('two_achievers');
  await page.evaluate(id => {
    state.pendingCardChoice.selectedIds = [`two-achievers-${id}`]; confirmCardChoiceSelection();
  }, id);
  await expect.poll(() => page.evaluate(() => fusionTasksBusy())).toBe(false);
}

test('定義・専攻・登録・本文・更新情報を一致させる', async ({ page }) => {
  const result = await page.evaluate(() => {
    const c = createCardFromBase('two_achievers', 'player');
    return { name: c.name, cost: c.cost, attack: c.attack, hp: c.hp, category: c.category,
      size: c.occupiedSeatSize, zones: c.allowedZones, direct: DIRECT_DECK_CARD_IDS.has(c.baseId),
      big: SPECIALTY_CARD_IDS.big.includes(c.baseId), text: cardRulesText(c),
      update: UPDATE_HISTORY[0].changes.find(c => c.title === '2人で成し遂げた学生たち').after };
  });
  expect(result).toMatchObject({ name: '2人で成し遂げた学生たち', cost: 6, attack: 5, hp: 3, category: 'big',
    size: { rows: 1, cols: 2 }, zones: ['seat'], direct: true, big: true });
  expect(result.text).toBe(body.replace('使用する。', '使用する。\n').replace('与える。これを', '与える。\nこれを').replace('負荷', '[負荷]'));
  expect(result.update).toContain(body);
  expect(fs.readFileSync(path.join(__dirname, '../card_rules.txt'), 'utf8')).toContain(JSON.stringify(body));
  const catalog = require('../server/card-catalog.json');
  expect(catalog.direct).toContain('two_achievers'); expect(catalog.specialties.big).toContain('two_achievers');
});

test('同じ生存者にも1点ずつ4回当たり、ダメージ後に選択する', async ({ page }) => {
  await page.evaluate(() => {
    const c = makeBoardCard(createCardFromBase('strong_student', 'opponent'));
    c.currentHp = c.maxHp = c.baseMaxHp = 10; state.players.opponent.board.seats[4] = c;
  });
  await attend(page);
  await expect.poll(() => page.evaluate(() => state.pendingCardChoice?.context?.kind)).toBe('two_achievers');
  expect(await page.evaluate(() => [state.players.opponent.board.seats[4].currentHp, state.players.player.hand.length])).toEqual([6, 1]);
  await choose(page, 'draw');
  expect(await page.evaluate(() => [state.players.player.hand.filter(c => c.type === 'student').length,
    state.players.player.deck.map(c => c.type).sort(), listBoardRefs('player').length, pair.occupiedSeatIndexes]))
    .toEqual([3, ['item', 'teacher'], 1, [0, 1]]);
});

test('破壊した対象を次弾に選ばず、教師も対象にする', async ({ page }) => {
  await page.evaluate(() => {
    const c = makeBoardCard(createCardFromBase('general_teacher', 'opponent'));
    c.currentHp = 1; state.players.opponent.board.teacher = c;
  });
  await attend(page); await choose(page, 'load');
  expect(await page.evaluate(() => [state.players.opponent.board.teacher, state.players.opponent.trash.length,
    state.players.opponent.hand.map(c => c.handLoadLevel)] )).toEqual([null, 1, [1, 1]]);
});

test('空の盤面でも後半を選べて、少ない対象は可能な分だけ処理する', async ({ page }) => {
  await page.evaluate(() => {
    state.players.opponent.hand = state.players.opponent.hand.slice(0, 1);
    addHandLoad(state.players.opponent.hand[0]);
  });
  await attend(page); await choose(page, 'load');
  expect(await page.evaluate(() => state.players.opponent.hand.map(c => c.handLoadLevel))).toEqual([2]);
});

for (const source of ['generated', 'trash']) test(`${source}出席では発動しない`, async ({ page }) => {
  await attend(page, source);
  expect(await page.evaluate(() => [fusionTasksBusy(), Boolean(state.pendingCardChoice), state.players.player.hand.length])).toEqual([false, false, 1]);
});

test('効果禁止時はダメージも選択も行わない', async ({ page }) => {
  await page.evaluate(() => { state.players.player.effectUseLockTurnsRemaining = 1; });
  await attend(page);
  expect(await page.evaluate(() => [fusionTasksBusy(), Boolean(state.pendingCardChoice)])).toEqual([false, false]);
});

test('AIは対象がない負荷を避け、学生を手札に加える', async ({ page }) => {
  await page.evaluate(() => {
    state.currentSide = 'opponent'; state.players.player.hand = [];
    state.players.opponent.deck = [createCardFromBase('general_student', 'opponent')];
  });
  await attend(page, 'hand', 'opponent');
  await expect.poll(() => page.evaluate(() => fusionTasksBusy())).toBe(false);
  expect(await page.evaluate(() => [state.players.opponent.deck.length, state.players.opponent.hand.length, Boolean(state.pendingCardChoice)])).toEqual([0, 3, false]);
});

test('AIは学生を探せない場合に負荷を選び、横2マスがなければ出席できない', async ({ page }) => {
  expect(await page.evaluate(() => {
    const card = state.players.player.hand[0];
    return [canPlaceCard('player', card, 'seat', 'player', 0),
      canPlaceCard('player', card, 'seat', 'player', 2), canPlaceCard('player', card, 'teacher', 'player', null)];
  })).toEqual([true, false, false]);
  await page.evaluate(() => {
    state.currentSide = 'opponent'; state.players.opponent.deck = [];
  });
  await attend(page, 'hand', 'opponent');
  await expect.poll(() => page.evaluate(() => fusionTasksBusy())).toBe(false);
  expect(await page.evaluate(() => state.players.player.hand.map(c => c.handLoadLevel))).toEqual([1]);
});

test('複数マスの相手を1人として扱い、各弾の防御を適用する', async ({ page }) => {
  await page.evaluate(() => {
    const c = makeBoardCard(createCardFromBase('plump_student', 'opponent'));
    attendCard('opponent', c, 'seat', 3, { attendanceSource: ATTENDANCE_SOURCE.GENERATED });
    c.defense = c.baseDefense = 1; window.targetPair = c;
  });
  await attend(page); await choose(page, 'load');
  expect(await page.evaluate(() => [targetPair.currentHp, listBoardRefs('opponent').length])).toEqual([5, 1]);
});

test('ゲストの後半選択をホストで確定し、負荷を同期する', async ({ page }) => {
  await page.evaluate(() => {
    Object.assign(state.online, { role: 'host', started: true, connected: true, conn: {} });
    window.outbox = []; onlineSend = message => { outbox.push(JSON.parse(JSON.stringify(message))); return true; };
    const c = makeBoardCard(createCardFromBase('strong_student', 'player'));
    c.currentHp = c.maxHp = c.baseMaxHp = 10; state.players.player.board.seats[4] = c;
  });
  await attend(page, 'hand', 'opponent');
  await expect.poll(() => page.evaluate(() => outbox.some(m => m.privateChoiceKind === 'fusion_effect_choice'))).toBe(true);
  expect(await page.evaluate(() => {
    const requestIndex = outbox.findIndex(m => m.privateChoiceKind === 'fusion_effect_choice');
    const snapshotIndex = outbox.slice(0, requestIndex).findLastIndex(m => m.type === 'gameState');
    return [snapshotIndex < requestIndex, outbox[snapshotIndex].snapshot.state.players.player.board.seats[4].currentHp];
  })).toEqual([true, 6]);
  await page.evaluate(() => {
    const request = outbox.find(m => m.privateChoiceKind === 'fusion_effect_choice');
    onlineHandleMessage({ type: 'thinItemChoiceResponse', protocol: ONLINE_PROTOCOL_VERSION, privateChoiceKind: 'fusion_effect_choice',
      requestId: request.requestId, selectedIds: ['two-achievers-load'] });
  });
  await expect.poll(() => page.evaluate(() => fusionTasksBusy())).toBe(false);
  expect(await page.evaluate(() => {
    const snapshot = onlineTransformSnapshotForGuest(onlineCreateSnapshot().state);
    return { loads: state.players.player.hand.map(c => c.handLoadLevel), hidden: snapshot.players.opponent.hand };
  })).toEqual({ loads: [1], hidden: [{ hidden: true }] });
});

test('ホストの負荷付与をゲスト自身の手札へ同期する', async ({ page }) => {
  await attend(page); await choose(page, 'load');
  expect(await page.evaluate(() => onlineTransformSnapshotForGuest(onlineCreateSnapshot().state)
    .players.player.hand.map(c => c.handLoadLevel))).toEqual([1, 1]);
});

test('演出付きの4発は順番に表示され、後半の選択より先に完了する', async ({ page }) => {
  await page.evaluate(() => {
    state.training.skipAnimations = false;
    Object.assign(state.online, { role: 'host', started: true }); onlineSend = () => true;
    const c = makeBoardCard(createCardFromBase('strong_student', 'opponent'));
    c.currentHp = c.maxHp = c.baseMaxHp = 10; state.players.opponent.board.seats[4] = c;
    state.effectFeedbackEvents = [];
  });
  await attend(page);
  await expect.poll(() => page.evaluate(() => state.pendingCardChoice?.context?.kind)).toBe('two_achievers');
  const events = await page.evaluate(() => state.effectFeedbackEvents.filter(e => e.target === 'card'));
  expect(events.map(e => e.text)).toEqual(['-1', '-1', '-1', '-1']);
  expect(new Set(events.map(e => e.instanceId)).size).toBe(1);
  for (let i = 1; i < events.length; i++) expect(events[i].occurredAt + events[i].delayMs
    - events[i - 1].occurredAt - events[i - 1].delayMs).toBeGreaterThanOrEqual(90);
  await choose(page, 'draw');
});

test('通常の手札出席から既存の選択画面をクリックして確定できる', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.evaluate(() => {
    placeCardFromHand('player', state.players.player.hand[0].instanceId, 'seat', 'player', 0, true);
  });
  const choices = page.locator('#threeGesturesHand button.card');
  await expect(choices).toHaveCount(2);
  await expect(choices.nth(0)).toContainText('学生カードを手札に加える');
  await expect(choices.nth(1)).toContainText('相手の手札に負荷を付与する');
  await choices.nth(0).click();
  await page.screenshot({ path: test.info().outputPath('two-achievers-choice.png') });
  await page.locator('#threeGesturesConfirmButton').click();
  await expect.poll(() => page.evaluate(() => fusionTasksBusy())).toBe(false);
  expect(await page.evaluate(() => [state.players.player.will, state.players.player.hand.length,
    state.players.player.board.seats[0].baseId])).toEqual([4, 2, 'two_achievers']);
});
