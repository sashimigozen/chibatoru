const { test, expect } = require('@playwright/test');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const url = pathToFileURL(path.join(__dirname, '..', 'index.html')).href;

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(url);
  await page.evaluate(() => {
    startCardTest('general_student'); scheduleOpponentAI = () => {};
    state.training.skipAnimations = true;
    state.environment = null; state.currentSide = 'player'; state.gameOver = false;
    for (const side of ['player', 'opponent']) Object.assign(state.players[side], {
      board: { teacher: null, seats: Array(9).fill(null) }, hand: [], deck: [], trash: [], late: [],
      will: 20, maxWill: 20, life: 20
    });
  });
});

test('6通りの2枚融合と4枚融合、素材は校外に入らず戦意も消費しない', async ({ page }) => {
  const results = await page.evaluate(() => {
    const combinations = [[0,1],[0,2],[0,3],[1,2],[1,3],[2,3],[0,1,2,3]];
    return combinations.map(indices => {
      state.players.player.hand = indices.map(i => createCardFromBase(HORSE_MATERIAL_IDS[i], 'player'));
      const success = fuseHorseMaterials('player', state.players.player.hand.map(card => card.instanceId), false);
      const result = state.players.player.hand[0];
      return [success, result.baseId, result.fusionMaterials.length, state.players.player.trash.length, state.players.player.will];
    });
  });
  expect(results).toEqual(['umaibo','uma_bone','where_uma','maibo_bone','where_maibo','where_bone','where_uma_bone_maibo']
    .map((id,i) => [true,id,i===6?4:2,0,20]));
});

test('融合完成品7種の能力値と更新情報が一致し、生成したカードにも反映する', async ({ page }) => {
  const expected={umaibo:[5,1,5],uma_bone:[5,2,4],where_uma:[5,3,3],maibo_bone:[5,3,3],
    where_maibo:[5,4,2],where_bone:[5,2,2],where_uma_bone_maibo:[6,4,4]};
  const records=await page.evaluate(()=>{
    const combinations=[['fusion_uma','fusion_maibo'],['fusion_uma','fusion_bone'],['fusion_uma','fusion_where'],
      ['fusion_maibo','fusion_bone'],['fusion_maibo','fusion_where'],['fusion_bone','fusion_where'],[...HORSE_MATERIAL_IDS]];
    return combinations.map(ids=>{
      state.players.player.hand=ids.map(id=>createCardFromBase(id,'player'));
      if(!fuseHorseMaterials('player',state.players.player.hand.map(c=>c.instanceId),false)) throw Error('融合失敗');
      const c=state.players.player.hand[0], b=CARD_BASES[c.baseId];
      return {id:c.baseId,stats:[c.cost,c.attack,c.hp],boardHp:makeBoardCard(c).currentHp,
        flags:[c.generated,c.token,c.fusionResult],deckAllowed:DIRECT_DECK_CARD_IDS.has(c.baseId),
        update:UPDATE_HISTORY[0].changes.find(change=>change.title===c.name)?.after,text:cardRulesText(c),name:c.name,
        baseStats:[b.cost,b.attack,b.hp]};
    });
  });
  for(const record of records){
    expect(record.stats,record.name).toEqual(expected[record.id]);
    expect(record.baseStats,record.name).toEqual(expected[record.id]);
    expect(record.boardHp,record.name).toBe(expected[record.id][2]);
    expect(record.flags).toEqual([true,true,true]); expect(record.deckAllowed).toBe(false);
    const [cost,attack,hp]=expected[record.id];
    expect(record.update).toBe(`学生／学友会・持ち物／戦意${cost}／攻撃力${attack}／体力${hp}\n${record.text}`);
  }
});

test('最終形は戦意5では出席できず、戦意6を払って出席し、既存の出席効果を使う', async ({page})=>{
  await page.evaluate(()=>{
    const c=createCardFromBase('where_uma_bone_maibo','player'); state.players.player.hand=[c];
    state.players.player.will=5; state.players.player.life=10; render();
  });
  await expect.poll(()=>page.evaluate(()=>battlePresentationBusy())).toBe(false);
  await page.evaluate(()=>playCard(state.players.player.hand[0].instanceId,'seat','player',4));
  expect(await page.evaluate(()=>[state.players.player.board.seats[4],state.players.player.hand.length,state.players.player.will])).toEqual([null,1,5]);
  await page.evaluate(()=>{state.players.player.will=6;playCard(state.players.player.hand[0].instanceId,'seat','player',4);});
  await expect.poll(()=>page.evaluate(()=>state.players.player.board.seats[4]?.baseId)).toBe('where_uma_bone_maibo');
  expect(await page.evaluate(()=>[state.players.player.will,state.players.player.life,
    state.players.player.board.seats[4].attack,state.players.player.board.seats[4].currentHp,state.players.opponent.life]))
    .toEqual([0,13,5,5,17]);
});

