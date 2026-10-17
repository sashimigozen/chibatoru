const {test,expect}=require('@playwright/test');
const {pathToFileURL}=require('node:url');
const path=require('node:path');
test.beforeEach(async({page})=>{
  await page.setViewportSize({width:1440,height:900});
  await page.goto(pathToFileURL(path.join(__dirname,'..','index.html')).href);
  await page.evaluate(()=>{
    startCardTest('tiny_rhythm_student');scheduleOpponentAI=()=>{};state.training.skipAnimations=true;state.environment=null;
    for(const side of ['player','opponent'])Object.assign(state.players[side],{board:{teacher:null,seats:Array(9).fill(null)},hand:[],trash:[],late:[],deck:[],will:8,maxWill:10,life:20});
  });
  await expect.poll(()=>page.evaluate(()=>battlePresentationBusy())).toBe(false);
});
test('本文・能力値・カテゴリーを更新し、同名2枚も選んで別コピー3人を順番に配置する',async({page})=>{
  await page.evaluate(()=>{
    state.players.player.hand=['tiny_rhythm_student','umaibo','umaibo','maibo_bone','where_uma_bone_maibo','general_student'].map(id=>createCardFromBase(id,'player'));
    window.originalIds=state.players.player.hand.slice(1).map(c=>c.instanceId);
    placeCardFromHand('player',state.players.player.hand[0].instanceId,'seat','player',0,true);
  });
  const choices=page.locator('#threeGesturesHand button.card');
  await expect(choices).toHaveCount(3);
  await expect.poll(()=>page.evaluate(()=>battlePresentationBusy({ignoreFusionTasks:true}))).toBe(false);
  for(let i=0;i<3;i++) await choices.nth(i).click();
  await page.screenshot({path:test.info().outputPath('rhythm-copy-choice.png')});
  await page.locator('#threeGesturesConfirmButton').click();
  for(const index of [1,2,3]) {
    await expect.poll(()=>page.evaluate(()=>Boolean(state.pendingCopiedCard))).toBe(true);
    await expect.poll(()=>page.evaluate(()=>battlePresentationBusy({ignoreFusionTasks:true}))).toBe(false);
    expect(await page.evaluate(()=>battleActionInputAllowed(elements.endTurnButton))).toBe(false);
    await page.locator(`.slot[data-owner="player"][data-zone="seat"][data-index="${index}"]`).click();
  }
  await expect.poll(()=>page.evaluate(()=>fusionTasksBusy())).toBe(false);
  expect(await page.evaluate(()=>{
    const p=state.players.player,copies=p.board.seats.slice(1,4),base=CARD_BASES.tiny_rhythm_student;
    return {stats:[base.cost,base.attack,base.hp,base.category],hand:p.hand.map(c=>c.instanceId),will:p.will,
      copies:copies.map(c=>c.baseId),fresh:copies.every(c=>!window.originalIds.includes(c.instanceId)),sources:copies.map(c=>c.lastAttendanceSource),
      text:cardRulesText(createCardFromBase('tiny_rhythm_student','player'))};
  })).toEqual({stats:[8,2,2,'gakuyukai_item'],hand:await page.evaluate(()=>window.originalIds),will:0,
    copies:['umaibo','umaibo','maibo_bone'],fresh:true,sources:['copy','copy','copy'],
    text:'このカードを手札から出席させたとき、自分の手札にある戦意5以下の融合で生成された出席者カードを3枚まで選び、それぞれのコピーを出席させる。'});
});
for(const side of ['player','opponent'])test(`${side}のCPUは空き席が不足しても置ける人数までコピーし手札を消費しない`,async({page})=>{
  expect(await page.evaluate(async side=>{
    isCpuControlledBattleSide=()=>true;state.currentSide=side;
    const p=state.players[side];p.hand=['umaibo','umaibo','maibo_bone'].map(id=>createCardFromBase(id,side));
    for(let i=0;i<7;i++)p.board.seats[i]=makeBoardCard(createCardFromBase('general_student',side));
    resolveHorseAttendance(side,createCardFromBase('tiny_rhythm_student',side));await fusionEffectTail;
    return {hand:p.hand.length,will:p.will,copies:p.board.seats.filter(c=>c?.fusionResult).length,pending:state.pendingCopiedCard};
  },side)).toEqual({hand:3,will:8,copies:2,pending:null});
});
test('戦意7では出席できず8で出席できる',async({page})=>{
  expect(await page.evaluate(()=>{
    const p=state.players.player,c=createCardFromBase('tiny_rhythm_student','player');p.hand=[c];p.will=7;
    const seven=placeCardFromHand('player',c.instanceId,'seat','player',0,false);p.will=8;
    return {seven,eight:placeCardFromHand('player',c.instanceId,'seat','player',0,false)};
  })).toEqual({seven:false,eight:true});
});
test('任意で0枚を選べ、コピー出席では発動しない',async({page})=>{
  await page.evaluate(()=>{state.players.player.hand=[createCardFromBase('umaibo','player')];resolveHorseAttendance('player',createCardFromBase('tiny_rhythm_student','player'));});
  await expect(page.locator('#threeGesturesConfirmButton')).toBeEnabled();
  await page.locator('#threeGesturesConfirmButton').click();
  await expect.poll(()=>page.evaluate(()=>fusionTasksBusy())).toBe(false);
  expect(await page.evaluate(()=>{
    const copy=makeBoardCard(createCardFromBase('tiny_rhythm_student','player'));
    attendCard('player',copy,'seat',0,{attendanceSource:ATTENDANCE_SOURCE.COPY});
    return {pending:state.pendingCardChoice,hand:state.players.player.hand.length,oldAttack:aiAttackTriggerHasValue('player',copy)};
  })).toEqual({pending:null,hand:1,oldAttack:false});
});
test('空き席がなくても本体は出席できる',async({page})=>{
  expect(await page.evaluate(async()=>{
    isCpuControlledBattleSide=()=>true;
    const p=state.players.player;
    for(let i=0;i<8;i++)p.board.seats[i]=makeBoardCard(createCardFromBase('general_student','player'));
    p.hand=['tiny_rhythm_student','umaibo'].map(id=>createCardFromBase(id,'player'));
    const placed=placeCardFromHand('player',p.hand[0].instanceId,'seat','player',8,true);
    await waitForOrderedAttendance();await fusionEffectTail;
    return {placed,body:p.board.seats[8]?.baseId,hand:p.hand.map(c=>c.baseId),pending:state.pendingCardChoice};
  })).toEqual({placed:true,body:'tiny_rhythm_student',hand:['umaibo'],pending:null});
});
test('オンラインのゲスト選択と配置3回がホスト側で連続処理され元の手札も同期する',async({page})=>{
  await page.evaluate(()=>{
    state.currentSide='opponent';state.online.role='host';state.online.started=true;state.online.connected=true;state.online.conn={};onlineSend=()=>true;
    state.players.opponent.hand=['umaibo','umaibo','maibo_bone'].map(id=>createCardFromBase(id,'opponent'));
    resolveHorseAttendance('opponent',createCardFromBase('tiny_rhythm_student','opponent'));
  });
  await expect.poll(()=>page.evaluate(()=>state.pendingRemoteHandTrim?.mode)).toBe('fusion_effect_choice');
  await page.evaluate(()=>resolveFusionEffectChoice(state.pendingRemoteHandTrim.requestId,state.players.opponent.hand.map(c=>c.instanceId)));
  for(const index of [0,1,2]) {
    await expect.poll(()=>page.evaluate(()=>state.pendingCopiedCard?.pendingOnlineGuestPlacement)).toBe(true);
    expect(await page.evaluate(index=>placePendingCopiedCardForSide('opponent','seat','opponent',index),index)).toBe(true);
  }
  await expect.poll(()=>page.evaluate(()=>fusionTasksBusy())).toBe(false);
  expect(await page.evaluate(()=>{
    const s=onlineTransformSnapshotForGuest(onlineCreateSnapshot().state);
    return [s.players.player.hand.length,s.players.player.board.seats.filter(Boolean).length,s.pendingCopiedCard];
  })).toEqual([3,3,null]);
});
