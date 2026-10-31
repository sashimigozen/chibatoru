const {test,expect}=require('@playwright/test');
const {spawn}=require('node:child_process');
const net=require('node:net');const path=require('node:path');const {pathToFileURL}=require('node:url');
const root=path.join(__dirname,'..');let server,url;
test.beforeAll(async()=>{
 const port=await new Promise(resolve=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});
 url=pathToFileURL(path.join(root,'index.html'));url.searchParams.set('ws',`ws://127.0.0.1:${port}`);
 server=spawn(process.execPath,[path.join(root,'server/server.js')],{env:{...process.env,PORT:String(port)},stdio:['ignore','pipe','pipe']});
 await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('server timeout')),5000);server.stdout.on('data',x=>{if(String(x).includes('listening')){clearTimeout(timer);resolve();}});server.once('error',reject);});
});
test.afterAll(()=>server?.kill());
async function open(page){await page.goto(url.href);await page.locator('#homeNavBattleButton').click();await page.locator('#onlinePrivateMatchButton').click();}
async function unit(page){await page.goto(url.href);await page.evaluate(()=>{startCardTest('private_teacher');scheduleOpponentAI=()=>{};state.training.skipAnimations=true;state.battleHandLimit=9;state.environment=null;for(const side of ['player','opponent'])Object.assign(state.players[side],{hand:[],deck:[],trash:[],board:{teacher:null,seats:Array(9).fill(null)}});});}
for(const side of ['player','opponent'])test(`ドロー超過は校外へ送り、提出は発動せず、通常ドロー処理を完了する ${side}`,async({page})=>{
 await unit(page);
 expect(await page.evaluate(side=>{const p=state.players[side];p.hand=Array.from({length:8},()=>createCardFromBase('ruler',side));p.deck=['general_student','wonton_greeting','ruler'].map(id=>createCardFromBase(id,side));const ok=drawCards(side,3,true);return[ok,p.hand.length,p.deck.length,p.trash.map(c=>c.baseId),p.submissionCounters?.['万豚記カウント']||0,!!state.gameOver];},side)).toEqual([true,9,0,['wonton_greeting','ruler'],0,false]);
});
test('手札8枚からの2枚生成は1枚だけ入り、上限なしならすべて入る',async({page})=>{
 await unit(page);
 expect(await page.evaluate(()=>{const p=state.players.player;p.hand=Array.from({length:8},()=>createCardFromBase('ruler','player'));attendCard('player',makeBoardCard(createCardFromBase('private_teacher','player')),'teacher',null,{attendanceSource:ATTENDANCE_SOURCE.HAND});const limited=[p.hand.length,p.hand.filter(c=>c.baseId==='exploding_student').length];state.battleHandLimit=null;for(let i=0;i<12;i++)generateWontonCard('player','wonton_greeting',{name:'test'});return[...limited,p.hand.length,p.submissionCounters?.['万豚記カウント']||0];})).toEqual([9,1,21,0]);
});
test('高負荷の生成カードも上限超過なら手札に入らず校外へ送る',async({page})=>{
 await unit(page);
 expect(await page.evaluate(()=>{const p=state.players.player;p.hand=Array.from({length:9},()=>createCardFromBase('ruler','player'));const c=createCardFromBase('wonton_greeting','player');c.handLoadLevel=2;const n=addHandCards('player',[c]);return[n,p.hand.length,p.trash.length,p.submissionCounters?.['万豚記カウント']||0];})).toEqual([0,9,1,0]);
});
test('カードテストも通常ルールの上限9枚で開始する',async({page})=>{
 await unit(page);expect(await page.evaluate(()=>{startCardTest('private_teacher');return state.battleHandLimit;})).toBe(9);
});
for(const startLimit of [9,null])test(`ホスト設定・増減・直接入力・空欄・準備解除・対戦開始後の同期 ${startLimit}`,async({browser})=>{
 test.setTimeout(90000);const contexts=await Promise.all([browser.newContext(),browser.newContext()]);const[host,guest]=await Promise.all(contexts.map(c=>c.newPage()));
 try{
  await open(host);await host.locator('#onlineCreateRoomButton').click();await expect.poll(()=>host.evaluate(()=>state.online.lastSeenAt>0)).toBe(true);
  await expect(host.locator('#onlineRandomHandLimit')).toHaveValue('9');await expect(host.locator('#onlineRandomHandLimitMinus')).toBeDisabled();
  await host.locator('#onlineRandomHandLimitPlus').click();await expect.poll(()=>host.evaluate(()=>state.online.handLimit)).toBe(10);
  await open(guest);await guest.locator('.private-code-entry > summary').click();await guest.locator('#onlineRoomInput').fill(await host.evaluate(()=>state.online.roomCode));await guest.locator('#onlineJoinRoomButton').click();await expect(guest.locator('#onlineRandomHandLimit')).toHaveValue('10');await expect(guest.locator('#onlineRandomHandLimit')).toBeDisabled();
  await guest.evaluate(()=>onlineSend({type:'setHandLimit',handLimit:99}));await expect(guest.locator('#onlineStatusText')).toContainText('ホストだけ');expect(await host.evaluate(()=>state.online.handLimit)).toBe(10);
  await host.locator('#onlineRandomHandLimit').fill('1000000');await host.locator('#onlineRandomHandLimit').press('Tab');await expect(guest.locator('#onlineRandomHandLimit')).toHaveValue('1000000');
  await host.locator('#onlineRandomHandLimit').fill('8');await host.locator('#onlineRandomHandLimit').press('Tab');await expect(host.locator('#onlineRandomHandLimit')).toHaveValue('9');await expect(guest.locator('#onlineRandomHandLimit')).toHaveValue('9');
  for(const p of [host,guest]){await p.evaluate(()=>{state.deckBuilder.counts.player=createAutoDeckCounts();document.getElementById('onlineDeckSelect').dispatchEvent(new Event('change',{bubbles:true}));});await p.locator('#onlineReadyButton').click();}
  await expect.poll(()=>host.evaluate(()=>state.online.remoteReady)).toBe(true);
  await host.locator('#onlineRandomHandLimit').fill('');await host.locator('#onlineRandomHandLimit').press('Tab');await expect(guest.locator('#onlineRandomHandLimit')).toHaveValue('');
  for(const p of [host,guest])await expect.poll(()=>p.evaluate(()=>[state.online.localReady,state.online.remoteReady])).toEqual([false,false]);
  await host.locator('#onlineRandomHandLimitPlus').click();await expect(guest.locator('#onlineRandomHandLimit')).toHaveValue('9');
  await host.locator('#onlineRandomHandLimitPlus').click();await expect(guest.locator('#onlineRandomHandLimit')).toHaveValue('10');await host.locator('#onlineRandomHandLimitMinus').click();await expect(guest.locator('#onlineRandomHandLimit')).toHaveValue('9');
  if(startLimit===null){await host.locator('#onlineRandomHandLimit').fill('');await host.locator('#onlineRandomHandLimit').press('Tab');await expect(guest.locator('#onlineRandomHandLimit')).toHaveValue('');}
  for(const p of [host,guest])await p.locator('#onlineReadyButton').click();await expect.poll(()=>host.evaluate(()=>state.online.remoteReady)).toBe(true);await host.locator('#onlineStartButton').click();await expect.poll(()=>guest.evaluate(()=>state.online.started)).toBe(true);
  for(const p of [host,guest])expect(await p.evaluate(()=>state.battleHandLimit)).toBe(startLimit);
  await host.evaluate(()=>onlineSend({type:'setHandLimit',handLimit:30}));
  await expect(host.locator('#onlineStatusText')).toContainText('対戦開始後');
  await expect.poll(()=>guest.evaluate(()=>state.battleHandLimit)).toBe(startLimit);
  await host.evaluate(()=>{state.preBattleToken+=1;state.preBattleBusy=false;state.phase='battle';state.firstSide='player';state.currentSide='player';state.training.skipAnimations=true;for(const side of ['player','opponent']){const p=state.players[side];p.hand=Array.from({length:8},()=>createCardFromBase('ruler',side));p.deck=Array.from({length:3},()=>createCardFromBase('general_student',side));p.trash=[];drawCards(side,3,false);}onlineBroadcastState(true);});
  for(const p of [host,guest])await expect.poll(()=>p.evaluate(()=>['player','opponent'].map(side=>[state.players[side].hand.length,state.players[side].trash.length]))).toEqual([[startLimit===null?11:9,startLimit===null?0:2],[startLimit===null?11:9,startLimit===null?0:2]]);
 }finally{await Promise.all(contexts.map(c=>c.close()));}
});