test('同名・3枚・完成品への追加融合は不可、高負荷素材は融合可能', async ({ page }) => {
  const results = await page.evaluate(() => {
    return [['fusion_uma','fusion_uma'], ['fusion_uma','fusion_bone','fusion_where'], ['umaibo','fusion_where']]
      .map(ids => { state.players.player.hand = ids.map(id=>createCardFromBase(id,'player'));
        return fuseHorseMaterials('player',state.players.player.hand.map(card=>card.instanceId),false); })
      .concat((()=> { state.players.player.hand = ['fusion_uma','fusion_bone'].map(id=>createCardFromBase(id,'player'));
        state.players.player.hand[0].handLoadLevel=2;
        return fuseHorseMaterials('player',state.players.player.hand.map(card=>card.instanceId),false); })());
  });
  expect(results).toEqual([false,false,false,true]);
});

test('素材とサポートだけデッキ登録でき、完成品7種は生成専用', async ({ page }) => {
  expect(await page.evaluate(() => ({ cost:CARD_BASES.corridor_student.cost,
    materials:HORSE_MATERIAL_IDS.every(id=>ALL_DECK_IDS.includes(id)),
    results:[...Object.values(HORSE_PAIR_RESULTS),'where_uma_bone_maibo'].every(id=>!ALL_DECK_IDS.includes(id)),
    text: cardRulesText(createCardFromBase('fusion_uma','player')) }))).toMatchObject({cost:3,materials:true,results:true});
});

test('情報はデッキから素材を減らさずコピーする、対象なしなら何も生成しない', async ({ page }) => {
  expect(await page.evaluate(() => {
    const source=createCardFromBase('information_tired_student','player');
    state.players.player.deck=[createCardFromBase('fusion_uma','player')];
    resolveAttendEffects('player',source,'seat',0,{fromHand:true});
    const first=[state.players.player.deck.length,state.players.player.hand.map(card=>card.baseId)];
    state.players.player.deck=[]; state.players.player.hand=[]; resolveAttendEffects('player',source,'seat',0,{fromHand:true});
    return {first,count:state.players.player.hand.length};
  })).toEqual({first:[1,['fusion_uma']],count:0});
});

test('通路は異名2枚、残り1種類なら1枚をコピーする', async ({ page }) => {
  await page.evaluate(() => {
    state.players.player.deck=['fusion_uma','fusion_uma','fusion_bone'].map(id=>createCardFromBase(id,'player'));
    resolveHorseAttendance('player',createCardFromBase('corridor_student','player'));
  });
  await expect.poll(()=>page.evaluate(()=>fusionTasksBusy())).toBe(false);
  expect(await page.evaluate(()=>[state.players.player.deck.length,state.players.player.hand.map(card=>card.baseId).sort(),Boolean(state.pendingCardChoice)])).toEqual([3,['fusion_bone','fusion_uma'],false]);
  await page.evaluate(()=>{state.players.player.hand=[];state.players.player.deck=[createCardFromBase('fusion_where','player')];resolveHorseAttendance('player',createCardFromBase('corridor_student','player'));});
  await expect.poll(()=>page.evaluate(()=>state.players.player.hand.length)).toBe(1);
});

for (const id of ['uma_bone','where_uma']) test(`${id}は自身を強化しない`,async({page})=>{
  await page.evaluate(id=>{
    const source=makeBoardCard(createCardFromBase(id,'player'));
    state.players.player.board.seats[0]=source;
    state.players.player.board.seats[1]=makeBoardCard(createCardFromBase('strong_student','player'));
    window.beforeFusionStats=state.players.player.board.seats.slice(0,2).map(card=>[card.attack,card.currentHp]);
    resolveHorseEndTurn('player',source);
  },id);
  if(id==='uma_bone'){
    await expect.poll(()=>page.evaluate(()=>state.pendingCardChoice?.cards.length)).toBe(1);
    await page.evaluate(()=>{state.pendingCardChoice.selectedIds=[state.pendingCardChoice.cards[0].instanceId];confirmCardChoiceSelection();});
  }
  await expect.poll(()=>page.evaluate(()=>fusionTasksBusy())).toBe(false);
  expect(await page.evaluate(()=>state.players.player.board.seats.slice(0,2).map((card,i)=>[card.attack-beforeFusionStats[i][0],card.currentHp-beforeFusionStats[i][1]])))
    .toEqual([[0,0],id==='uma_bone'?[0,1]:[2,2]]);
});

