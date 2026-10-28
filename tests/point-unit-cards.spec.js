const {test,expect}=require('@playwright/test');
const {pathToFileURL}=require('node:url');
const path=require('node:path');
const fs=require('node:fs');
const url=pathToFileURL(path.join(__dirname,'../index.html')).href;
const ids=['short_sleeve_student','pinige','gecko_carrier_student','lucky_man','long_sleeve_student','group_sniper','could_not_escape_student'];
async function settle(p){await expect.poll(()=>p.evaluate(()=>fusionTasksBusy()),{timeout:15000}).toBe(false);}
async function choose(p,modes){await expect.poll(()=>p.evaluate(()=>!!state.pendingCardChoice)).toBe(true);await p.evaluate(modes=>{const c=state.pendingCardChoice;for(const m of modes||[c.cards[0].instanceId]){const v=c.cards.find(x=>x.instanceId===m||x.pointMode===m);toggleCardChoiceCard(v.instanceId);}confirmCardChoiceSelection();},modes);}
async function attend(p,id,index=4,score=0,side='player',source='hand'){await p.evaluate(({id,index,score,side,source})=>{state.players[side].pointScore=score;const c=makeBoardCard(createCardFromBase(id,side));attendCard(side,c,'seat',index,{attendanceSource:source});},{id,index,score,side,source});}
test.beforeEach(async({page})=>{await page.goto(url);await page.evaluate(()=>{
 startCardTest('short_sleeve_student');scheduleOpponentAI=()=>{};state.training.skipAnimations=true;state.phase='battle';state.currentSide='player';state.actionTurn=8;state.environment=null;
 for(const side of ['player','opponent'])Object.assign(state.players[side],{board:{seats:Array(9).fill(null),teacher:null},hand:[],deck:[],trash:[],late:[],life:10,will:20,maxWill:20,pointScore:0,pointSystemActive:false,submissionCounters:{}});
 });});
