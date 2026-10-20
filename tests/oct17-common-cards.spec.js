const { test, expect } = require('@playwright/test');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
test.beforeEach(async ({page}) => {
  await page.goto(pathToFileURL(path.join(__dirname, '..', 'index.html')).href);
  await page.evaluate(() => {
    startCardTest('general_student'); scheduleOpponentAI = () => {};
    state.training.skipAnimations = true; state.environment = null;
    state.phase = 'battle'; state.actionTurn = 8; state.currentSide = 'player';
    state.pendingAttendTarget = null;
    for (const side of ['player','opponent']) Object.assign(state.players[side], {
      board: {seats:Array(9).fill(null),teacher:null}, hand:[],deck:[],trash:[],late:[],
      life:10,maxWill:20,will:20,attendancesThisTurn:0
    });
  });
  await page.waitForFunction(() => !battleNewActionBlocked());
});
test('新カード3枚の能力値・本文・共通カード登録', async ({page}) => {
  const rows = await page.evaluate(() => ['ittan','kashikashi','window_snipe_student'].map(id => {
    const c=createCardFromBase(id,'player');
    return {stats:[c.cost,c.attack||0,c.hp||0],text:cardRulesText(c),registered:ALL_DECK_IDS.includes(id)&&SPECIALTY_CARD_IDS.common.includes(id)};
  }));
  expect(rows.map(r=>r.stats)).toEqual([[7,0,0],[2,0,0],[3,2,1]]);
  expect(rows.map(r=>r.text)).toEqual(['自分本体に2ダメージを与える。その後、お互いの講義室にいる出席者すべてを破壊する。','自分のターン終了まで、お互いの継続効果をすべて無効にする。','このカードを手札から3行3列に出席させたとき、相手の講義室にいる出席者1人を指名し、3ダメージを与える。']);
  expect(rows.every(r=>r.registered)).toBe(true);
});
test('一旦は両陣営の席・教卓を破壊し、環境は残す',async({page})=>{
  const r=await page.evaluate(()=>{
    for(const side of ['player','opponent']) {
      state.players[side].board.seats[0]=makeBoardCard(createCardFromBase('general_student',side));
      state.players[side].board.teacher=makeBoardCard(createCardFromBase('general_teacher',side));
    }
    state.environment=createCardFromBase('classroom','player');
    const item=createCardFromBase('ittan','player'); state.players.player.hand=[item];
    const used=castImmediateItem('player',item,false);
    return {used,counts:['player','opponent'].map(s=>listBoardRefs(s).length),env:state.environment.baseId,will:state.players.player.will,life:state.players.player.life};
  });
  expect(r).toEqual({used:true,counts:[0,0],env:'classroom',will:13,life:8});
});
for (const side of ['player','opponent']) {
  for (const life of [2,3]) test('一旦は自傷で敗北したら破壊せず、耐えれば破壊する ' + side + ' ' + life, async ({page})=>{
    const result=await page.evaluate(({side,life})=>{
      state.currentSide=side;
      const p=state.players[side];p.life=life;
      for(const owner of ['player','opponent']) state.players[owner].board.seats[0]=makeBoardCard(createCardFromBase('general_student',owner));
      const item=createCardFromBase('ittan',side);p.hand=[item];
      const order=[];
      const originalDamage=damagePlayer, originalDestroy=destroyBoardRefsToTrash;
      damagePlayer=(...args)=>{order.push('damage');return originalDamage(...args);};
      destroyBoardRefsToTrash=(...args)=>{order.push('destroy');return originalDestroy(...args);};
      try {
        const used=castImmediateItem(side,item,false);
        return {used,life:p.life,gameOver:state.gameOver,counts:['player','opponent'].map(s=>listBoardRefs(s).length),
          spent:20-p.will,trashed:p.trash.some(c=>c.instanceId===item.instanceId),order};
      } finally {damagePlayer=originalDamage;destroyBoardRefsToTrash=originalDestroy;}
    },{side,life});
    expect(result).toMatchObject({used:true,life:life-2,counts:life===2?[1,1]:[0,0],spent:7,trashed:true,
      order:life===2?['damage']:['damage','destroy']});
    expect(Boolean(result.gameOver)).toBe(life===2);
  });
}
test('一旦は自傷を防いだ場合も破壊し、AIは致死自傷を避ける',async({page})=>{
  const result=await page.evaluate(()=>{
    state.currentSide='opponent';const p=state.players.opponent;p.life=2;
    state.players.player.board.seats[0]=makeBoardCard(createCardFromBase('vampire','player'));
    const item=createCardFromBase('ittan','opponent');p.hand=[item];
    const dangerous=scoreAiItem(item);
    p.lifeShieldUntilTurn=state.actionTurn;p.lifeShieldUntilSide='opponent';
    const protectedScore=scoreAiItem(item);
    const used=castImmediateItem('opponent',item,false);
    return {dangerous,protectedScore,used,life:p.life,enemy:listBoardRefs('player').length};
  });
  expect(result).toMatchObject({dangerous:0,used:true,life:2,enemy:0});
  expect(result.protectedScore).toBeGreaterThan(0);
});
test('スナイプは盤面を直接指名して3ダメージ、選択を解放する',async({page})=>{
  const r=await page.evaluate(()=>{
    const c=makeBoardCard(createCardFromBase('window_snipe_student','player'));
    const target=makeBoardCard(createCardFromBase('general_teacher','opponent'));
    target.baseMaxHp=target.maxHp=target.currentHp=8;
    state.players.player.board.seats[0]=c;state.players.opponent.board.teacher=target;
    const started=beginWindowSnipeTargetChoice('player',c);
    const resolved=resolveAttendTargetChoice('player',{owner:'opponent',zone:'teacher',index:null},false);
    return {started,resolved,hp:target.currentHp,pending:state.pendingAttendTarget};
  });
  expect(r).toEqual({started:true,resolved:true,hp:5,pending:null});
});
test('新カード3枚とスナイプの指名画面を実表示する',async({page})=>{
  await page.setViewportSize({width:1280,height:800});
  await page.evaluate(()=>waitForBattlePresentation());
  await page.evaluate(()=>{
    state.players.player.hand=['ittan','kashikashi','window_snipe_student'].map(id=>createCardFromBase(id,'player'));
    const c=makeBoardCard(createCardFromBase('window_snipe_student','player'));
    state.players.player.board.seats[0]=c;
    state.players.opponent.board.teacher=makeBoardCard(createCardFromBase('general_teacher','opponent'));
    beginWindowSnipeTargetChoice('player',c);render();
  });
  await expect(page.locator('#playerHand')).toContainText('カシカシ');
  await page.screenshot({path:'/tmp/chibatoru-new-common-cards.png'});
});
test('一旦は複数マスを重複破壊せず、南京錠の耐性を尊重する',async({page})=>{
  const r=await page.evaluate(()=>{
    const big=makeBoardCard(createCardFromBase('loud_members','opponent'));
    placeMultiSeatCard('opponent',0,big);
    const locked=makeBoardCard(createCardFromBase('general_student','player'));
    locked.padlockEquipment={baseId:'padlock'};state.players.player.board.seats[0]=locked;
    const item=createCardFromBase('ittan','player');state.players.player.hand=[item];
    castImmediateItem('player',item,false);
    return {left:listBoardRefs('player').length,enemy:listBoardRefs('opponent').length,
      trashed:state.players.opponent.trash.filter(c=>c.instanceId===big.instanceId).length};
  });
  expect(r).toEqual({left:1,enemy:0,trashed:1});
});
test('スナイプは対象なしでも選択待ちを作らない',async({page})=>{
  expect(await page.evaluate(()=>beginWindowSnipeTargetChoice('player',createCardFromBase('window_snipe_student','player')))).toBe(false);
  expect(await page.evaluate(()=>state.pendingAttendTarget)).toBeNull();
});
for(const side of ['player','opponent'])test(`スナイプは他の席にも出席できるが手札から3行3列だけ発動する ${side}`,async({page})=>{
  const rows=await page.evaluate(side=>{
    state.currentSide=side;
    state.online.isHandlingRemoteCommand=true;
    state.players[oppositeSide(side)].board.teacher=makeBoardCard(createCardFromBase('general_teacher',oppositeSide(side)));
    return Array.from({length:9},(_,index)=>{
      const sniper=makeBoardCard(createCardFromBase('window_snipe_student',side));
      const allowed=canPlaceCard(side,sniper,'seat',side,index);
      state.players[side].board.seats[index]=sniper;
      resolveAttendEffects(side,sniper,'seat',index,{attendanceSource:ATTENDANCE_SOURCE.HAND});
      const triggered=state.pendingAttendTarget?.effect==='window_snipe_student';
      state.pendingAttendTarget=null;
      resolveAttendEffects(side,sniper,'seat',index,{attendanceSource:ATTENDANCE_SOURCE.GENERATED});
      const generatedTriggered=!!state.pendingAttendTarget;
      state.pendingAttendTarget=null;state.players[side].board.seats[index]=null;
      return {allowed,triggered,generatedTriggered};
    });
  },side);
  rows.forEach((row,index)=>expect(row).toEqual({allowed:true,triggered:index===8,generatedTriggered:false}));
});
test('AIはスナイプのダメージを3行3列だけで評価する',async({page})=>{
  const result=await page.evaluate(()=>{
    state.currentSide='opponent';
    state.players.player.board.teacher=makeBoardCard(createCardFromBase('general_teacher','player'));
    const sniper=createCardFromBase('window_snipe_student','opponent');
    state.players.opponent.hand=[sniper];
    const move=findAiPlayMove();
    return {zone:move.zone,index:move.index,hp:sniper.hp};
  });
  expect(result).toEqual({zone:'seat',index:8,hp:1});
});
test('カシカシは環境・本体・全体付与を一時停止し、保存値を維持',async({page})=>{
  const r=await page.evaluate(()=>{
    const p=state.players.player;
    p.board.seats[0]=makeBoardCard(createCardFromBase('acting_out_man_2','player'));
    const woman=makeBoardCard(createCardFromBase('acting_out_woman','player'));p.board.seats[1]=woman;
    state.environment=createCardFromBase('meguro_library','player');
    p.lifeShieldUntilTurn=8;p.lifeShieldUntilSide='player';
    const before=hasKeyword(woman,'陽気');
    const item=createCardFromBase('kashikashi','player');p.hand=[item];
    castImmediateItem('player',item,false);
    const during={keyword:hasKeyword(woman,'陽気'),env:ongoingEnvironmentBaseId(),lines:playerActiveEffectLines('player').length};
    applyPlayerDamage('player',2);
    const life=p.life;
    state.kashikashiActionTurn=null;applyBoardAuras();
    return {before,during,life,restored:hasKeyword(woman,'陽気'),physical:state.environment.baseId,shield:p.lifeShieldUntilTurn};
  });
  expect(r).toEqual({before:true,during:{keyword:false,env:null,lines:0},life:8,restored:true,physical:'meguro_library',shield:8});
});
test('カシカシ中の終了時回復は発動せず、復帰後は発動する',async({page})=>{
  const r=await page.evaluate(async()=>{
    state.players.player.board.seats[0]=makeBoardCard(createCardFromBase('umaibo','player'));
    state.kashikashiActionTurn=8;
    resolveStudentEndTurnEffects('player');const suppressed=state.players.player.life;
    const forecast=aiEndTurnHealing('player');
    state.kashikashiActionTurn=null;resolveStudentEndTurnEffects('player');
    await waitForBattlePresentation();
    return {suppressed,forecast,restored:state.players.player.life};
  });
  expect(r).toEqual({suppressed:10,forecast:0,restored:13});
});
test('講義室チェック完了までは停止し、相手のターン開始前に復帰する',async({page})=>{
  await page.evaluate(async()=>{
    state.players.player.board.seats[0]=makeBoardCard(createCardFromBase('umaibo','player'));
    state.players.opponent.deck=Array.from({length:8},()=>createCardFromBase('general_student','opponent'));
    state.kashikashiActionTurn=8;
    await finishEndTurn('player');
  });
  expect(await page.evaluate(()=>({side:state.currentSide,turn:state.actionTurn,stopped:ongoingEffectsSuppressed(),life:state.players.player.life})) )
    .toEqual({side:'opponent',turn:9,stopped:false,life:10});
});
test('オンライン視点変換でも一時停止と指名対象の所有者を引き継ぐ',async({page})=>{
  const r=await page.evaluate(()=>{
    state.kashikashiActionTurn=8;
    state.players.player.board.seats[0]=makeBoardCard(createCardFromBase('window_snipe_student','player'));
    state.players.opponent.board.seats[0]=makeBoardCard(createCardFromBase('general_student','opponent'));
    beginWindowSnipeTargetChoice('player',state.players.player.board.seats[0]);
    const guest=onlineTransformSnapshotForGuest(onlineCreateSnapshot().state);
    return {turn:guest.kashikashiActionTurn,owner:guest.pendingAttendTarget.owner,target:guest.pendingAttendTarget.targetOwner};
  });
  expect(r).toEqual({turn:8,owner:'opponent',target:'player'});
});
test('停止中に置いた環境も停止し、出席時の単発効果は使える',async({page})=>{
  const r=await page.evaluate(()=>{
    state.kashikashiActionTurn=8;
    const c=makeBoardCard(createCardFromBase('general_student','player'));state.players.player.board.seats[4]=c;
    state.environment=createCardFromBase('student_council','player');applyBoardAuras();
    const hp=c.maxHp;
    state.players.opponent.board.seats[0]=makeBoardCard(createCardFromBase('general_student','opponent'));
    const sniper=makeBoardCard(createCardFromBase('window_snipe_student','player'));
    state.players.player.board.seats[8]=sniper;
    resolveAttendEffects('player',sniper,'seat',8,{attendanceSource:ATTENDANCE_SOURCE.HAND});
    const pending=state.pendingAttendTarget?.effect;
    state.pendingAttendTarget=null;
    resolveAttendEffects('player',sniper,'seat',8,{attendanceSource:ATTENDANCE_SOURCE.EFFECT});
    const effectPending=state.pendingAttendTarget;
    state.kashikashiActionTurn=null;applyBoardAuras();
    return {hp,pending,effectPending,restored:c.maxHp};
  });
  expect(r).toEqual({hp:2,pending:'window_snipe_student',effectPending:null,restored:4});
});