test('マイボの骨は2人までに各2ダメージ、どこのマイボはランダム1人に7ダメージ',async({page})=>{
  await page.evaluate(()=>{
    state.players.opponent.board.seats=[0,1,2].map(()=>{const card=makeBoardCard(createCardFromBase('strong_student','opponent'));card.currentHp=10;card.maxHp=10;card.baseMaxHp=10;return card;}).concat(Array(6).fill(null));
    const source=makeBoardCard(createCardFromBase('maibo_bone','player'));state.players.player.board.seats[0]=source;resolveHorseEndTurn('player',source);
  });
  await expect.poll(()=>page.evaluate(()=>state.pendingCardChoice?.max)).toBe(2);
  await page.evaluate(()=>{state.pendingCardChoice.selectedIds=state.pendingCardChoice.cards.slice(0,2).map(card=>card.instanceId);confirmCardChoiceSelection();});
  await expect.poll(()=>page.evaluate(()=>fusionTasksBusy())).toBe(false);
  expect(await page.evaluate(()=>state.players.opponent.board.seats.filter(Boolean).map(card=>card.currentHp))).toEqual([8,8,10]);
  await page.evaluate(()=>{const source=makeBoardCard(createCardFromBase('where_maibo','player'));state.players.player.board.seats[0]=source;resolveHorseEndTurn('player',source);});
  await expect.poll(()=>page.evaluate(()=>fusionTasksBusy())).toBe(false);
  expect(await page.evaluate(()=>state.players.opponent.board.seats.filter(Boolean).reduce((n,card)=>n+card.currentHp,0))).toBe(19);
});

test('回復・本体ダメージ・最終形の出席効果と手札由来限定',async({page})=>{
  expect(await page.evaluate(async()=>{
    state.players.player.life=10;
    const healer=makeBoardCard(createCardFromBase('umaibo','player'));state.players.player.board.seats[0]=healer;
    await resolveHorseEndTurn('player',healer);
    const firstLife=state.players.player.life;
    const final=makeBoardCard(createCardFromBase('where_uma_bone_maibo','player'));state.players.player.board.seats[1]=final;
    const enemy=makeBoardCard(createCardFromBase('strong_student','opponent'));state.players.opponent.board.seats[0]=enemy;
    const beforeHp=enemy.currentHp;
    state.players.opponent.hand=[createCardFromBase('general_student','opponent')];
    resolveAttendEffects('player',final,'seat',1,{attendanceSource:ATTENDANCE_SOURCE.DECK});
    const noTrigger=state.players.player.life;
    resolveAttendEffects('player',final,'seat',1,{attendanceSource:ATTENDANCE_SOURCE.HAND});
    return {firstLife,noTrigger,life:state.players.player.life,final:[final.attack,final.currentHp],damage:beforeHp-enemy.currentHp,opponentLife:state.players.opponent.life,load:state.players.opponent.hand[0].handLoadLevel||0};
  })).toEqual({firstLife:13,noTrigger:13,life:16,final:[5,5],damage:2,opponentLife:17,load:0});
});

