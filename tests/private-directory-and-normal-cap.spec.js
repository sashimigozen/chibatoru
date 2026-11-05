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
  for (const page of [host, guest]) {
    await page.evaluate(() => {
      state.deckBuilder.savedDecks["ルーム用テストデッキ"] = { counts: createAutoDeckCounts() };
      state.deckBuilder.savedDecks["調整中のデッキ"] = { counts: { general_student: 1 } };
      state.deckBuilder.savedDecks["Test Deck 02"] = { counts: { general_student: 2 } };
      render();
    });
    const picker = page.locator("#onlineDeckPicker");
    const opener = page.locator("#onlineDeckPickerButton");
    await opener.click();
    await expect(page.locator(".computer-content #onlineDeckPicker")).toBeVisible();
    await expect(page.locator("#deckScreen")).toBeHidden();
    await expect(picker.getByRole("button", { name: /調整中のデッキ/ })).toBeDisabled();
    const search = picker.getByRole("searchbox", { name: "デッキ名" });
    const tiles = picker.locator("[data-match-deck]");
    await picker.getByRole("combobox", { name: "並び替え" }).selectOption("size");
    await picker.getByRole("combobox", { name: "順序" }).selectOption("asc");
    await expect(tiles.nth(1)).toContainText("調整中のデッキ");
    await picker.getByRole("combobox", { name: "順序" }).selectOption("desc");
    await expect(tiles.last()).toContainText("調整中のデッキ");
    await search.fill(" ｔｅｓｔ ");
    await expect(tiles).toHaveCount(1);
    await expect(tiles.first()).toContainText("Test Deck 02");
    await search.fill("該当なし");
    await expect(picker.getByRole("status")).toHaveText("一致するデッキがありません。");
    await page.locator("#onlineDeckPickerBackButton").click();
    await expect(opener).toBeFocused();
    await expect(page.locator("#onlineRandomLocalDeckName")).toHaveText("現在の通常デッキ");
    await opener.click();
    await expect(search).toHaveValue("");
    await page.evaluate(() => {
      for (let i = 1; i <= 12; i++) {
        state.deckBuilder.savedDecks[`ページ送り用 ${i}`] = { counts: { general_student: 3 } };
      }
      render();
    });
    const previous = picker.getByRole("button", { name: "前のデッキページ" });
    const next = picker.getByRole("button", { name: "次のデッキページ" });
    const pageNumber = page.locator("#onlineDeckPickerPageLabel");
    await expect(tiles).toHaveCount(12);
    await expect(pageNumber).toHaveText("— Page 1 / 2 —");
    await next.click();
    await expect(pageNumber).toHaveText("— Page 2 / 2 —");
    await expect(tiles.first()).toContainText("ページ送り用");
    await expect(tiles.last()).toContainText("調整中のデッキ");
    await previous.click();
    await expect(pageNumber).toHaveText("— Page 1 / 2 —");
    await previous.click();
    await expect(pageNumber).toHaveText("— Page 2 / 2 —");
    await search.fill("ルーム用");
    await expect(pageNumber).toHaveText("— Page 1 / 1 —");
    await expect(next).toBeDisabled();
    await picker.getByRole("button", { name: /ルーム用テストデッキ/ }).click();
    await expect(picker).toBeHidden();
    await expect(page.locator("#onlineRandomRoomCode")).toHaveText(code);
    await expect(page.locator("#onlineRandomLocalDeckName")).toHaveText("ルーム用テストデッキ");
    await expect(page.locator("#onlineRandomHandLimit")).toHaveValue("10");
    await page.locator("#onlineRandomDeckConfirmButton").click();
    await expect(page.locator("#onlineRandomDeckPreviewContent")).toContainText("ルーム用テストデッキ");
    await expect(page.locator("#onlineRandomDeckPreviewContent [data-library-card]").first()).toBeVisible();
    await page.locator("#onlineRandomDeckPreviewCloseButton").click();
    await page.locator("#onlineReadyButton").click();
  }
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