test('7枚の定義、登録、管理ログ、本文を同期',async({page})=>{
 const r=await page.evaluate(ids=>ids.map(id=>({id,base:CARD_BASES[id],direct:DIRECT_DECK_CARD_IDS.has(id),text:cardRulesText(createCardFromBase(id,'player'))})),ids);const catalog=require('../server/card-catalog.json');
 const stats=[[2,1,1],[3,0,0],[7,4,4],[5,2,3],[4,1,3],[5,2,1],[9,4,5]];
 for(const [i,c] of r.entries()){
  expect([c.base.cost,c.base.attack,c.base.hp]).toEqual(stats[i]);expect(c.direct).toBe(true);expect(catalog.names[c.id]).toBe(c.base.name);expect(catalog.display[c.id].cost).toBe(c.base.cost);
  const raw=JSON.parse(fs.readFileSync(path.join(__dirname,'../card_rules.txt'),'utf8').split('\n').find(l=>l.trimStart().startsWith(c.id+':')).trim().replace(/^[^:]+: /,'').replace(/,$/,''));
  const formatted=await page.evaluate(({id,raw})=>formatCardRulesDisplayText(createCardFromBase(id,'player'),raw),{id:c.id,raw});expect(c.text).toBe(formatted);
 }
 expect(r[4].text).toMatch(/^\[点数\]\n\[陽気\]\n/);expect(r[1].base.hasPoint).toBeUndefined();
});
for(const id of ['short_sleeve_student','pinige'])test(`点数カードだけ撃破で加点し、味方・非致死・追加被弾では増えない ${id}`,async({page})=>{
 await page.evaluate(id=>{const source=createCardFromBase(id,'player');const target=makeBoardCard(createCardFromBase('general_student','opponent'));state.players.opponent.board.seats[0]=target;dealDamageToCard(target,1,source);cleanupDestroyedCards();if(state.players.player.pointScore)throw Error('非致死で加点');dealDamageToCard(target,1,source);dealDamageToCard(target,1,createCardFromBase('general_student','player'));cleanupDestroyedCards();const ally=makeBoardCard(createCardFromBase('general_student','player'));state.players.player.board.seats[0]=ally;dealDamageToCard(ally,2,source);cleanupDestroyedCards();},id);
 expect(await page.evaluate(()=>state.players.player.pointScore)).toBe(id==='pinige'?0:1);
});
test('非点数カードがとどめを刺すと加点しない',async({page})=>{await page.evaluate(()=>{const c=makeBoardCard(createCardFromBase('general_student','opponent'));state.players.opponent.board.seats[0]=c;dealDamageToCard(c,1,createCardFromBase('short_sleeve_student','player'));dealDamageToCard(c,1,createCardFromBase('general_student','player'));cleanupDestroyedCards();});expect(await page.evaluate(()=>state.players.player.pointScore)).toBe(0);});
test('相手のターン中の反撃では加点しない',async({page})=>{
 await page.evaluate(()=>{const c=makeBoardCard(createCardFromBase('long_sleeve_student','player'));c.playedOnTurn=0;state.players.player.board.seats[0]=c;const enemy=makeBoardCard(createCardFromBase('aggro_student','opponent'));enemy.playedOnTurn=0;state.players.opponent.board.seats[0]=enemy;state.currentSide='opponent';resolveCardAttackWithBoardCleanup(enemy,{owner:'player',zone:'seat',index:0});});
 expect(await page.evaluate(()=>state.players.player.pointScore)).toBe(0);
});
test('直接破壊も人数分加点、通常の校外送りは加点しない',async({page})=>{
 await page.evaluate(()=>{for(const i of [0,1,2])state.players.opponent.board.seats[i]=makeBoardCard(createCardFromBase('general_student','opponent'));});await attend(page,'could_not_escape_student');await settle(page);expect(await page.evaluate(()=>state.players.player.pointScore)).toBe(3);
 await page.evaluate(()=>{state.players.opponent.board.seats[0]=makeBoardCard(createCardFromBase('general_student','opponent'));destroyBoardCard({owner:'opponent',zone:'seat',index:0},{isDestruction:false,pointSource:pointSourceSnapshot(createCardFromBase('short_sleeve_student','player'))});});expect(await page.evaluate(()=>state.players.player.pointScore)).toBe(3);
});
test('複数マスの出席者は1点、無効化されたカードは加点しない',async({page})=>{
 await page.evaluate(()=>{const c=makeBoardCard(createCardFromBase('two_achievers','opponent'));state.players.opponent.board.seats[0]=c;state.players.opponent.board.seats[1]=c;dealDamageToCard(c,10,createCardFromBase('group_sniper','player'));cleanupDestroyedCards();const t=makeBoardCard(createCardFromBase('general_student','opponent'));state.players.opponent.board.seats[0]=t;const source=createCardFromBase('short_sleeve_student','player');source.generatedWithoutEffects=true;dealDamageToCard(t,3,source);cleanupDestroyedCards();});expect(await page.evaluate(()=>state.players.player.pointScore)).toBe(1);
});
test('10点目は福男を発動せず単位に変化、10で停止、長袖は即時+2/+2で重複しない',async({page})=>{
 await page.evaluate(()=>{state.players.player.pointScore=9;state.players.player.pointSystemActive=true;state.players.player.board.seats[0]=makeBoardCard(createCardFromBase('lucky_man','player'));state.players.player.board.seats[1]=makeBoardCard(createCardFromBase('long_sleeve_student','player'));state.players.player.board.seats[1].currentHp=2;for(const i of [0,1])state.players.opponent.board.seats[i]=makeBoardCard(createCardFromBase('general_student','opponent'));const t=state.players.opponent.board.seats[0];dealDamageToCard(t,2,createCardFromBase('short_sleeve_student','player'));cleanupDestroyedCards();applyBoardAuras();applyBoardAuras();});await settle(page);
 expect(await page.evaluate(()=>({score:state.players.player.pointScore,life:state.players.player.life,hp:state.players.opponent.board.seats[1].currentHp,stats:[state.players.player.board.seats[1].attack,state.players.player.board.seats[1].maxHp,state.players.player.board.seats[1].currentHp],lines:playerActiveEffectLines('player')}))).toMatchObject({score:10,life:10,hp:2,stats:[3,5,4],lines:['[単位] 取得済み']});
 await page.evaluate(()=>{dealDamageToCard(state.players.opponent.board.seats[1],4,createCardFromBase('pinige','player'));cleanupDestroyedCards();});expect(await page.evaluate(()=>state.players.player.pointScore)).toBe(10);
});
test('福男は自分以外の撃破に反応し、続く自身の撃破には自己連鎖しない',async({page})=>{
 await page.evaluate(()=>{state.players.player.board.seats[0]=makeBoardCard(createCardFromBase('lucky_man','player'));for(const i of [0,1])state.players.opponent.board.seats[i]=makeBoardCard(createCardFromBase('general_student','opponent'));dealDamageToCard(state.players.opponent.board.seats[0],2,createCardFromBase('short_sleeve_student','player'));cleanupDestroyedCards();});await settle(page);expect(await page.evaluate(()=>[state.players.player.pointScore,state.players.player.life,listBoardRefs('opponent').length])).toEqual([2,12,0]);
});
test('半袖の通常はランダム2、単位後は2人まで選べる',async({page})=>{
 await page.evaluate(()=>{for(const i of [0,1,2])state.players.opponent.board.seats[i]=makeBoardCard(createCardFromBase('strong_student','opponent'));});await attend(page,'short_sleeve_student');await settle(page);expect(await page.evaluate(()=>listBoardRefs('opponent').map(getBoardCardFromRef).reduce((sum,c)=>sum+c.currentHp,0))).toBe(19);
 await attend(page,'short_sleeve_student',3,10);await expect.poll(()=>page.evaluate(()=>state.pendingCardChoice?.max)).toBe(2);expect(await page.evaluate(()=>state.pendingCardChoice.min)).toBe(0);await choose(page);await settle(page);expect(await page.evaluate(()=>listBoardRefs('opponent').map(getBoardCardFromRef).reduce((sum,c)=>sum+c.currentHp,0))).toBe(16);
});
test('ヤモリは左右2枚、生成したカードは再展開せず陽気、単位後は両効果',async({page})=>{
 await attend(page,'gecko_carrier_student',4,10);await choose(page,[2,1]);await settle(page);
 expect(await page.evaluate(()=>({seats:state.players.player.board.seats.map(c=>c?.baseId||null),jolly:[3,5].map(i=>hasKeyword(state.players.player.board.seats[i],'陽気')),super:hasKeyword(state.players.player.board.seats[4],'超陽気')}))).toEqual({seats:[null,null,null,'gecko_carrier_student','gecko_carrier_student','gecko_carrier_student',null,null,null],jolly:[true,true],super:true});
});
test('集団スナイパーは手札出席だけ増員、生成含む3人がそれぞれ指名する',async({page})=>{
 await page.evaluate(()=>{state.players.opponent.board.seats[0]=makeBoardCard(createCardFromBase('strong_student','opponent'));});await attend(page,'group_sniper');for(let i=0;i<3;i++)await choose(page);await settle(page);expect(await page.evaluate(()=>[listBoardRefs('player').length,state.players.opponent.board.seats[0].currentHp])).toEqual([3,4]);
});
test('単位後のスナイパーは本体を盤面から選べる',async({page})=>{
 await attend(page,'group_sniper',0,10,'player','generated');await expect.poll(()=>page.evaluate(()=>isBoardCardChoice())).toBe(true);await expect.poll(()=>page.evaluate(()=>battlePresentationBusy({ignoreFusionTasks:true}))).toBe(false);await page.evaluate(()=>render());await page.locator('[data-life-target="opponent"]').click({force:true});await page.locator('#itemTargetConfirmButton').click();await settle(page);expect(await page.evaluate(()=>state.players.opponent.life)).toBe(8);
});
test('福男の単位取得後は手札出席で2回指名・回復、生成では発動しない',async({page})=>{
 await page.evaluate(()=>{state.players.opponent.board.seats[0]=makeBoardCard(createCardFromBase('strong_student','opponent'));});await attend(page,'lucky_man',4,10);await choose(page);await choose(page);await settle(page);expect(await page.evaluate(()=>[state.players.opponent.board.seats[0].currentHp,state.players.player.life])).toEqual([1,14]);await attend(page,'lucky_man',3,10,'player','generated');await settle(page);expect(await page.evaluate(()=>state.players.player.life)).toBe(14);
});
test('逃げられなかった学生は単位取得後のみ1行目を1/4あえーで埋める',async({page})=>{
 await attend(page,'could_not_escape_student',4,10);await settle(page);expect(await page.evaluate(()=>state.players.player.board.seats.slice(0,3).map(c=>[c.baseId,c.attack,c.currentHp]))).toEqual(Array(3).fill(['ae_student',1,4]));
});
test('出席時破壊で10点になっても、同じ出席効果を途中から単位版に変えない',async({page})=>{
 await page.evaluate(()=>{state.players.opponent.board.seats[0]=makeBoardCard(createCardFromBase('general_student','opponent'));});await attend(page,'could_not_escape_student',4,9);await settle(page);expect(await page.evaluate(()=>[state.players.player.pointScore,listBoardRefs('player').length])).toEqual([10,1]);
});
for(const score of [0,10])test(`ピニゲは${score===10?3:1}択、重複なし、番号順、検索するが加点しない`,async({page})=>{
 await page.evaluate(score=>{state.players.player.pointScore=score;state.players.player.deck=['short_sleeve_student','long_sleeve_student','pinige'].map(id=>createCardFromBase(id,'player'));state.players.opponent.board.seats[0]=makeBoardCard(createCardFromBase('general_student','opponent'));const c=createCardFromBase('pinige','player');state.players.player.hand=[c];castImmediateItem('player',c,false);},score);
 await choose(page,score===10?[4,2,1]:[4]);await settle(page);
 expect(await page.evaluate(()=>[state.players.player.will,state.players.player.pointScore,state.players.player.hand.map(c=>c.baseId).sort(),listBoardRefs('opponent').length])).toEqual(score===10?[18,10,['long_sleeve_student','short_sleeve_student'],0]:[17,0,[],0]);
});
test('ピニゲ③で2点と同名補充、②ではピニゲを引かない',async({page})=>{
 for(const mode of [2,3]){await page.evaluate(()=>{state.players.player.deck=[createCardFromBase('pinige','player')];const c=createCardFromBase('pinige','player');state.players.player.hand=[c];castImmediateItem('player',c,false);});await choose(page,[mode]);await settle(page);expect(await page.evaluate(()=>state.players.player.hand.map(c=>c.baseId))).toEqual(mode===2?[]:['pinige']);expect(await page.evaluate(()=>state.players.player.pointScore)).toBe(mode===2?0:2);}
});
test('長袖は陽気、通常操作で2回攻撃し3回目は禁止',async({page})=>{
 await attend(page,'long_sleeve_student');await settle(page);expect(await page.evaluate(()=>{const c=state.players.player.board.seats[4];const before=cardAttacksUsedThisTurn(c);markCardAttackUsed(c);const first=cardAttacksUsedThisTurn(c);markCardAttackUsed(c);return [hasKeyword(c,'陽気'),before,first,cardAttacksUsedThisTurn(c),c.hasAttacked];})).toEqual([true,0,1,2,true]);
});
test('点数カードの本文は単位取得前後とも元の効果、単位取得済みならの順に固定する',async({page})=>{
 const result=await page.evaluate(()=>[0,10].map(score=>{state.players.player.pointScore=score;return POINT_CARD_IDS.filter(id=>CARD_BASES[id].hasPoint).map(id=>({id,text:cardRulesText(createCardFromBase(id,'player'))}));}));
 expect(result[1]).toEqual(result[0]);
 for(const {id,text} of result[1]){
  expect(text).toMatch(/^\[点数\]\n/);
  const unit=text.indexOf('[単位]取得済みなら、');expect(unit).toBeGreaterThan(0);
  const ordinary={short_sleeve_student:'ランダムに選び、2ダメージ',lucky_man:'点数]を獲得したとき',long_sleeve_student:'1ターンに2回攻撃',group_sniper:'1ダメージを与える',could_not_escape_student:'破壊する。',secretly_mocked_student:'その出席者は体力が1',gecko_carrier_student:'2. このカードは[超陽気]を持つ。'}[id];
  expect(text.indexOf(ordinary)).toBeGreaterThan(-1);expect(text.indexOf(ordinary)).toBeLessThan(unit);
 }
});

