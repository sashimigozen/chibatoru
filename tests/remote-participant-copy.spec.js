const { test, expect } = require('@playwright/test');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const url = pathToFileURL(path.join(__dirname, '..', 'index.html')).href;

test.beforeEach(async({page})=>{
  await page.goto(url);
  await page.evaluate(()=>{
    startCardTest('remote_participant_student');scheduleOpponentAI=()=>{};state.training.skipAnimations=true;state.gameOver=false;state.environment=null;
    for(const side of ['player','opponent'])Object.assign(state.players[side],{board:{teacher:null,seats:Array(9).fill(null)},hand:[],deck:[],trash:[],will:0,life:20});
  });
});

for(const side of ['player','opponent'])test(`${side}のCPUも手札を消費せず別IDのコピーを出席させる`,async({page})=>{
  const result=await page.evaluate(async(side)=>{
    isCpuControlledBattleSide=()=>true;state.currentSide=side;
    const original=createCardFromBase('umaibo',side);state.players[side].hand=[original];
    resolveHorseAttendance(side,createCardFromBase('remote_participant_student',side));
    await fusionEffectTail;
    const copy=state.players[side].board.seats.find(Boolean);
    return {hand:state.players[side].hand[0].instanceId===original.instanceId,will:state.players[side].will,
      copied:copy.baseId==='umaibo'&&copy.instanceId!==original.instanceId,source:copy.lastAttendanceSource};
  },side);
  expect(result).toEqual({hand:true,will:0,copied:true,source:'copy'});
});

test('コピーの手札限定効果は発動せず、戦意5超の完成品は選べない',async({page})=>{
  await page.evaluate(()=>{
    const ultimate=createCardFromBase('ultimate_yuta','player');ultimate.utaFusionMaterials=UTA_FUSION_MATERIAL_IDS.map(baseId=>({baseId}));
    state.players.player.hand=[ultimate,createCardFromBase('where_uma_bone_maibo','player')];
    resolveHorseAttendance('player',createCardFromBase('remote_participant_student','player'));
  });
  await expect.poll(()=>page.evaluate(()=>state.pendingCardChoice?.cards.map(card=>card.baseId))).toEqual(['ultimate_yuta']);
  await page.evaluate(()=>{state.pendingCardChoice.selectedIds=[state.pendingCardChoice.cards[0].instanceId];confirmCardChoiceSelection();});
  await expect.poll(()=>page.evaluate(()=>Boolean(state.pendingCopiedCard))).toBe(true);
  expect(await page.evaluate(()=>placePendingCopiedCardForSide('player','seat','player',3))).toBe(true);
  expect(await page.evaluate(()=>({gameOver:state.gameOver,hand:state.players.player.hand.length,source:state.players.player.board.seats[3].lastAttendanceSource})))
    .toEqual({gameOver:false,hand:2,source:'copy'});
});

test('オンラインのゲスト配置用コピーも別IDで同期し、元の手札は残る',async({page})=>{
  await page.evaluate(()=>{
    state.currentSide='opponent';state.online.role='host';state.online.started=true;state.online.connected=true;state.online.conn={};onlineSend=()=>true;
    state.players.opponent.hand=[createCardFromBase('umaibo','opponent')];
    resolveHorseAttendance('opponent',createCardFromBase('remote_participant_student','opponent'));
  });
  await expect.poll(()=>page.evaluate(()=>state.pendingRemoteHandTrim?.mode)).toBe('fusion_effect_choice');
  await page.evaluate(()=>resolveFusionEffectChoice(state.pendingRemoteHandTrim.requestId,[state.players.opponent.hand[0].instanceId]));
  await expect.poll(()=>page.evaluate(()=>state.pendingCopiedCard?.pendingOnlineGuestPlacement)).toBe(true);
  expect(await page.evaluate(()=>{
    const snapshot=onlineTransformSnapshotForGuest(onlineCreateSnapshot().state);
    return [snapshot.pendingCopiedCard.owner,snapshot.pendingCopiedCard.instanceId!==snapshot.players.player.hand[0].instanceId,snapshot.pendingCopiedCard.pendingAttendanceSource];
  })).toEqual(['player',true,'copy']);
  expect(await page.evaluate(()=>placePendingCopiedCardForSide('opponent','seat','opponent',2))).toBe(true);
  expect(await page.evaluate(()=>[state.players.opponent.hand.length,state.players.opponent.will])).toEqual([1,0]);
});

test('本文は合意したコピー出席の文面で表示する',async({page})=>{
  expect(await page.evaluate(()=>cardRulesText(createCardFromBase('remote_participant_student','player'))))
    .toBe('[注目]\nこのカードを手札から出席させたとき、自分の手札にある戦意5以下の融合で生成された出席者カード1枚を選び、そのコピーを出席させる。');
});
