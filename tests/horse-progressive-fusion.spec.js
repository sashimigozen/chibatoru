const {test,expect}=require('@playwright/test');
const {pathToFileURL}=require('node:url');
const path=require('node:path');
test.beforeEach(async({page})=>{
  await page.setViewportSize({width:1440,height:1000});
  await page.goto(pathToFileURL(path.join(__dirname,'..','index.html')).href);
  await page.evaluate(()=>{
    startCardTest('fusion_uma');scheduleOpponentAI=()=>{};state.training.skipAnimations=true;
    state.phase='battle';state.actionTurn=8;state.currentSide='player';state.environment=null;
    for(const side of ['player','opponent'])Object.assign(state.players[side],{
      board:{teacher:null,seats:Array(9).fill(null)},hand:[],deck:[],trash:[],late:[],will:0,maxWill:10,life:20});
  });
  await expect.poll(()=>page.evaluate(()=>battlePresentationBusy())).toBe(false);
});
for(const side of ['player','opponent'])test(`${side}の全6種が1枚ずつ追加融合し4種類で最終形になる`,async({page})=>{
  const results=await page.evaluate(side=>{
    state.currentSide=side;const p=state.players[side];
    return Object.entries(HORSE_PAIR_RESULTS).map(([recipe,id])=>{
      const target=createCardFromBase(id,side);target.attack+=1;
      const missing=HORSE_MATERIAL_IDS.filter(base=>!recipe.split(',').includes(base));
      const a=createCardFromBase(missing[0],side),b=createCardFromBase(missing[1],side);
      p.hand=[target,a,b];const initial=[target.cost,target.attack,target.hp];
      const first=fuseHorseMaterials(side,[a.instanceId,target.instanceId],false);
      const partial=p.hand.find(c=>c.baseId===id);
      const kept={id:partial.instanceId===target.instanceId,stats:[partial.cost,partial.attack,partial.hp],count:horseFusionMaterialEntries(partial).length};
      const duplicate=createCardFromBase(missing[0],side);p.hand.push(duplicate);
      const rejected=fuseHorseMaterials(side,[partial.instanceId,duplicate.instanceId],false);
      const last=fuseHorseMaterials(side,[partial.instanceId,b.instanceId],false);
      const final=p.hand.find(c=>c.baseId==='where_uma_bone_maibo');
      return {first,initial,kept,rejected,last,result:final.baseId,count:horseFusionMaterialEntries(final).length,will:p.will,trash:p.trash.length};
    });
  },side);
  for(const r of results){
    expect(r.first&&r.last).toBe(true);expect(r.rejected).toBe(false);
    expect(r.kept).toEqual({id:true,stats:r.initial,count:3});
    expect([r.result,r.count,r.will,r.trash]).toEqual(['where_uma_bone_maibo',4,0,0]);
  }
});
test('不足素材2枚を一括追加でき、完成品同士・重複ID・使用済み素材は拒否',async({page})=>{
  const r=await page.evaluate(()=>{
    const p=state.players.player;
    p.hand=['uma_bone','fusion_maibo','fusion_where','where_uma','fusion_bone'].map(id=>createCardFromBase(id,'player'));
    const [target,a,b,pair,overlap]=p.hand;
    const denied=[fuseHorseMaterials('player',[target.instanceId,pair.instanceId],false),
      fuseHorseMaterials('player',[target.instanceId,a.instanceId,a.instanceId],false),
      fuseHorseMaterials('player',[target.instanceId,overlap.instanceId],false)];
    const done=fuseHorseMaterials('player',[target.instanceId,a.instanceId,b.instanceId],false);
    return {denied,done,hand:p.hand.map(c=>c.baseId)};
  });
  expect(r).toEqual({denied:[false,false,false],done:true,hand:['where_uma','fusion_bone','where_uma_bone_maibo']});
});
test('途中段階で出席でき、破壊時は追加した素材を含む3種類を校外へ送る',async({page})=>{
  const r=await page.evaluate(()=>{
    const p=state.players.player;p.will=5;
    p.hand=['uma_bone','fusion_maibo'].map(id=>createCardFromBase(id,'player'));
    fuseHorseMaterials('player',p.hand.map(c=>c.instanceId),false);
    const c=p.hand[0];const placed=placeCardFromHand('player',c.instanceId,'seat','player',0,false);
    const count=horseFusionMaterialEntries(p.board.seats[0]).length;
    destroyBoardCard({owner:'player',zone:'seat',index:0});
    return {placed,count,trash:p.trash.map(c=>c.baseId).sort(),will:p.will};
  });
  expect(r).toEqual({placed:true,count:3,trash:['fusion_bone','fusion_maibo','fusion_uma'],will:0});
});
test('途中段階のコピーも追加素材を持ち、破壊時にその素材を校外へ送る',async({page})=>{
  const r=await page.evaluate(async()=>{
    const p=state.players.player;p.hand=['uma_bone','fusion_maibo'].map(id=>createCardFromBase(id,'player'));
    fuseHorseMaterials('player',p.hand.map(c=>c.instanceId),false);
    isCpuControlledBattleSide=()=>true;
    resolveHorseAttendance('player',createCardFromBase('remote_participant_student','player'));await fusionEffectTail;
    const copy=p.board.seats.find(Boolean);const copied=horseFusionMaterialEntries(copy).length;
    destroyBoardCard({owner:'player',zone:'seat',index:p.board.seats.indexOf(copy)});
    return {copied,original:p.hand[0].baseId,trash:p.trash.map(c=>c.baseId).sort()};
  });
  expect(r).toEqual({copied:3,original:'uma_bone',trash:['fusion_bone','fusion_maibo','fusion_uma']});
});
test('カード確認の融合素材一覧と融合ボタン・手札の印が途中段階に対応する',async({page})=>{
  await page.evaluate(()=>{
    const p=state.players.player;p.hand=['uma_bone','fusion_maibo','fusion_where'].map(id=>createCardFromBase(id,'player'));
    fuseHorseMaterials('player',p.hand.slice(0,2).map(c=>c.instanceId),false);
    render();showBattleCardPreview(p.hand.find(c=>c.baseId==='uma_bone'));
  });
  await expect(page.locator('#battleCardPreview [data-preview-effect-detail]').filter({hasText:'融合済み：'})).toHaveCount(3);
  await expect(page.locator('[data-preview-horse-fusion]')).toBeEnabled();
  await expect(page.locator('#playerHand .hand-effect-indicator')).toHaveCount(1);
  await page.locator('[data-preview-horse-fusion]').click();
  expect(await page.evaluate(()=>state.pendingCardChoice.cards.map(c=>c.baseId))).toEqual(['fusion_where']);
  await page.evaluate(()=>{state.pendingCardChoice.selectedIds=[state.pendingCardChoice.cards[0].instanceId];confirmCardChoiceSelection();});
  expect(await page.evaluate(()=>state.players.player.hand[0].baseId)).toBe('where_uma_bone_maibo');
});
test('戦意不足の融合出席者も実際にドラッグして追加融合できる',async({page})=>{
  await page.evaluate(()=>{
    state.players.player.hand=['uma_bone','fusion_maibo'].map(id=>createCardFromBase(id,'player'));render();
  });
  const source=page.locator('#playerHand .hand-card').first(),target=page.locator('#playerHand .hand-card').nth(1);
  const a=await source.boundingBox(),b=await target.boundingBox();
  await page.mouse.move(a.x+8,a.y+28);await page.mouse.down();
  await page.mouse.move(b.x+b.width*.75,b.y+32,{steps:15});await page.mouse.up();
  await expect.poll(()=>page.evaluate(()=>state.players.player.hand.map(c=>[c.baseId,horseFusionMaterialEntries(c).length])))
    .toEqual([['uma_bone',3]]);
});
test('複製素材といけますの陽気付与に印と詳細を表示し、通常・非公開手札には付けない',async({page})=>{
  await page.evaluate(()=>{
    const p=state.players.player;p.will=10;
    p.deck=[createCardFromBase('fusion_bone','player')];
    resolveHorseAttendance('player',createCardFromBase('information_tired_student','player'));
    const item=createCardFromBase('ikemasu','player');p.hand.push(item);castImmediateItem('player',item,false);
    p.hand.push(createCardFromBase('general_student','player'));
    state.players.opponent.hand=[copiedHorseMaterialCard(createCardFromBase('fusion_uma','opponent'),'opponent',CARD_BASES.corridor_student)];
    render();
  });
  await expect(page.locator('#playerHand .hand-effect-indicator')).toHaveCount(2);
  await expect(page.locator('#opponentHand .hand-effect-indicator')).toHaveCount(0);
  await expect(page.locator('#playerHand .hand-effect-indicator').first()).toHaveAttribute('aria-label',/複製/);
  await expect(page.locator('#playerHand .hand-effect-indicator').nth(1)).toHaveAttribute('aria-label',/陽気.*いけます/);
  await page.evaluate(()=>showBattleCardPreview(state.players.player.hand[0]));
  await expect(page.locator('#battleCardPreview')).toContainText('複製された融合素材');
  await page.screenshot({path:test.info().outputPath('hand-effect-markers.png')});
});
test('オンラインの追加融合コマンド・視点反転・公開イベントに素材を保持',async({page})=>{
  const r=await page.evaluate(()=>{
    const side='opponent',p=state.players[side];state.currentSide=side;
    p.hand=['uma_bone','fusion_maibo','fusion_where'].map(id=>createCardFromBase(id,side));
    const [target,a,b]=p.hand;
    const first=fuseHorseMaterials(side,[target.instanceId,a.instanceId],false);
    const snap=onlineTransformSnapshotForGuest(onlineCreateSnapshot().state);
    const c=snap.players.player.hand.find(c=>c.baseId==='uma_bone');
    const fields={owner:c.owner,extras:c.horseFusionExtraMaterials.map(e=>e.baseId),count:horseFusionMaterialEntries(c).length};
    const last=fuseHorseMaterials(side,[target.instanceId,b.instanceId],false);
    return {first,last,fields,visual:state.fusionVisualEvents.at(-1).result.baseId};
  });
  expect(r).toEqual({first:true,last:true,fields:{owner:'player',extras:['fusion_maibo'],count:3},visual:'where_uma_bone_maibo'});
});

