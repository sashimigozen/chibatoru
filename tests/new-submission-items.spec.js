const { test, expect } = require('@playwright/test');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const fs = require('node:fs');

const gameUrl = pathToFileURL(path.join(__dirname, '..', 'index.html')).href;
const newIds = ['tojirika', 'yohabari', 'habayose', 'footkiri'];

async function settle(page) {
  await expect.poll(() => page.evaluate(() => fusionTasksBusy()), { timeout: 15000 }).toBe(false);
}

async function choose(page, kind, baseId = null, extra = {}) {
  await expect.poll(() => page.evaluate(() => state.pendingCardChoice?.context?.kind), { timeout: 15000 }).toBe(kind);
  return page.evaluate(({ baseId, extra }) => {
    const choice = state.pendingCardChoice;
    const selected = baseId === false ? null : choice.cards.find(card =>
      (!baseId || card.baseId === baseId)
      && (extra.zone === undefined || card.choiceZone === extra.zone)
      && (extra.index === undefined || card.choiceIndex === extra.index));
    if (baseId !== false && !selected) throw new Error('選択肢がありません: ' + JSON.stringify({ baseId, extra, cards: choice.cards }));
    if (selected) toggleCardChoiceCard(selected.instanceId);
    confirmCardChoiceSelection();
    return selected?.instanceId;
  }, { baseId, extra });
}

async function use(page, baseId, cost = undefined) {
  return page.evaluate(({ baseId, cost }) => {
    const item = createCardFromBase(baseId, 'player');
    if (cost !== undefined) item.cost = cost;
    state.players.player.hand.push(item);
    castImmediateItem('player', item, false);
    return item.instanceId;
  }, { baseId, cost });
}

test.beforeEach(async ({ page }) => {
  await page.goto(gameUrl);
  await page.evaluate(() => {
    startCardTest('wonton_greeting');
    scheduleOpponentAI = () => {};
    state.training.skipAnimations = true;
    state.phase = 'battle'; state.currentSide = 'player'; state.actionTurn = 8;
    state.environment = null; state.battleHandLimit = 9; state.deckToHandLocks = [];
    for (const side of ['player', 'opponent']) Object.assign(state.players[side], {
      board: { teacher: null, seats: Array(9).fill(null) }, hand: [], deck: [], trash: [], late: [],
      life: 20, will: 20, maxWill: 20, pointScore: 0, pointSystemActive: false,
      submissionCounters: {}, effectUseLockTurnsRemaining: 0
    });
  });
});

test('4枚の定義・提出登録・本文・管理台帳・管理ログを同期する', async ({ page }) => {
  const catalog = require('../server/card-catalog.json');
  const ledger = JSON.parse(fs.readFileSync(path.join(__dirname, '../カード管理台帳.html'), 'utf8').match(/const CARDS = (\[[^\r\n]*\]);/)[1]);
  const rules = fs.readFileSync(path.join(__dirname, '../card_rules.txt'), 'utf8');
  const cards = await page.evaluate(ids => ids.map(id => {
    const base = CARD_BASES[id], card = createCardFromBase(id, 'player');
    return { id, name: base.name, cost: base.cost, type: base.type, submission: base.submission,
      hasPoint: !!base.hasPoint, direct: DIRECT_DECK_CARD_IDS.has(id), text: cardRulesText(card),
      handler: typeof SUBMISSION_EFFECT_HANDLERS[id] };
  }), newIds);
  for (const card of cards) {
    expect([card.cost, card.type, card.submission, card.direct, card.handler]).toEqual([2, 'item', true, true, 'function']);
    expect(card.hasPoint).toBe(card.id === 'tojirika');
    expect(card.text).toContain('[提出]');
    const raw = JSON.parse(rules.split('\n').find(line => line.trimStart().startsWith(card.id + ':')).trim().replace(/^[^:]+: /, '').replace(/,$/, ''));
    expect(card.text.replaceAll('\n', '')).toBe(raw.replaceAll('\n', ''));
    expect(ledger.find(entry => entry.id === card.id).effect).toBe(raw);
    expect(catalog.names[card.id]).toBe(card.name);
    expect(catalog.display[card.id].cost).toBe(2);
  }
  expect(await page.evaluate(() => getDeckEditorIds(''))).toEqual(catalog.deckOrder);
});

