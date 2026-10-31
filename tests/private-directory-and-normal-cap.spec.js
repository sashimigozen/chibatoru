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

test('部屋一覧から入室し、新しい準備画面で同期して対戦を開始する',async({browser})=>{
 test.setTimeout(60000);const contexts=await Promise.all([browser.newContext({viewport:{width:1440,height:900}}),browser.newContext({viewport:{width:1440,height:900}}),browser.newContext()]);const[host,guest,observer]=await Promise.all(contexts.map(c=>c.newPage()));
 try{
  await open(host);await host.evaluate(()=>{state.profile.username='ホストA';render();});await expect(host.locator('#onlinePrivateRoomList')).toBeVisible();
  await host.locator('#onlineCreateRoomButton').click();await expect(host.locator('#onlineRandomSetupPanel')).toBeVisible();await expect(host.locator('#onlinePrivatePanel')).toBeHidden();
  await expect.poll(()=>host.evaluate(()=>state.online.lastSeenAt>0)).toBe(true);const code=await host.evaluate(()=>state.online.roomCode);
  await open(guest);await guest.locator('#onlinePrivateRefreshButton').click();await expect(guest.locator('#onlinePrivateRoomList')).toContainText('ホストAの部屋');
  await guest.screenshot({path:'/tmp/private-room-directory-final.png'});
  await guest.locator(`[data-private-join-room="${code}"]`).click();for(const p of [host,guest])await expect.poll(()=>p.evaluate(()=>state.online.connected)).toBe(true);
  await open(observer);await observer.locator('#onlinePrivateRefreshButton').click();await expect(observer.locator(`[data-private-join-room="${code}"]`)).toBeDisabled();
  await expect(host.locator('#onlineRandomHandLimit')).toBeVisible();await expect(guest.locator('#onlineRandomHandLimit')).toBeDisabled();
  await host.locator('#onlineRandomHandLimitPlus').click();await expect(guest.locator('#onlineRandomHandLimit')).toHaveValue('10');
  await host.screenshot({path:'/tmp/private-room-prep-final.png'});
  await guest.locator('#onlineRandomBackButton').click();await expect(guest.locator('#onlinePrivateRoomList')).toBeVisible();await guest.locator('#onlinePrivateRefreshButton').click();await expect(guest.locator(`[data-private-join-room="${code}"]`)).toBeEnabled();
  await guest.locator('.private-code-entry > summary').click();await guest.locator('#onlineRoomInput').fill(code);await guest.locator('#onlineJoinRoomButton').click();await expect.poll(()=>guest.evaluate(()=>state.online.connected)).toBe(true);
  for(const p of [host,guest]){await p.evaluate(()=>{state.deckBuilder.counts.player=createAutoDeckCounts();elements.onlineRandomDeckSelect.dispatchEvent(new Event('change',{bubbles:true}));});await p.locator('#onlineReadyButton').click();}
  await expect.poll(()=>host.evaluate(()=>state.online.remoteReady)).toBe(true);await host.locator('#onlineStartButton').click();await expect.poll(()=>guest.evaluate(()=>state.online.started)).toBe(true);
  expect(await guest.evaluate(()=>state.battleHandLimit)).toBe(10);
  await observer.locator('#onlinePrivateRefreshButton').click();await expect(observer.locator(`[data-private-join-room="${code}"]`)).toHaveCount(0);
 }finally{await Promise.all(contexts.map(c=>c.close()));}
});
for(const mode of ['training','aiBattle'])for(const limit of [9,null,15])test(`通常ルールの準備設定を対戦へ適用 ${mode}/${limit}`,async({page})=>{
 await page.goto(url.href);await page.evaluate(()=>{state.deckBuilder.savedDecks['テストデッキ']={counts:{...ChibattleAiBattleDecks[0].counts}};});
 await page.locator('#homeNavSoloButton').click();await page.locator(mode==='aiBattle'?'#soloAiBattleButton':'#soloTrainingButton').click();
 await expect(page.locator('#soloHandLimit')).toHaveValue('9');await page.locator('#soloHandLimit').fill(limit===null?'':String(limit));await page.locator('#soloHandLimit').press('Tab');
 await page.locator('#soloPlayerSlot').click();await page.locator('#soloDeckGrid button',{hasText:'テストデッキ'}).click();
 if(mode==='training'){await page.locator('#soloAiSlot').click();await page.locator('#soloDeckGrid button',{hasText:'テストデッキ'}).click();}
 await page.screenshot({path:`/tmp/${mode}-hand-limit-final.png`});
 await page.locator('#soloBattleStartButton').click();await expect(page.locator('#battleScreen')).toBeVisible();expect(await page.evaluate(()=>state.battleHandLimit)).toBe(limit);
});
for(const rule of ['normal','chaos','specialty'])test(`手札上限は通常ルールだけに適用 ${rule}`,async({page})=>{
 await page.goto(url.href);expect(await page.evaluate(rule=>{initializeGame({ruleId:rule,handLimit:12});return state.battleHandLimit;},rule)).toBe(rule==='normal'?12:null);
});