for(const id of ids)test(`実際のテストボタンで専用の開始状態から効果を使える ${id}`,async({page})=>{
 await page.goto(url);await page.locator('#homeNavDeckButton').click();await page.locator('[data-case-view="cards"]').click();
 await page.locator('#cardsCatalogSearch').fill(await page.evaluate(id=>CARD_BASES[id].name,id));await page.locator(`[data-catalog-card="${id}"]`).click();
 await page.locator('#cardTestStartButton').click();await page.evaluate(()=>{scheduleOpponentAI=()=>{};state.training.skipAnimations=true;});await expect.poll(()=>page.evaluate(()=>battlePresentationBusy())).toBe(false);
 const before=await page.evaluate(()=>[state.players.player.pointScore,state.players.player.life,state.players.player.deck.map(c=>c.baseId),state.players.player.hand.map(c=>c.baseId)]);expect(before[0]).toBe(id==='lucky_man'?8:id==='pinige'?7:9);expect(before[1]).toBe(10);expect(before[2]).toContain('pinige');expect(before[3]).toContain(id);
 await page.evaluate(id=>{const c=state.players.player.hand.find(c=>c.baseId===id);if(c.type==='item')castImmediateItem('player',c,false);else playCard(c.instanceId,'seat','player',4);},id);
 if(['pinige','gecko_carrier_student'].includes(id))await choose(page,[1]);
 if(id==='group_sniper')for(let i=0;i<3;i++)await choose(page);
 await settle(page);expect(await page.evaluate(id=>state.players.player.hand.filter(c=>c.baseId===id).length,id)).toBe(before[3].filter(x=>x===id).length-1);
});

