const { test, expect } = require('@playwright/test');
const { pathToFileURL } = require('node:url');
const path = require('node:path');

test.beforeEach(async ({ page }) => {
  await page.goto(pathToFileURL(path.join(__dirname, '..', 'index.html')).href);
  await page.evaluate(() => {
    startCardTest('umaibo'); state.environment = null;
    state.training.skipAnimations = true; scheduleOpponentAI = () => {};
    for (const side of ['player', 'opponent']) {
      state.players[side].trash = [];
      state.players[side].board = { teacher: null, seats: Array(9).fill(null) };
    }
  });
});

test('両側の完成品7種類と素材情報のないコピーは、対応する通常素材を一度だけ生成する', async ({ page }) => {
  const results = await page.evaluate(() => {
    const recipes = [...Object.entries(HORSE_PAIR_RESULTS), [HORSE_MATERIAL_IDS.join(','), 'where_uma_bone_maibo']];
    return ['player', 'opponent'].flatMap(owner => recipes.map(([recipe, baseId]) => {
      state.players[owner].trash = [];
      const card = makeBoardCard(createCardFromBase(baseId, owner));
      state.players[owner].board.seats[0] = card;
      const ref = { owner, zone: 'seat', index: 0 };
      destroyBoardRefsToTrash([ref, ref], { showDestroyFeedback: false });
      const trash = state.players[owner].trash;
      const snapshotTrash = onlineCreateSnapshot().state.players[owner].trash;
      return { expected: recipe.split(','), actual: trash.map(c => c.baseId),
        fresh: new Set(trash.map(c => c.instanceId)).size === trash.length,
        recoverable: trash.every(c => canRecoverTrashCard(c) && c.owner === owner && !isTokenCard(c)),
        snapshot: snapshotTrash.map(c => c.baseId), vanished: card.tokenVanished === true };
    }));
  });
  for (const result of results) {
    expect(result.actual).toEqual(result.expected);
    expect(result.snapshot).toEqual(result.expected);
    expect(result.fresh && result.recoverable && result.vanished).toBe(true);
  }
});

test('体力0の破壊でも素材を生成し、破壊を防がれた場合は生成しない', async ({ page }) => {
  expect(await page.evaluate(() => {
    const card = makeBoardCard(createCardFromBase('umaibo', 'player'));
    card.padlockEquipment = createCardFromBase('padlock', 'player');
    state.players.player.board.seats[0] = card;
    const prevented = destroyBoardCard({ owner: 'player', zone: 'seat', index: 0 }) === null;
    const before = state.players.player.trash.length;
    card.currentHp = 0; cleanupDestroyedCards();
    return { prevented, before, trash: state.players.player.trash.map(c => c.baseId) };
  })).toEqual({ prevented: true, before: 0, trash: ['padlock', 'fusion_uma', 'fusion_maibo'] });
});

test('遠くから参加する学生で出席したコピーも素材を生成し、元の手札は残る', async ({ page }) => {
  expect(await page.evaluate(async () => {
    isCpuControlledBattleSide = () => true;
    const original = createCardFromBase('umaibo', 'player');
    state.players.player.hand = [original];
    resolveHorseAttendance('player', createCardFromBase('remote_participant_student', 'player'));
    await fusionEffectTail;
    const ref = listBoardRefs('player')[0];
    const copy = getBoardCardFromRef(ref);
    destroyBoardCard(ref);
    return { copy: copy.instanceId !== original.instanceId,
      hand: state.players.player.hand[0].instanceId === original.instanceId,
      trash: state.players.player.trash.map(c => c.baseId) };
  })).toEqual({ copy: true, hand: true, trash: ['fusion_uma', 'fusion_maibo'] });
});

test('破壊ではない校外送り・手札破棄では素材を生成しない', async ({ page }) => {
  expect(await page.evaluate(() => {
    for (const options of [{ showDestroyFeedback: false, reason: 'アカデミックムーブ' }, { isDestruction: false, reason: '出席不可' }]) {
      state.players.player.board.seats[0] = makeBoardCard(createCardFromBase('umaibo', 'player'));
      destroyBoardCard({ owner: 'player', zone: 'seat', index: 0 }, options);
    }
    state.players.player.board.seats[0] = makeBoardCard(createCardFromBase('umaibo', 'player'));
    destroyBoardRefsToTrash([{ owner: 'player', zone: 'seat', index: 0 }], { isDestruction: false });
    const handCard = createCardFromBase('umaibo', 'player');
    state.players.player.hand = [handCard]; moveHandCardToTrash('player', handCard);
    return state.players.player.trash.length;
  })).toBe(0);
});