test('トジリカはヴァンパイア型だけを公開し、生成後に指名破壊・点数を処理する', async ({ page }) => {
  const vampireId = await page.evaluate(() => {
    const vampire = createCardFromBase('cafeteria_lady', 'player');
    state.players.player.hand = [vampire, createCardFromBase('general_student', 'player')];
    state.players.opponent.board.teacher = makeBoardCard(createCardFromBase('general_teacher', 'opponent'));
    return vampire.instanceId;
  });
  await use(page, 'tojirika');
  await expect.poll(() => page.evaluate(() => state.pendingCardChoice?.context?.kind)).toBe('tojirika_reveal');
  expect(await page.evaluate(() => state.pendingCardChoice.cards.map(card => card.baseId))).toEqual(['cafeteria_lady']);
  await choose(page, 'tojirika_reveal', 'cafeteria_lady');
  await expect.poll(() => page.evaluate(() => state.pendingCardChoice?.context?.kind)).toBe('point_destroy');
  expect(await page.evaluate(() => state.players.player.hand.filter(card => card.baseId === 'pinige').length)).toBe(1);
  await choose(page, 'point_destroy', 'general_teacher');
  await settle(page);
  expect(await page.evaluate(vampireId => ({
    vampireStillInHand: state.players.player.hand.some(card => card.instanceId === vampireId),
    teacher: state.players.opponent.board.teacher,
    point: state.players.player.pointScore, will: state.players.player.will,
    pinige: state.players.player.hand.filter(card => card.baseId === 'pinige').length
  }), vampireId)).toEqual({ vampireStillInHand: true, teacher: null, point: 1, will: 18, pinige: 1 });
});

test('トジリカの公開を断るとピニゲだけ生成し、対象は破壊しない', async ({ page }) => {
  await page.evaluate(() => {
    state.players.player.hand = [createCardFromBase('vampire', 'player')];
    state.players.opponent.board.seats[0] = makeBoardCard(createCardFromBase('strong_student', 'opponent'));
  });
  await use(page, 'tojirika'); await choose(page, 'tojirika_reveal', false); await settle(page);
  expect(await page.evaluate(() => [state.players.player.will, state.players.player.pointScore,
    state.players.player.hand.map(card => card.baseId), state.players.opponent.board.seats[0]?.baseId]))
    .toEqual([18, 0, ['vampire', 'pinige'], 'strong_student']);
});

for (const mode of ['cafeteria', 'cafeteria-tax', 'zero', 'discard']) {
  test(`トジリカは${mode}では公開・破壊せず1枚だけ生成する`, async ({ page }) => {
    await page.evaluate(mode => {
      state.players.player.hand = [createCardFromBase('vampire', 'player')];
      state.players.opponent.board.seats[0] = makeBoardCard(createCardFromBase('strong_student', 'opponent'));
      if (mode.startsWith('cafeteria')) state.environment = makeBoardCard(createCardFromBase('cafeteria', 'player'));
      if (mode === 'cafeteria-tax') state.players.player.handCostTaxUntilActionTurn = state.actionTurn + 1;
      const card = createCardFromBase('tojirika', 'player');
      if (mode === 'zero') card.cost = 0;
      state.players.player.hand.push(card);
      if (mode === 'discard') moveHandCardToTrash('player', card, { effectDiscard: true });
      else castImmediateItem('player', card, false);
    }, mode);
    await settle(page);
    expect(await page.evaluate(() => [state.players.player.will, state.players.player.pointScore,
      state.players.player.hand.map(card => card.baseId), state.players.opponent.board.seats[0]?.baseId,
      state.pendingCardChoice])).toEqual([20, 0, ['vampire', 'pinige'], 'strong_student', null]);
  });
}