test('遠くからは元のカードを手札に残しコピーを指定マスへ、空きマスなしなら生成しない',async({page})=>{
  await page.evaluate(()=>{
    state.players.player.will=0;state.players.player.hand=[createCardFromBase('umaibo','player')];
    resolveHorseAttendance('player',createCardFromBase('remote_participant_student','player'));
  });
  await expect.poll(()=>page.evaluate(()=>state.pendingCardChoice?.cards.length)).toBe(1);
  await page.evaluate(()=>{state.pendingCardChoice.selectedIds=[state.pendingCardChoice.cards[0].instanceId];confirmCardChoiceSelection();});
  await expect.poll(()=>page.evaluate(()=>Boolean(state.pendingCopiedCard))).toBe(true);
  expect(await page.evaluate(()=>placePendingCopiedCardForSide('player','seat','player',4))).toBe(true);
  expect(await page.evaluate(()=>[state.players.player.hand.length,state.players.player.will,state.players.player.board.seats[4].lastAttendanceSource,
    state.players.player.board.seats[4].instanceId!==state.players.player.hand[0].instanceId])).toEqual([1,0,'copy',true]);
  await page.evaluate(async()=>{state.players.player.life=10;await resolveHorseEndTurn('player',state.players.player.board.seats[4]);});
  expect(await page.evaluate(()=>state.players.player.life)).toBe(13);
  await page.evaluate(()=>{
    state.players.player.board.seats=Array.from({length:9},()=>makeBoardCard(createCardFromBase('general_student','player')));
    state.players.player.hand=[createCardFromBase('umaibo','player')];resolveHorseAttendance('player',createCardFromBase('remote_participant_student','player'));
  });
  await expect.poll(()=>page.evaluate(()=>fusionTasksBusy())).toBe(false);
  expect(await page.evaluate(()=>[state.players.player.hand.length,Boolean(state.pendingCardChoice)])).toEqual([1,false]);
});

test('定規とU太も融合で校外へ送られず、既存の融合効果を保持',async({page})=>{
  expect(await page.evaluate(()=>{
    state.players.player.hand=[createCardFromBase('ruler','player'),createCardFromBase('ruler','player')];fuseRulersForSide('player',false);
    const rulerResult=state.players.player.hand[0].baseId;
    const uta=createCardFromBase('yuta','player');state.players.player.hand=[uta,...UTA_FUSION_MATERIAL_IDS.map(id=>createCardFromBase(id,'player'))];
    for(const id of UTA_FUSION_MATERIAL_IDS)castUtaFusion('player',state.players.player.hand.find(card=>card.baseId===id),getHandCard('player',uta.instanceId),false);
    return {rulerResult,utaResult:state.players.player.hand[0].baseId,materials:state.players.player.hand[0].utaFusionMaterials.length,trash:state.players.player.trash.length,will:state.players.player.will};
  })).toEqual({rulerResult:'double_diamond',utaResult:'ultimate_yuta',materials:4,trash:0,will:20});
});

test('融合は素材が集まる演出、完了後消え、操作ロックも解除される',async({page})=>{
  await expect.poll(()=>page.evaluate(()=>battlePresentationBusy())).toBe(false);
  await page.evaluate(()=>{
    state.training.skipAnimations=false;state.players.player.hand=['fusion_uma','fusion_bone'].map(id=>createCardFromBase(id,'player'));render();
    fuseHorseMaterials('player',state.players.player.hand.map(card=>card.instanceId));
  });
  await expect(page.locator('.fusion-visual-card')).toHaveCount(3);
  await page.screenshot({path:test.info().outputPath('fusion-materials.png')});
  await expect(page.locator('.fusion-visual')).toHaveCount(0);
  await expect.poll(()=>page.evaluate(()=>battlePresentationBusy())).toBe(false);
});

test('ターン終了の指名中は自分のターンのまま、確定後に交代する',async({page})=>{
  await expect.poll(()=>page.evaluate(()=>battlePresentationBusy())).toBe(false);
  await page.evaluate(()=>{
    state.players.player.board.seats[0]=makeBoardCard(createCardFromBase('uma_bone','player'));
    state.players.player.board.seats[1]=makeBoardCard(createCardFromBase('general_student','player'));
    state.players.opponent.deck=[createCardFromBase('general_student','opponent')];
    void finishEndTurn('player');
  });
  await expect.poll(()=>page.evaluate(()=>Boolean(state.pendingCardChoice))).toBe(true);
  expect(await page.evaluate(()=>[state.currentSide,state.lectureRoomCheck,battleNewActionBlocked()])).toEqual(['player',true,true]);
  await page.evaluate(()=>{state.pendingCardChoice.selectedIds=[state.pendingCardChoice.cards[0].instanceId];confirmCardChoiceSelection();});
  await expect.poll(()=>page.evaluate(()=>state.currentSide)).toBe('opponent');
});