test('開始時の継続効果表示は点数カードのある側だけで、ピニゲだけでは表示しない',async({page})=>{
 expect(await page.evaluate(()=>{state.players.player.originalDeckCounts={short_sleeve_student:0,pinige:3,general_student:37};state.players.opponent.originalDeckCounts={group_sniper:3,general_student:37};analyticsStartGame();return ['player','opponent'].map(s=>playerActiveEffectLines(s));})).toEqual([[],['[点数] 0/10']]);
});
test('CPUは選択を自動解決し、展開できる席を評価する',async({page})=>{
 await page.evaluate(()=>{state.currentSide='opponent';state.players.opponent.pointScore=10;state.players.player.board.seats[0]=makeBoardCard(createCardFromBase('strong_student','player'));state.players.opponent.deck=[createCardFromBase('long_sleeve_student','opponent')];const c=createCardFromBase('pinige','opponent');state.players.opponent.hand=[c];if(!Number.isFinite(scoreAiItem(c)))throw Error('AI item');castImmediateItem('opponent',c,false);attendCard('opponent',makeBoardCard(createCardFromBase('gecko_carrier_student','opponent')),'seat',4,{attendanceSource:ATTENDANCE_SOURCE.HAND});});await settle(page);
 expect(await page.evaluate(()=>[listBoardRefs('opponent').length,hasKeyword(state.players.opponent.board.seats[4],'超陽気'),state.pendingCardChoice])).toEqual([3,true,null]);
});
for(const mode of [3,4])test(`ゲストのピニゲ効果${mode}の点数と手札と撃破が同期する`,async({page:host,browser})=>{
 const guest=await browser.newPage();
 async function relay(from,to){for(const m of await from.evaluate(()=>outbox.splice(0)))await to.evaluate(m=>onlineHandleMessage({...m,type:m.command?'command':m.type,protocol:ONLINE_PROTOCOL_VERSION}),m);}
 try{
  await guest.goto(url);
  for(const[p,role]of[[host,'host'],[guest,'guest']])await p.evaluate(role=>{Object.assign(state.online,{role,started:true,connected:true,conn:{}});window.outbox=[];onlineSend=m=>{outbox.push(JSON.parse(JSON.stringify(m)));return true;};},role);
  await expect.poll(()=>host.evaluate(()=>battlePresentationBusy())).toBe(false);
  const snap=await host.evaluate(()=>{state.currentSide='opponent';state.players.opponent.pointScore=9;state.players.opponent.pointSystemActive=true;state.players.player.board.seats[0]=makeBoardCard(createCardFromBase('general_student','player'));state.players.opponent.hand=[createCardFromBase('pinige','opponent')];state.players.opponent.deck=[createCardFromBase('pinige','opponent')];return onlineCreateSnapshot();});
  await guest.evaluate(snapshot=>onlineHandleMessage({type:'gameState',protocol:ONLINE_PROTOCOL_VERSION,snapshot}),snap);await expect.poll(()=>guest.evaluate(()=>battlePresentationBusy())).toBe(false);
  await guest.evaluate(()=>beginItemUse(state.players.player.hand[0]));await relay(guest,host);await expect.poll(()=>host.evaluate(()=>state.pendingRemoteHandTrim?.mode)).toBe('fusion_effect_choice');await relay(host,guest);await choose(guest,[mode]);await relay(guest,host);await settle(host);await relay(host,guest);
  expect(await host.evaluate(()=>[state.players.opponent.pointScore,listBoardRefs('player').length])).toEqual(mode===3?[10,1]:[9,0]);expect(await guest.evaluate(()=>[state.players.player.pointScore,playerActiveEffectLines('player')[0],listBoardRefs('opponent').length])).toEqual(mode===3?[10,'[単位] 取得済み',1]:[9,'[点数] 9/10',0]);if(mode===3)expect(await guest.evaluate(()=>state.players.player.hand.map(c=>c.baseId))).toEqual(['pinige']);
 }finally{await guest.close();}
});
test('ゲストの単位スナイパーで本体を選び、同じ対象のダメージが同期する',async({page:host,browser})=>{
 const guest=await browser.newPage();
 async function relay(from,to){for(const m of await from.evaluate(()=>outbox.splice(0)))await to.evaluate(m=>onlineHandleMessage({...m,type:m.command?'command':m.type,protocol:ONLINE_PROTOCOL_VERSION}),m);}
 try{
  await guest.goto(url);
  for(const[p,role]of[[host,'host'],[guest,'guest']])await p.evaluate(role=>{Object.assign(state.online,{role,started:true,connected:true,conn:{}});window.outbox=[];onlineSend=m=>{outbox.push(JSON.parse(JSON.stringify(m)));return true;};},role);
  const snap=await host.evaluate(()=>{state.currentSide='opponent';state.players.opponent.pointScore=10;return onlineCreateSnapshot();});await guest.evaluate(snapshot=>onlineHandleMessage({type:'gameState',protocol:ONLINE_PROTOCOL_VERSION,snapshot}),snap);
  await host.evaluate(()=>attendCard('opponent',makeBoardCard(createCardFromBase('group_sniper','opponent')),'seat',0,{attendanceSource:ATTENDANCE_SOURCE.GENERATED}));await expect.poll(()=>host.evaluate(()=>state.pendingRemoteHandTrim?.mode)).toBe('fusion_effect_choice');await relay(host,guest);
  await expect.poll(()=>guest.evaluate(()=>!!state.pendingCardChoice)).toBe(true);await expect.poll(()=>guest.evaluate(()=>battlePresentationBusy({ignoreFusionTasks:true}))).toBe(false);
  const owner=await guest.evaluate(()=>state.pendingCardChoice.cards.find(c=>c.pointLifeTarget).owner);expect(owner).toBe('opponent');
  await guest.locator('[data-life-target="opponent"]').click({force:true});await guest.locator('#itemTargetConfirmButton').click();await relay(guest,host);await settle(host);await relay(host,guest);
  expect(await host.evaluate(()=>state.players.player.life)).toBe(8);expect(await guest.evaluate(()=>state.players.opponent.life)).toBe(8);
 }finally{await guest.close();}
});
for(const id of ids)test(`カードテストの通常操作で単位を取得して強化後を試せる ${id}`,async({page})=>{
 await page.goto(url);await page.locator('#homeNavDeckButton').click();await page.locator('[data-case-view="cards"]').click();await page.locator('#cardsCatalogSearch').fill(await page.evaluate(id=>CARD_BASES[id].name,id));await page.locator(`[data-catalog-card="${id}"]`).click();await page.locator('#cardTestStartButton').click();
 await page.evaluate(()=>{scheduleOpponentAI=()=>{};state.training.skipAnimations=true;});await expect.poll(()=>page.evaluate(()=>battlePresentationBusy())).toBe(false);
 if(id==='pinige'){for(let i=0;i<2;i++){await page.evaluate(()=>castImmediateItem('player',state.players.player.hand.find(c=>c.baseId==='pinige'),false));await choose(page,[3]);await settle(page);}}
 for(const target of id==='pinige'?[]:id==='lucky_man'?[0,8]:[0]){await expect.poll(()=>page.evaluate(()=>battlePresentationBusy())).toBe(false);await page.evaluate(async target=>{handleBoardCardClick('player','seat',6);await attackCard('opponent','seat',target);},target);await settle(page);}
 expect(await page.evaluate(()=>state.players.player.pointScore)).toBe(10);
 await expect.poll(()=>page.evaluate(()=>battlePresentationBusy())).toBe(false);
 await page.evaluate(id=>{const c=state.players.player.hand.find(c=>c.baseId===id);if(c.type==='item')castImmediateItem('player',c,false);else playCard(c.instanceId,'seat','player',4);},id);
 if(id==='pinige')await choose(page,[3,2,1]);
 if(id==='gecko_carrier_student')await choose(page,[2,1]);
 if(id==='short_sleeve_student')await choose(page);
 if(id==='lucky_man')for(let i=0;i<2;i++)await choose(page);
 if(id==='group_sniper')for(let i=0;i<3;i++)await choose(page);
 await settle(page);
 const r=await page.evaluate(()=>({score:state.players.player.pointScore,life:state.players.player.life,own:listBoardRefs('player').map(getBoardCardFromRef).map(c=>[c.baseId,c.attack,c.currentHp]),enemy:listBoardRefs('opponent').length,hand:state.players.player.hand.map(c=>c.baseId)}));
 expect(r.score).toBe(10);
 if(id==='long_sleeve_student')expect(r.own).toContainEqual([id,3,5]);
 if(id==='gecko_carrier_student'||id==='group_sniper')expect(r.own.filter(c=>c[0]===id)).toHaveLength(3);
 if(id==='lucky_man')expect(r.life).toBe(14);
 if(id==='could_not_escape_student')expect(r.own.filter(c=>c[0]==='ae_student')).toHaveLength(3);
 if(id==='pinige')expect(r.hand.length).toBeGreaterThan(3);
 if(id==='long_sleeve_student')await page.screenshot({path:test.info().outputPath('point-unit-battle-desktop.png')});
});

