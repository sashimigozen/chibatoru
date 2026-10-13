const {test,expect}=require('@playwright/test');
const {pathToFileURL}=require('node:url');
const path=require('node:path');
test.beforeEach(async({page})=>{
  await page.setViewportSize({width:1440,height:900});
  await page.goto(pathToFileURL(path.join(__dirname,'..','index.html')).href);
  await page.evaluate(()=>{
    startCardTest('umaibo');scheduleOpponentAI=()=>{};state.environment=null;state.training.skipAnimations=true;
    for(const side of ['player','opponent'])Object.assign(state.players[side],{board:{teacher:null,seats:Array(9).fill(null)},hand:[],deck:[],trash:[],life:5});
    state.online.role='host';state.online.started=true;state.online.connected=false;state.effectFeedbackEvents=[];
    window.popEvents=[];
    new MutationObserver(records=>records.forEach(record=>record.addedNodes.forEach(node=>{
      if(node.classList?.contains('floating-pop'))window.popEvents.push({text:node.textContent,time:performance.now()});
    }))).observe(document.body,{childList:true});
    render();
  });
  await expect.poll(()=>page.evaluate(()=>battlePresentationBusy())).toBe(false);
});
for(const side of ['player','opponent'])test(`${side}の終了時3回復が2回発動すると+3を2回順番に表示する`,async({page})=>{
  await page.evaluate(side=>{
    state.players[side].board.seats[0]=makeBoardCard(createCardFromBase('umaibo',side));
    state.players[side].board.seats[1]=makeBoardCard(createCardFromBase('umaibo',side));
    render();resolveStudentEndTurnEffects(side);
  },side);
  await expect.poll(()=>page.evaluate(()=>window.popEvents.length)).toBe(2);
  const result=await page.evaluate(side=>({life:state.players[side].life,pops:window.popEvents,events:state.effectFeedbackEvents.filter(e=>e.target==='life')}),side);
  expect(result.life).toBe(11);expect(result.pops.map(e=>e.text)).toEqual(['+3','+3']);
  expect(result.pops[1].time-result.pops[0].time).toBeGreaterThan(350);
  expect(result.events[1].occurredAt+result.events[1].delayMs-result.events[0].occurredAt-result.events[0].delayMs).toBeGreaterThan(350);
  if(side==='player')await page.screenshot({path:test.info().outputPath('two-recoveries.png')});
});
test('回復上限では実際の回復量を保ち、別の本体への回復は同時のまま',async({page})=>{
  const result=await page.evaluate(()=>{
    state.players.player.life=16;healPlayer('player',3);healPlayer('player',3);healPlayer('opponent',3);
    return {life:state.players.player.life,events:state.effectFeedbackEvents.map(e=>({text:e.text,delay:e.delayMs}))};
  });
  expect(result.life).toBe(20);expect(result.events.map(e=>e.text)).toEqual(['+3','+1','+3']);
  expect(result.events[1].delay).toBeGreaterThan(350);expect(result.events[2].delay).toBeLessThan(20);
});
test('同じ出席者への回復と連続ダメージも個別表示し、リセット後の待機を残さない',async({page})=>{
  const result=await page.evaluate(()=>{
    const card=makeBoardCard(createCardFromBase('umaibo','player'));card.currentHp=1;state.players.player.board.seats[0]=card;render();
    healCard(card,1);healCard(card,1);dealDamageToCard(card,1);dealDamageToCard(card,1);
    const events=state.effectFeedbackEvents.filter(e=>e.target==='card').map(e=>({text:e.text,delay:e.delayMs}));
    state.preBattleToken++;healPlayer('player',1);
    return {hp:card.currentHp,events,last:state.effectFeedbackEvents.at(-1).delayMs};
  });
  expect(result.hp).toBe(1);expect(result.events.map(e=>e.text)).toEqual(['+1','+1','-1','-1']);
  for(let i=1;i<result.events.length;i++)expect(result.events[i].delay-result.events[i-1].delay).toBeGreaterThan(350);
  expect(result.last).toBeLessThan(20);
});
test('オンラインの受信側でも合計値ではなく個別イベントを順番に表示する',async({page})=>{
  await page.evaluate(()=>{
    state.online.role='guest';state.online.isApplyingRemote=true;
    const occurredAt=Date.now();state.effectFeedbackEvents=[
      {id:'heal-a',target:'life',owner:'opponent',kind:'heal',text:'+3',occurredAt,delayMs:0},
      {id:'heal-b',target:'life',owner:'opponent',kind:'heal',text:'+3',occurredAt,delayMs:420}];
    showOnlineEffectFeedbackEvents({screen:'battle',feedbackEventIds:new Set()});
  });
  await expect.poll(()=>page.evaluate(()=>window.popEvents.length)).toBe(2);
  const pops=await page.evaluate(()=>window.popEvents);
  expect(pops.map(e=>e.text)).toEqual(['+3','+3']);expect(pops[1].time-pops[0].time).toBeGreaterThan(350);
});