test('CPUの融合・指名は両サイドで完了し、選択画面を残さない',async({page})=>{
  const results=await page.evaluate(async()=>{
    isCpuControlledBattleSide=()=>true;
    const results=[];
    for(const side of ['player','opponent']){
      state.currentSide=side;state.players[side].hand=HORSE_MATERIAL_IDS.map(id=>createCardFromBase(id,side));
      tryFuseHorseForAi(side);
      const result=state.players[side].hand[0];
      const source=makeBoardCard(createCardFromBase('uma_bone',side));
      state.players[side].board.seats[0]=source;state.players[side].board.seats[1]=makeBoardCard(createCardFromBase('general_student',side));
      await resolveHorseEndTurn(side,source);
      results.push([result.baseId,Boolean(state.pendingCardChoice),fusionTasksBusy()]);
    }
    return results;
  });
  expect(results).toEqual([['where_uma_bone_maibo',false,false],['where_uma_bone_maibo',false,false]]);
});

test('オンラインの選択要求・応答と融合演出は同期し、無関係な手札は非公開',async({page,browser})=>{
  const guest=await browser.newPage(); await guest.goto(url);
  await page.evaluate(()=>{
    state.online.role='host';state.online.started=true;state.online.connected=true;state.online.conn={};
    onlineSend=message=>{window.fusionRequest=message;return true;};
    state.players.opponent.deck=['fusion_uma','fusion_bone','general_student'].map(id=>createCardFromBase(id,'opponent'));
    resolveHorseAttendance('opponent',createCardFromBase('remote_participant_student','opponent'));
  });
  await expect.poll(()=>page.evaluate(()=>window.fusionRequest?.privateChoiceKind)).toBe('fusion_effect_choice');
  const request=await page.evaluate(()=>window.fusionRequest);
  expect(request.cards.map(card=>card.baseId)).toEqual(['fusion_uma','fusion_bone']);
  const response=await guest.evaluate(request=>{
    state.online.role='guest';state.online.started=true;onlineSend=message=>{window.fusionResponse=message;return true;};
    onlineHandleMessage({...request,protocol:ONLINE_PROTOCOL_VERSION});
    const preserved=preserveOnlineCourseRegistrationChoice();
    state.phase='battle';state.gameOver=false;state.pendingCardChoice=null;
    restoreOnlineCourseRegistrationChoice(preserved);
    state.pendingCardChoice.selectedIds=state.pendingCardChoice.cards.map(card=>card.instanceId);confirmCardChoiceSelection();
    return window.fusionResponse;
  },request);
  await page.evaluate(response=>onlineHandleMessage({...response,protocol:ONLINE_PROTOCOL_VERSION}),response);
  await expect.poll(()=>page.evaluate(()=>fusionTasksBusy())).toBe(false);
  expect(await page.evaluate(()=>state.players.opponent.hand.map(card=>card.baseId))).toEqual(['fusion_uma','fusion_bone']);
  const snapshot=await page.evaluate(()=>{
    state.currentSide='player';state.players.player.hand=['fusion_uma','fusion_where','general_teacher'].map(id=>createCardFromBase(id,'player'));
    fuseHorseMaterials('player',state.players.player.hand.slice(0,2).map(card=>card.instanceId));
    return onlineTransformSnapshotForGuest(onlineCreateSnapshot().state);
  });
  expect(snapshot.players.opponent.hand.every(card=>card.hidden)).toBe(true);
  expect(snapshot.fusionVisualEvents.at(-1).result.baseId).toBe('where_uma');
  expect(snapshot.fusionVisualEvents.at(-1).result.owner).toBe('opponent');
  await guest.close();
});

test('全14枚の本文が台帳と一致し、融合見出しは素材だけに表示する',async({page})=>{
  const fs=require('node:fs');
  const text=fs.readFileSync(path.join(__dirname,'..','card_rules.txt'),'utf8');
  const ids=['fusion_uma','fusion_maibo','fusion_bone','fusion_where','umaibo','uma_bone','where_uma','maibo_bone','where_maibo','where_bone','where_uma_bone_maibo','remote_participant_student','information_tired_student','corridor_student'];
  const rules=ids.map(id=>({id,raw:JSON.parse(text.match(new RegExp(`${id}: ("(?:[^"\\\\]|\\\\.)*")`))[1])}));
  const results=await page.evaluate(rules=>rules.map(({id,raw})=>{
    const card=createCardFromBase(id,'player');return {id,same:cardRulesText(card)===formatCardRulesDisplayText(card,raw),fusion:cardRulesText(card).includes('[融合]')};
  }),rules);
  results.forEach(({id,same,fusion})=>{expect(same,id).toBe(true);expect(fusion,id).toBe(ids.slice(0,4).includes(id));});
});
