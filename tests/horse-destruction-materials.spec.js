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
        history: state.recentBoardTrash.some(entry => entry.card.instanceId === card.instanceId), snapshot: snapshotTrash.map(c => c.baseId), vanished: card.tokenVanished === true };
    }));
  });
  for (const result of results) {
    expect(result.actual).toEqual(result.expected);
    expect(result.snapshot).toEqual(result.expected);
    expect(result.history).toBe(false);
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
    return state.players.player.trash.map(card => card.baseId);
  })).toEqual(['umaibo', 'umaibo', 'umaibo', 'umaibo']);
});

test('素材に分解された完成品は逆行・幸せの青い鳥・再攻撃の対象にしない', async ({ page }) => {
 const result=await page.evaluate(()=>{
  const results=[];
  for(const attackerId of ['happy_blue_bird','trendy_student'])for(const targetId of ['extra_student','umaibo']){
   for(const side of ['player','opponent'])Object.assign(state.players[side],{board:{teacher:null,seats:Array(9).fill(null)},trash:[]});
   state.recentBoardTrash=[];state.actionTurn=2;
   const attacker=makeBoardCard(createCardFromBase(attackerId,'player'));attacker.attack=20;attacker.currentHp=20;attacker.hasAttacked=true;attacker.attacksUsedThisTurn=1;
   const target=makeBoardCard(createCardFromBase(targetId,'opponent'));state.players.player.board.seats[0]=attacker;state.players.opponent.board.seats[0]=target;
   const resolved=resolveCardAttackWithBoardCleanup(attacker,{owner:'opponent',zone:'seat',index:0});
   const history=state.recentBoardTrash.length;
   state.actionTurn=3;const restored=restoreRecentBoardCard('opponent');
   results.push({attackerId,targetId,bird:resolved.birdSummoned,attacked:attacker.hasAttacked,history,restored});
  }
  return results;
 });
 expect(result).toEqual([
  {attackerId:'happy_blue_bird',targetId:'extra_student',bird:true,attacked:true,history:1,restored:false},
  {attackerId:'happy_blue_bird',targetId:'umaibo',bird:false,attacked:true,history:0,restored:false},
  {attackerId:'trendy_student',targetId:'extra_student',bird:false,attacked:false,history:1,restored:true},
  {attackerId:'trendy_student',targetId:'umaibo',bird:false,attacked:true,history:0,restored:false}
 ]);
});