test('ランダムマッチはルールと準備OKの間に設定を表示する',async({browser})=>{
 const contexts=await Promise.all([browser.newContext({viewport:{width:1440,height:900}}),browser.newContext()]);const pages=await Promise.all(contexts.map(c=>c.newPage()));
 try{
  for(const page of pages){await page.goto(url.href);await page.locator('#homeNavBattleButton').click();await page.locator('#onlineRandomMatchButton').click();}
  for(const page of pages)await expect.poll(()=>page.evaluate(()=>state.online.connected)).toBe(true);
  const host=(await pages[0].evaluate(()=>state.online.role))==='host'?pages[0]:pages[1];
  await expect(host.locator('#onlineRandomHandLimit')).toBeVisible();await expect(host.locator('#onlineRandomHandLimit')).toBeEnabled();
  await host.locator('#onlineRandomHandLimitPlus').click();
  for(const page of pages)await expect(page.locator('#onlineRandomHandLimit')).toHaveValue('10');
  const [rule,input,ready]=await Promise.all(['#onlineRandomRuleDescription','#onlineRandomHandLimit','#onlineRandomReadyButton'].map(x=>host.locator(x).boundingBox()));
  expect(input.y).toBeGreaterThanOrEqual(rule.y+rule.height);expect(input.y+input.height).toBeLessThan(ready.y);
  await host.screenshot({path:'/tmp/chibatoru-hand-limit-lobby.png'});
 }finally{await Promise.all(contexts.map(c=>c.close()));}
});
test('手札上限中でも持ち物の使用で空いた枠に引ける',async({page})=>{
 await unit(page);
 expect(await page.evaluate(()=>{const p=state.players.player,item=createCardFromBase('onigiri_draw','player');p.hand=[item,...Array.from({length:8},()=>createCardFromBase('ruler','player'))];p.deck=['general_student','ruler','ruler'].map(id=>createCardFromBase(id,'player'));castImmediateItem('player',item,false);return [p.hand.length,p.hand.some(c=>c.baseId==='onigiri_draw'),p.hand.some(c=>c.baseId==='general_student')];})).toEqual([9,false,true]);
});
