const {test,expect}=require('@playwright/test');
const {pathToFileURL}=require('node:url');const path=require('node:path');const fs=require('node:fs');
const url=pathToFileURL(path.join(__dirname,'../index.html')).href;
const id='secretly_mocked_student';
async function settle(p){await expect.poll(()=>p.evaluate(()=>fusionTasksBusy()),{timeout:15000}).toBe(false);}
async function select(p){await expect.poll(()=>p.evaluate(()=>!!state.pendingCardChoice)).toBe(true);await p.evaluate(()=>{toggleCardChoiceCard(state.pendingCardChoice.cards[0].instanceId);confirmCardChoiceSelection();});}
async function spawn(p,score=0,source='hand',side='player'){await p.evaluate(({score,source,side})=>{state.players[side].pointScore=score;return attendCard(side,makeBoardCard(createCardFromBase('secretly_mocked_student',side)),'seat',8,{attendanceSource:source});},{score,source,side});}
test.beforeEach(async({page})=>{await page.goto(url);await page.evaluate(()=>{startCardTest('secretly_mocked_student');scheduleOpponentAI=()=>{};state.training.skipAnimations=true;state.phase='battle';state.currentSide='player';state.actionTurn=8;state.environment=null;for(const side of ['player','opponent'])Object.assign(state.players[side],{board:{teacher:null,seats:Array(9).fill(null)},hand:[],deck:[],trash:[],late:[],life:10,will:20,maxWill:20,pointScore:0,pointSystemActive:false,submissionCounters:{}});});});
test('能力値、本文順、登録、台帳、管理ログを一致させる',async({page})=>{
 const catalog=require('../server/card-catalog.json');const c=await page.evaluate(()=>{const c=createCardFromBase('secretly_mocked_student','player');const before=cardRulesText(c);state.players.player.pointScore=10;return {base:CARD_BASES[c.baseId],direct:DIRECT_DECK_CARD_IDS.has(c.baseId),before,after:cardRulesText(c)};});
 expect([c.base.cost,c.base.attack,c.base.hp]).toEqual([4,1,1]);expect(c.base.hasPoint).toBe(true);expect(c.direct).toBe(true);expect(c.before).toBe(c.after);expect(c.before).toMatch(/^\[点数\]\nこのカードは3行3列にのみ出席できる。\n/);expect(c.before.indexOf('体力を1にする')).toBeLessThan(c.before.indexOf('[単位]取得済みなら、'));expect(catalog.names[id]).toBe('密かに冷笑される女学生');expect(catalog.display[id]).toMatchObject({cost:4,attack:1,hp:1});
 const raw=JSON.parse(fs.readFileSync(path.join(__dirname,'../card_rules.txt'),'utf8').split('\n').find(l=>l.trimStart().startsWith(id+':')).trim().replace(/^[^:]+: /,'').replace(/,$/,''));expect(c.before).toBe(await page.evaluate(raw=>formatCardRulesDisplayText(createCardFromBase('secretly_mocked_student','player'),raw),raw));
});
for(const side of ['player','opponent'])test(`${side}は3行3列にのみ出席可能、生成出席にも場所制限`,async({page})=>{
 expect(await page.evaluate(side=>{const c=createCardFromBase('secretly_mocked_student',side);return {seats:Array.from({length:9},(_,i)=>canPlaceCard(side,c,'seat',side,i)),teacher:canPlaceCard(side,c,'teacher',side,null),bad:!!attendCard(side,makeBoardCard(c),'seat',7,{attendanceSource:ATTENDANCE_SOURCE.GENERATED}),good:!!attendCard(side,makeBoardCard(c),'seat',8,{attendanceSource:ATTENDANCE_SOURCE.GENERATED})};},side)).toEqual({seats:[false,false,false,false,false,false,false,false,true],teacher:false,bad:false,good:true});
});
test('通常出席は現在の体力だけを1にし、攻撃・講義・準備表示を禁止する',async({page})=>{
 await page.evaluate(()=>{const c=makeBoardCard(createCardFromBase('general_teacher','opponent'));c.playedOnTurn=0;state.players.opponent.board.teacher=c;});await spawn(page);await settle(page);
 expect(await page.evaluate(()=>{const c=state.players.opponent.board.teacher;state.currentSide='opponent';render();return {hp:c.currentHp,max:c.maxHp,attack:canAttack(c),silent:canAttackSilently(c),locked:isAttackLocked(c),lecture:canTeacherChooseLecture({owner:'opponent',zone:'teacher',index:null}),parts:statusPartsForCard(c,true).map(x=>x.title),score:state.players.player.pointScore};})).toMatchObject({hp:1,max:2,attack:false,silent:false,locked:true,lecture:false,score:0,parts:expect.arrayContaining(['体力1：攻撃不可'])});
 await expect(page.locator('.board-card[data-owner="opponent"][data-zone="teacher"]')).toHaveClass(/attack-locked/);
});
test('回復で攻撃可能、再び体力1なら禁止、女学生が退場しても条件が残る',async({page})=>{
 await page.evaluate(()=>{const c=makeBoardCard(createCardFromBase('strong_student','opponent'));c.playedOnTurn=0;state.players.opponent.board.seats[0]=c;});await spawn(page);await settle(page);
 expect(await page.evaluate(()=>{const c=state.players.opponent.board.seats[0];destroyBoardCard({owner:'player',zone:'seat',index:8});healCard(c,1);render();return [c.currentHp,c.maxHp,canAttackSilently(c),isAttackLocked(c),boardVisualSnapshot(c).attackLocked,statusPartsForCard(c,true).some(x=>x.title==='体力1：攻撃不可')];})).toEqual([2,7,true,false,false,false]);
 await expect(page.locator('.board-card[data-owner="opponent"][data-zone="seat"][data-index="0"]')).not.toHaveClass(/attack-locked/);
 expect(await page.evaluate(()=>{const c=state.players.opponent.board.seats[0];dealDamageToCard(c,1,createCardFromBase('general_student','player'));render();return [c.currentHp,canAttackSilently(c),isAttackLocked(c),battleCardRestrictionEntries(c).some(x=>x.label==='攻撃制限：体力1')];})).toEqual([1,false,true,true]);
});
test('対象を校外へ送り出席し直したら付与された条件は消える',async({page})=>{
 await page.evaluate(()=>{state.players.opponent.board.seats[0]=makeBoardCard(createCardFromBase('strong_student','opponent'));});await spawn(page);await settle(page);
 expect(await page.evaluate(()=>{const c=state.players.opponent.board.seats[0];destroyBoardCard({owner:'opponent',zone:'seat',index:0});const next=makeBoardCard(c);attendCard('opponent',next,'seat',0,{attendanceSource:ATTENDANCE_SOURCE.GENERATED});return [!!next.oneHpAttackLockSource,next.currentHp,isOneHpAttackLocked(next)];})).toEqual([false,7,false]);
});
for(const source of ['generated','trash'])test(`${source}出席では能力を発動しない`,async({page})=>{await page.evaluate(()=>{state.players.opponent.board.seats[0]=makeBoardCard(createCardFromBase('strong_student','opponent'));});await spawn(page,10,source);await settle(page);expect(await page.evaluate(()=>[state.players.opponent.board.seats[0].currentHp,!!state.pendingCardChoice])).toEqual([7,false]);});
test('南京錠には体力変更も制限付与もしない',async({page})=>{
 await page.evaluate(()=>{const c=makeBoardCard(createCardFromBase('super_ae_student','opponent'));attachPadlock(c,createCardFromBase('padlock','opponent'));state.players.opponent.board.seats[4]=c;});await spawn(page);await settle(page);expect(await page.evaluate(()=>[state.players.opponent.board.seats[4].currentHp,!!state.players.opponent.board.seats[4].oneHpAttackLockSource])).toEqual([2,false]);
});
test('有効な超注目があると、その出席者をランダム効果の対象にする',async({page})=>{await page.evaluate(()=>{state.players.opponent.board.seats[0]=makeBoardCard(createCardFromBase('strong_student','opponent'));state.players.opponent.board.seats[4]=makeBoardCard(createCardFromBase('super_ae_student','opponent'));});await spawn(page);await settle(page);expect(await page.evaluate(()=>[state.players.opponent.board.seats[0].currentHp,state.players.opponent.board.seats[4].currentHp])).toEqual([7,1]);});
test('単位取得後は盤面で選んだ1人を破壊し、通常の体力変更を行わない',async({page})=>{
 await page.evaluate(()=>{state.players.opponent.board.seats[0]=makeBoardCard(createCardFromBase('strong_student','opponent'));state.players.opponent.board.seats[1]=makeBoardCard(createCardFromBase('general_student','opponent'));});await spawn(page,10);await expect.poll(()=>page.evaluate(()=>!!state.pendingCardChoice)).toBe(true);await expect.poll(()=>page.evaluate(()=>battlePresentationBusy({ignoreFusionTasks:true}))).toBe(false);
 await page.locator('.board-card[data-owner="opponent"][data-zone="seat"][data-index="1"]').click();await page.locator('#itemTargetConfirmButton').click();await settle(page);expect(await page.evaluate(()=>[state.players.opponent.board.seats[0].currentHp,state.players.opponent.board.seats[1],state.players.player.pointScore])).toEqual([7,null,10]);
});
test('対象がいないときも出席でき、選択待ちが残らない',async({page})=>{await spawn(page,10);await settle(page);expect(await page.evaluate(()=>[state.players.player.board.seats[8].baseId,state.pendingCardChoice])).toEqual([id,null]);});
for(const turn of ['player','opponent'])test(`${turn}のターン中、点数カードの能力と直接破壊は所有者のターンだけ加点`,async({page})=>{
 await page.evaluate(turn=>{state.currentSide=turn;state.players.opponent.board.seats[0]=makeBoardCard(createCardFromBase('general_student','opponent'));dealDamageToCard(state.players.opponent.board.seats[0],3,createCardFromBase('short_sleeve_student','player'));cleanupDestroyedCards();state.players.opponent.board.seats[1]=makeBoardCard(createCardFromBase('general_student','opponent'));destroyBoardCard({owner:'opponent',zone:'seat',index:1},{pointSource:pointSourceSnapshot(createCardFromBase('could_not_escape_student','player'))});},turn);
 expect(await page.evaluate(()=>state.players.player.pointScore)).toBe(turn==='player'?2:0);
});
test('CPUは女学生の対象選択を自動で解決する',async({page})=>{await page.evaluate(()=>{state.currentSide='opponent';state.players.player.board.seats[0]=makeBoardCard(createCardFromBase('strong_student','player'));state.players.player.board.seats[1]=makeBoardCard(createCardFromBase('aggro_student','player'));});await spawn(page,10,'hand','opponent');await settle(page);expect(await page.evaluate(()=>[listBoardRefs('player').length,state.pendingCardChoice])).toEqual([1,null]);});
for(const unit of [false,true])test(`実際のカードテストから通常操作で${unit?'単位取得後の破壊':'体力1と回復'}を確認`,async({page})=>{
 await page.goto(url);await page.locator('#homeNavDeckButton').click();await page.locator('[data-case-view="cards"]').click();await page.locator('#cardsCatalogSearch').fill('密かに冷笑される女学生');await page.locator(`[data-catalog-card="${id}"]`).click();await page.locator('#cardTestStartButton').click();await page.evaluate(()=>{state.training.skipAnimations=true;});await expect.poll(()=>page.evaluate(()=>battlePresentationBusy())).toBe(false);
 if(unit){await page.evaluate(async()=>{handleBoardCardClick('player','seat',6);await attackCard('opponent','seat',0);});await expect.poll(()=>page.evaluate(()=>battlePresentationBusy())).toBe(false);expect(await page.evaluate(()=>state.players.player.pointScore)).toBe(10);}
 await page.evaluate(()=>{const c=state.players.player.hand.find(c=>c.baseId==='secretly_mocked_student');playCard(c.instanceId,'seat','player',8);});if(unit)await select(page);await settle(page);
 if(unit)expect(await page.evaluate(()=>listBoardRefs('opponent').length)).toBe(0);
 else {
  const affected=await page.evaluate(()=>listBoardRefs('opponent').map(getBoardCardFromRef).find(c=>c.oneHpAttackLockSource).instanceId);
  expect(await page.evaluate(id=>{const c=listBoardRefs('opponent').map(getBoardCardFromRef).find(c=>c.instanceId===id);return [c.currentHp,isAttackLocked(c),c.maxHp];},affected)).toEqual([1,true,3]);
  await expect.poll(()=>page.evaluate(()=>battlePresentationBusy())).toBe(false);await page.evaluate(()=>endTurn());await expect.poll(()=>page.evaluate(()=>state.actionTurn>=3 && state.currentSide==='player')).toBe(true);
  expect(await page.evaluate(id=>{const c=listBoardRefs('opponent').map(getBoardCardFromRef).find(c=>c.instanceId===id);return [c.currentHp,isAttackLocked(c)];},affected)).toEqual([2,false]);
 }
 await page.screenshot({path:test.info().outputPath(unit?'mocked-unit.png':'mocked-normal.png')});
});
for(const unit of [false,true])test(`オンラインで女学生の${unit?'ゲストの破壊対象選択':'体力1・制限・回復後の解除'}が同期`,async({page:host,browser})=>{
 const guest=await browser.newPage();
 async function relay(from,to){for(const m of await from.evaluate(()=>outbox.splice(0)))await to.evaluate(m=>onlineHandleMessage({...m,type:m.command?'command':m.type,protocol:ONLINE_PROTOCOL_VERSION}),m);}
 try{
  await guest.goto(url);
  for(const[p,role]of[[host,'host'],[guest,'guest']])await p.evaluate(role=>{Object.assign(state.online,{role,started:true,connected:true,conn:{}});window.outbox=[];onlineSend=m=>{outbox.push(JSON.parse(JSON.stringify(m)));return true;};},role);
  const snapshot=await host.evaluate(unit=>{const side=unit?'opponent':'player';state.currentSide=side;state.players[side].pointScore=unit?10:0;const target=makeBoardCard(createCardFromBase('yuta',oppositeSide(side)));target.playedOnTurn=0;state.players[oppositeSide(side)].board.seats[0]=target;return onlineCreateSnapshot();},unit);await guest.evaluate(snapshot=>onlineHandleMessage({type:'gameState',protocol:ONLINE_PROTOCOL_VERSION,snapshot}),snapshot);
  await host.evaluate(unit=>{const side=unit?'opponent':'player';attendCard(side,makeBoardCard(createCardFromBase('secretly_mocked_student',side)),'seat',8,{attendanceSource:ATTENDANCE_SOURCE.HAND});},unit);
  if(unit){await expect.poll(()=>host.evaluate(()=>state.pendingRemoteHandTrim?.mode)).toBe('fusion_effect_choice');await relay(host,guest);await expect.poll(()=>guest.evaluate(()=>!!state.pendingCardChoice)).toBe(true);await expect.poll(()=>guest.evaluate(()=>battlePresentationBusy({ignoreFusionTasks:true}))).toBe(false);await guest.locator('.board-card[data-owner="opponent"][data-zone="seat"][data-index="0"]').click();await guest.locator('#itemTargetConfirmButton').click();await relay(guest,host);}
  await settle(host);await relay(host,guest);
  if(unit){expect(await host.evaluate(()=>listBoardRefs('player').length)).toBe(0);expect(await guest.evaluate(()=>listBoardRefs('opponent').length)).toBe(0);}
  else {
   expect(await guest.evaluate(()=>{const c=state.players.player.board.seats[0];return [c.currentHp,isOneHpAttackLocked(c),canAttackSilently(c)];})).toEqual([1,true,false]);
   await host.evaluate(()=>{destroyBoardCard({owner:'player',zone:'seat',index:8});healCard(state.players.opponent.board.seats[0],1);render();onlineBroadcastState(true);});await relay(host,guest);expect(await guest.evaluate(()=>{const c=state.players.player.board.seats[0];return [c.currentHp,isOneHpAttackLocked(c),canAttackSilently(c)];})).toEqual([2,false,true]);
  }
 }finally{await guest.close();}
});