test('トジリカは実支払い1でも公開破壊を使える', async ({ page }) => {
  await page.evaluate(() => {
    state.players.player.hand = [createCardFromBase('vampire', 'player')];
    state.players.opponent.board.seats[0] = makeBoardCard(createCardFromBase('general_student', 'opponent'));
  });
  await use(page, 'tojirika', 1);
  await choose(page, 'tojirika_reveal', 'vampire'); await choose(page, 'point_destroy'); await settle(page);
  expect(await page.evaluate(() => [state.players.player.will, state.players.player.pointScore,
    state.players.opponent.board.seats[0]])).toEqual([19, 1, null]);
});

test('ヨハバリの有料使用は双方の3種だけを数え、手札へ生成する', async ({ page }) => {
  await page.evaluate(() => {
    for (const [side, index, id] of [['player', 0, 'single_cell'], ['player', 1, 'midge'],
      ['opponent', 0, 'organism'], ['opponent', 1, 'perfect_mutant']]) {
      state.players[side].board.seats[index] = makeBoardCard(createCardFromBase(id, side));
    }
    state.players.player.deck = [createCardFromBase('general_student', 'player')];
  });
  await use(page, 'yohabari', 1); await settle(page);
  expect(await page.evaluate(() => [state.players.player.will, state.players.player.hand.map(card => card.baseId),
    state.players.player.deck.map(card => card.baseId)])).toEqual([19, ['single_cell', 'single_cell', 'single_cell'], ['general_student']]);
});

for (const mode of ['zero', 'discard']) {
  test(`ヨハバリの${mode}は手札でなくデッキへ5枚生成する`, async ({ page }) => {
    await page.evaluate(mode => {
      state.players.player.deck = [createCardFromBase('general_student', 'player')];
      state.players.player.board.seats[0] = makeBoardCard(createCardFromBase('single_cell', 'player'));
      const card = createCardFromBase('yohabari', 'player');
      if (mode === 'zero') card.cost = 0;
      state.players.player.hand = [card];
      if (mode === 'discard') moveHandCardToTrash('player', card, { effectDiscard: true });
      else castImmediateItem('player', card, false);
    }, mode);
    await settle(page);
    expect(await page.evaluate(() => [state.players.player.will, state.players.player.hand.length,
      state.players.player.deck.filter(card => card.baseId === 'single_cell').length,
      state.players.player.deck.filter(card => card.baseId === 'general_student').length])).toEqual([20, 0, 5, 1]);
  });
}

for (const count of [0, 1, 2]) {
  test(`フットキリは同名を除外し対象${count}枚だけを手札へ加える`, async ({ page }) => {
    await page.evaluate(count => {
      state.players.player.deck = ['footkiri', 'footkiri', 'general_student', ...['yohabari', 'wonton_ki'].slice(0, count)]
        .map(id => createCardFromBase(id, 'player'));
    }, count);
    await use(page, 'footkiri'); await settle(page);
    expect(await page.evaluate(() => state.players.player.hand.map(card => card.baseId).sort()))
      .toEqual(['yohabari', 'wonton_ki'].slice(0, count).sort());
    expect(await page.evaluate(() => state.players.player.deck.map(card => card.baseId).sort()))
      .toEqual(['footkiri', 'footkiri', 'general_student']);
  });
}

test('フットキリで手札上限を超えた提出カードは再発動しない', async ({ page }) => {
  await page.evaluate(() => {
    state.players.player.hand = Array.from({ length: 8 }, () => createCardFromBase('general_student', 'player'));
    state.players.player.deck = ['yohabari', 'yohabari'].map(id => createCardFromBase(id, 'player'));
  });
  await use(page, 'footkiri'); await settle(page);
  expect(await page.evaluate(() => [state.players.player.hand.length, state.players.player.deck.length,
    state.players.player.trash.filter(card => card.baseId === 'yohabari').length])).toEqual([9, 0, 1]);
});

test('フットキリは効果捨てでも検索し、山札から手札への制限を守る', async ({ page }) => {
  await page.evaluate(() => {
    const card = createCardFromBase('footkiri', 'player');
    state.players.player.hand = [card];
    state.players.player.deck = [createCardFromBase('tojirika', 'player')];
    addDeckToHandLock('opponent');
    moveHandCardToTrash('player', card, { effectDiscard: true });
  });
  await settle(page);
  expect(await page.evaluate(() => [state.players.player.hand.length, state.players.player.deck.length,
    state.players.player.will])).toEqual([0, 1, 20]);
});