test('ゲストのドラッグ融合をホストで処理し途中段階と最終形を双方に同期',async({page:host,browser})=>{
  const guest=await browser.newPage();
  try{
    await guest.goto(pathToFileURL(path.join(__dirname,'..','index.html')).href);
    for(const [page,role] of [[host,'host'],[guest,'guest']])await page.evaluate(role=>{
      if(role==='guest')startCardTest('fusion_uma');
      scheduleOpponentAI=()=>{};state.training.skipAnimations=true;state.environment=null;
      Object.assign(state.online,{role,started:true,connected:true,conn:{}});
      window.outbox=[];onlineSend=message=>{outbox.push(JSON.parse(JSON.stringify(message)));return true;};
    },role);
    const initial=await host.evaluate(()=>{
      state.currentSide='opponent';
      state.players.opponent.hand=['uma_bone','fusion_maibo','fusion_where'].map(id=>createCardFromBase(id,'opponent'));
      return onlineCreateSnapshot();
    });
    await guest.evaluate(snapshot=>onlineHandleMessage({type:'gameState',protocol:ONLINE_PROTOCOL_VERSION,snapshot}),initial);
    async function relay(from,to){
      const messages=await from.evaluate(()=>outbox.splice(0));
      for(const message of messages)await to.evaluate(message=>onlineHandleMessage({...message,
        type:message.command?'command':message.type,protocol:ONLINE_PROTOCOL_VERSION}),message);
    }
    for(const base of ['fusion_maibo','fusion_where']){
      expect(await guest.evaluate(base=>{
        const p=state.players.player;
        return performHandFusionDrop(p.hand.find(c=>c.baseId===base).instanceId,p.hand.find(c=>c.baseId==='uma_bone').instanceId);
      },base)).toBe(true);
      await relay(guest,host);await relay(host,guest);
      for(const [page,side] of [[host,'opponent'],[guest,'player']]){
        await expect.poll(()=>page.evaluate(({side,base})=>{
          const c=state.players[side].hand.find(c=>c.baseId===(base==='fusion_maibo'?'uma_bone':'where_uma_bone_maibo'));
          return c?horseFusionMaterialEntries(c).length:0;
        },{side,base})).toBe(base==='fusion_maibo'?3:4);
      }
    }
  }finally{await guest.close();}
});