for(const score of [0,7,8,9,10])test(`ピニゲ③は2点を一括獲得し10点で止まり、その後もサーチする ${score}`,async({page})=>{
 await page.evaluate(score=>{state.players.player.pointScore=score;state.players.player.board.seats[0]=makeBoardCard(createCardFromBase('long_sleeve_student','player'));state.players.player.deck=[createCardFromBase('pinige','player')];const item=createCardFromBase('pinige','player');state.players.player.hand=[item];castImmediateItem('player',item,false);},score);
 await choose(page,score===10?[3,1,2]:[3]);await settle(page);
 expect(await page.evaluate(()=>[state.players.player.pointScore,state.players.player.hand.map(c=>c.baseId),state.players.player.board.seats[0].attack])).toEqual([Math.min(10,score+2),['pinige'],score>=8?3:1]);
});
for(const score of [0,8])test(`ピニゲ③の2点で福男は一度だけ反応し、単位取得時は反応しない ${score}`,async({page})=>{
 await page.evaluate(score=>{state.players.player.pointScore=score;state.players.player.board.seats[0]=makeBoardCard(createCardFromBase('lucky_man','player'));state.players.opponent.board.seats[0]=makeBoardCard(createCardFromBase('strong_student','opponent'));const item=createCardFromBase('pinige','player');state.players.player.hand=[item];castImmediateItem('player',item,false);},score);await choose(page,[3]);await settle(page);
 expect(await page.evaluate(()=>[state.players.player.pointScore,state.players.player.life,state.players.opponent.board.seats[0].currentHp])).toEqual(score===8?[10,10,7]:[2,12,4]);
});
test('ピニゲ③はサーチできなくても加点、単位取得済みではサーチだけ、③④の撃破では増えない',async({page})=>{
 await page.evaluate(()=>{state.players.player.pointScore=9;state.players.player.deck=[createCardFromBase('pinige','player')];state.players.opponent.board.seats[0]=makeBoardCard(createCardFromBase('general_student','opponent'));const item=createCardFromBase('pinige','player');state.players.player.hand=[item];castImmediateItem('player',item,false);});await choose(page,[3]);await settle(page);
 // A mid-effect unit acquisition does not add choices to the current cast.
 expect(await page.evaluate(()=>[state.players.player.pointScore,state.pendingCardChoice,state.players.opponent.board.seats[0].currentHp])).toEqual([10,null,2]);
 await page.evaluate(()=>castImmediateItem('player',state.players.player.hand[0],false));await choose(page,[4,3,1]);await settle(page);expect(await page.evaluate(()=>[state.players.player.pointScore,listBoardRefs('opponent').length,state.players.player.hand.length])).toEqual([10,0,0]);
});
test('CPUは8点なら③による単位取得を評価する',async({page})=>{
 await page.evaluate(()=>{state.currentSide='opponent';state.players.opponent.pointScore=8;const item=createCardFromBase('pinige','opponent');state.players.opponent.hand=[item];state.players.opponent.deck=[createCardFromBase('pinige','opponent')];castImmediateItem('opponent',item,false);});await settle(page);expect(await page.evaluate(()=>[state.players.opponent.pointScore,state.players.opponent.hand.map(c=>c.baseId)])).toEqual([10,['pinige']]);
});
test('実際のカードテストから③を2回使い、単位を取得して3択を使える',async({page})=>{
 await page.goto(url);await page.locator('#homeNavDeckButton').click();await page.locator('[data-case-view="cards"]').click();await page.locator('#cardsCatalogSearch').fill('ピニゲ');await page.locator('[data-catalog-card="pinige"]').click();await page.locator('#cardTestStartButton').click();await page.evaluate(()=>{scheduleOpponentAI=()=>{};state.training.skipAnimations=true;});await expect.poll(()=>page.evaluate(()=>battlePresentationBusy())).toBe(false);
 for(const score of [9,10]){await expect.poll(()=>page.evaluate(()=>battlePresentationBusy())).toBe(false);await page.evaluate(()=>beginItemUse(state.players.player.hand.find(c=>c.baseId==='pinige')));await choose(page,[3]);await settle(page);expect(await page.evaluate(()=>state.players.player.pointScore)).toBe(score);}
 await expect.poll(()=>page.evaluate(()=>battlePresentationBusy())).toBe(false);await page.evaluate(()=>beginItemUse(state.players.player.hand.find(c=>c.baseId==='pinige')));await expect.poll(()=>page.evaluate(()=>state.pendingCardChoice?.max)).toBe(3);await choose(page,[4,2,1]);await settle(page);await page.screenshot({path:test.info().outputPath('pinige-unit.png')});
});