test('ハバヨセ!は名前または本文にU太があるカードを選べる', async ({ page }) => {
  await page.evaluate(() => {
    state.players.player.deck = ['yuta', 'dark_yuta', 'sexual_eye', 'general_student'].map(id => createCardFromBase(id, 'player'));
    state.players.player.will = 2;
  });
  await use(page, 'habayose');
  await expect.poll(() => page.evaluate(() => state.pendingCardChoice?.context?.kind)).toBe('habayose_search');
  expect(await page.evaluate(() => state.pendingCardChoice.cards.map(card => card.baseId).sort()))
    .toEqual(['dark_yuta', 'sexual_eye', 'yuta']);
  await choose(page, 'habayose_search', 'sexual_eye'); await settle(page);
  expect(await page.evaluate(() => [state.players.player.hand.map(card => card.baseId), state.players.player.will]))
    .toEqual([['sexual_eye'], 0]);
});

for (const zone of ['seat', 'teacher']) {
  test(`ハバヨセ!は進化元なしで${zone}へ直接出席し自身を装備する`, async ({ page }) => {
    const sourceId = await page.evaluate(() => {
      state.players.player.hand = [createCardFromBase('dark_yuta', 'player')];
      state.players.player.deck = [createCardFromBase('sexual_eye', 'player')];
      const card = createCardFromBase('habayose', 'player');
      state.players.player.hand.push(card);
      castImmediateItem('player', card, false);
      return card.instanceId;
    });
    await choose(page, 'habayose_search', 'sexual_eye');
    await choose(page, 'attendance_optional', 'dark_yuta');
    await choose(page, 'attendance_seats', null, { zone, ...(zone === 'seat' ? { index: 4 } : {}) });
    await choose(page, 'habayose_equip', 'habayose'); await settle(page);
    expect(await page.evaluate(({ zone, sourceId }) => {
      const card = zone === 'seat' ? state.players.player.board.seats[4] : state.players.player.board.teacher;
      return { baseId: card?.baseId, stats: [card?.attack, card?.maxHp], equipment: equipmentEntriesForCard(card).map(entry => entry.baseId),
        cheerful: hasKeyword(card, '陽気'), will: state.players.player.will,
        hand: state.players.player.hand.map(entry => entry.baseId), sourceInTrash: state.players.player.trash.some(entry => entry.instanceId === sourceId) };
    }, { zone, sourceId })).toEqual({ baseId: 'dark_yuta', stats: [5, 5], equipment: ['habayose'], cheerful: true,
      will: 15, hand: ['sexual_eye'], sourceInTrash: false });
    // The source is one physical card; detaching it does not submit again.
    await page.evaluate(zone => destroyBoardCard({ owner: 'player', zone, index: zone === 'seat' ? 4 : null }), zone);
    await settle(page);
    expect(await page.evaluate(sourceId => state.players.player.trash.filter(entry => entry.baseId === 'habayose')
      .map(entry => entry.instanceId), sourceId)).toEqual([sourceId]);
  });
}

test('ハバヨセ!は出席を断れば追加戦意を消費せず手札に裏U太を残す', async ({ page }) => {
  await page.evaluate(() => { state.players.player.hand = [createCardFromBase('dark_yuta', 'player')]; });
  await use(page, 'habayose'); await choose(page, 'attendance_optional', false); await settle(page);
  expect(await page.evaluate(() => [state.players.player.will, state.players.player.hand.map(card => card.baseId),
    listBoardRefs('player').length])).toEqual([18, ['dark_yuta'], 0]);
});

test('ハバヨセ!は自分のターンの効果捨てから追加3だけ支払って出席できる', async ({ page }) => {
  await page.evaluate(() => {
    const card = createCardFromBase('habayose', 'player');
    state.players.player.hand = [card, createCardFromBase('dark_yuta', 'player')];
    moveHandCardToTrash('player', card, { effectDiscard: true });
  });
  await choose(page, 'attendance_optional', 'dark_yuta');
  await choose(page, 'attendance_seats', null, { zone: 'teacher' });
  await choose(page, 'habayose_equip', false); await settle(page);
  expect(await page.evaluate(() => [state.players.player.will, state.players.player.board.teacher?.baseId,
    equipmentEntriesForCard(state.players.player.board.teacher).length, state.players.player.trash.map(card => card.baseId)]))
    .toEqual([17, 'dark_yuta', 0, ['habayose']]);
});

