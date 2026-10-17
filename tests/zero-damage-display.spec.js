const {test,expect}=require('@playwright/test');
const {pathToFileURL}=require('node:url');
const path=require('node:path');
for(const side of ['player','opponent']) test(`0ダメージは出席者も本体も0表示 ${side}`,async({page})=>{
  await page.goto(pathToFileURL(path.join(__dirname,'..','index.html')).href);
  const result=await page.evaluate(side=>{
    startCardTest('acting_out_woman');scheduleOpponentAI=()=>{};
    state.phase='battle';state.effectFeedbackEvents=[];
    state.online.role='host';state.online.started=true;state.online.connected=false;
    for(const owner of ['player','opponent'])state.players[owner].board={teacher:null,seats:Array(9).fill(null)};
    const woman=makeBoardCard(createCardFromBase('acting_out_woman',side));
    const friend=makeBoardCard(createCardFromBase('acting_out_man_2',side));
    const target=makeBoardCard(createCardFromBase('strong_student',side));target.defense=5;
    state.players[side].board.seats[0]=woman;state.players[side].board.seats[1]=friend;state.players[side].board.seats[2]=target;
    const source=makeBoardCard(createCardFromBase('general_student',oppositeSide(side)));
    render();const hp=target.currentHp,life=state.players[side].life;
    dealDamageToCard(target,3,source);damagePlayer(side,1,source);
    return {hp:target.currentHp===hp,life:state.players[side].life===life,events:state.effectFeedbackEvents.map(e=>e.text)};
  },side);
  expect(result).toEqual({hp:true,life:true,events:['0','0']});
  await expect(page.locator('.floating-pop').filter({hasText:/^0$/})).toHaveCount(2);
  await page.screenshot({path:test.info().outputPath('zero.png')});
});

for(const side of ['player','opponent']) test(`反撃なしは0を1回表示し、通常の反撃は維持 ${side}`,async({page})=>{
  await page.goto(pathToFileURL(path.join(__dirname,'..','index.html')).href);
  const result=await page.evaluate(side=>{
    startCardTest('acting_out_man');scheduleOpponentAI=()=>{};
    state.online.role='host';state.online.started=true;state.online.connected=false;state.phase='battle';
    const outcomes=[];
    for(const mode of ['acting','noCounter','zeroAttack','trendy','absolute','umbrella','normal','defense']){
      for(const owner of ['player','opponent'])state.players[owner].board={teacher:null,seats:Array(9).fill(null)};
      state.effectFeedbackEvents=[];
      const other=oppositeSide(side);
      const c=makeBoardCard(createCardFromBase(mode==='acting'?'acting_out_man':mode==='trendy'?'trendy_student':mode==='absolute'?'absolute_woman':'general_student',side));
      const t=makeBoardCard(createCardFromBase('general_student',other));
      c.currentHp=c.maxHp=20;t.currentHp=t.maxHp=20;t.attack=2;
      state.players[side].board.seats[0]=c;state.players[other].board.seats[0]=t;
      if(mode==='acting')state.players[side].board.seats[1]=makeBoardCard(createCardFromBase('acting_out_man_2',side));
      if(mode==='noCounter')c.noCounterAttack=true;
      if(mode==='zeroAttack')t.attack=0;
      if(mode==='trendy')t.currentHp=1;
      if(mode==='umbrella')t.yutaEquipments=[{baseId:'yuta_umbrella',shieldActive:true}];
      if(mode==='defense')c.defense=5;
      render();resolveCardAttack(c,t);
      outcomes.push({mode,hp:c.currentHp,texts:state.effectFeedbackEvents.filter(e=>e.instanceId===c.instanceId).map(e=>e.text)});
    }
    return outcomes;
  },side);
  for(const r of result){
    expect(r.texts).toEqual(r.mode==='normal'?['-2']:['0']);
    expect(r.hp).toBe(r.mode==='normal'?18:20);
  }
  await expect(page.locator('.floating-pop').filter({hasText:/^0$/})).not.toHaveCount(0);
  await page.screenshot({path:test.info().outputPath('counter-zero.png')});
});