test('ハバヨセ!は相手ターンの提出では検索だけ行い、追加支払いを提示しない', async ({ page }) => {
  await page.evaluate(() => {
    state.currentSide = 'opponent';
    const card = createCardFromBase('habayose', 'player');
    state.players.player.hand = [card, createCardFromBase('dark_yuta', 'player')];
    state.players.player.deck = [createCardFromBase('sexual_eye', 'player')];
    moveHandCardToTrash('player', card, { effectDiscard: true });
  });
  await choose(page, 'habayose_search', 'sexual_eye'); await settle(page);
  expect(await page.evaluate(() => [state.players.player.will, state.players.player.hand.map(card => card.baseId),
    listBoardRefs('player').length, state.pendingCardChoice])).toEqual([20, ['dark_yuta', 'sexual_eye'], 0, null]);
});

test('校外のハバヨセ!はU太の枚数へ加算され、回収後は元の持ち物のまま', async ({ page }) => {
  await page.evaluate(() => {
    state.players.player.trash = [createCardFromBase('habayose', 'player')];
  });
  await use(page, 'greeting_3000'); await settle(page);
  expect(await page.evaluate(() => state.players.opponent.life)).toBe(19);
  await use(page, 'yutakun_yutakun'); await settle(page);
  expect(await page.evaluate(() => state.players.player.hand.map(card => [card.baseId, card.name, card.type])))
    .toEqual([['habayose', 'ハバヨセ!', 'item']]);
});

for (const id of newIds) {
  test(`カード一覧のテストから開始状態を変えずに使える ${id}`, async ({ page }) => {
    test.setTimeout(45000);
    await page.locator('#homeNavDeckButton').click();
    await page.locator('[data-case-view="cards"]').click();
    const name = await page.evaluate(id => CARD_BASES[id].name, id);
    await page.locator('#cardsCatalogSearch').fill(name);
    await page.locator(`[data-catalog-card="${id}"]`).click();
    await page.locator('#cardTestStartButton').click();
    await page.evaluate(() => { state.training.skipAnimations = true; scheduleOpponentAI = () => {}; });
    await expect.poll(() => page.evaluate(() => battlePresentationBusy())).toBe(false);
    const before = await page.evaluate(id => ({ will: state.players.player.will,
      card: state.players.player.hand.find(card => card.baseId === id)?.instanceId,
      ownDeck: state.players.player.deck.length, enemyDeck: state.players.opponent.deck.length }), id);
    expect(before.card).toBeTruthy(); expect(before.ownDeck).toBeGreaterThan(0); expect(before.enemyDeck).toBeGreaterThan(0);
    await page.locator(`#playerHand [data-base-id="${id}"]`).first().click();
    if (id === 'tojirika') {
      await choose(page, 'tojirika_reveal'); await choose(page, 'point_destroy');
    }
    if (id === 'habayose') {
      await choose(page, 'habayose_search', 'dark_yuta');
      await choose(page, 'attendance_optional', 'dark_yuta');
      await choose(page, 'attendance_seats', null, { zone: 'teacher' });
      await choose(page, 'habayose_equip', 'habayose');
    }
    await settle(page);
    expect(await page.evaluate(instanceId => state.players.player.hand.some(card => card.instanceId === instanceId), before.card)).toBe(false);
    if (id === 'tojirika') expect(await page.evaluate(() => state.players.player.hand.some(card => card.baseId === 'pinige'))).toBe(true);
    if (id === 'yohabari') expect(await page.evaluate(() => state.players.player.hand.some(card => card.baseId === 'single_cell'))).toBe(true);
    if (id === 'habayose') expect(await page.evaluate(() => state.players.player.board.teacher?.baseId)).toBe('dark_yuta');
    if (id === 'footkiri') expect(await page.evaluate(() => state.players.player.deck.length)).toBe(before.ownDeck - 2);
  });
}
