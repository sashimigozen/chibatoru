const { test, expect } = require('@playwright/test');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const url = pathToFileURL(path.join(__dirname, '..', 'index.html')).href;

async function start(page, id) {
  await page.goto(url);
  await page.evaluate(id => {
    startCardTest(id); scheduleOpponentAI = () => {}; state.training.skipAnimations = true;
  }, id);
  await expect.poll(() => page.evaluate(() => battlePresentationBusy())).toBe(false);
}
async function inViewport(locator, size) {
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  expect(box.x).toBeGreaterThanOrEqual(0); expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(size.width + 1);
  expect(box.y + box.height).toBeLessThanOrEqual(size.height + 1);
}

for (const size of [{width:1440,height:900}, {width:1330,height:834}, {width:390,height:844}, {width:844,height:390}]) {
  test(`デッキ45枚の先頭と末尾をスクロールして選び、画面内のボタンで確定できる ${size.width}`, async ({ page }) => {
    await page.setViewportSize(size); await start(page, 'dropped_cards');
    await page.evaluate(() => beginItemUse(state.players.player.hand.find(c => c.baseId === 'dropped_cards')));
    const hand = page.locator('#threeGesturesHand'), cards = hand.locator('button.card');
    const confirm = page.locator('#threeGesturesConfirmButton');
    await expect(cards).toHaveCount(45);
    for (const selector of ['#threeGesturesTitle', '#threeGesturesMessage', '#threeGesturesHand', '#threeGesturesConfirmButton']) {
      await inViewport(page.locator(selector), size);
    }
    expect(await page.locator('#threeGesturesStage .mulligan-window').evaluate(e => e.scrollWidth <= e.clientWidth + 1)).toBe(true);
    expect(await hand.evaluate(e => e.scrollWidth > e.clientWidth)).toBe(true);
    await cards.first().click();
    await hand.hover(); await page.mouse.wheel(0, 20000);
    await expect.poll(() => hand.evaluate(e => e.scrollLeft)).toBeGreaterThan(100);
    await expect(cards.last()).toBeInViewport();
    await cards.last().click();
    await expect(confirm).toBeEnabled(); await inViewport(confirm, size);
    await expect(cards.last()).toHaveAttribute('aria-pressed', 'true');
    await expect(cards.last()).toBeInViewport();
    const selected = await page.evaluate(() => [...state.pendingCardChoice.selectedIds]);
    await page.screenshot({ path: test.info().outputPath(`deck-choice-${size.width}.png`) });
    await confirm.click();
    await expect.poll(() => page.evaluate(() => state.pendingCardChoice)).toBeNull();
    expect(await page.evaluate(ids => ids.every(id => state.players.player.trash.some(c => c.instanceId === id)), selected)).toBe(true);
    expect(await page.evaluate(() => state.players.player.deck.length)).toBe(43);
  });
}

test('賢者の遺産で手札選択からデッキ全体の選択へ進み、末尾のカードを手札に加えられる', async ({ page }) => {
  await page.setViewportSize({width:1330,height:834}); await start(page, 'sage_legacy');
  await page.evaluate(() => {
    state.firstSide = 'opponent'; state.players.player.turnsTaken = 1;
    beginItemUse(state.players.player.hand.find(c => c.baseId === 'sage_legacy'));
  });
  await expect.poll(() => page.evaluate(() => state.pendingCardChoice?.mode)).toBe('sage_legacy_return');
  await page.locator('#threeGesturesHand .card').first().click();
  await page.locator('#threeGesturesConfirmButton').click();
  await expect.poll(() => page.evaluate(() => state.pendingCardChoice?.mode)).toBe('sage_legacy');
  const last = page.locator('#threeGesturesHand .card').last();
  const id = await last.getAttribute('data-card-id');
  await page.locator('#threeGesturesHand').hover(); await page.mouse.wheel(0, 20000);
  await expect(last).toBeInViewport(); await last.click();
  await page.locator('#threeGesturesStage [data-selection-peek]').click();
  await expect(page.locator('#threeGesturesStage')).toBeHidden();
  await page.locator('#selectionPeekReturnButton').click();
  await expect.poll(() => page.evaluate(() => state.pendingCardChoice.selectedIds)).toEqual([id]);
  await inViewport(page.locator('#threeGesturesConfirmButton'), {width:1330,height:834});
  await page.locator('#threeGesturesConfirmButton').click();
  await expect.poll(() => page.evaluate(id => state.players.player.hand.some(c => c.instanceId === id), id)).toBe(true);
});

test('効果のモード選択からデッキのカード選択へ切り替わっても確定できる', async ({ page }) => {
  await page.setViewportSize({width:1440,height:900}); await start(page, 'amphisbaena_sofa');
  await page.evaluate(() => { state.players.player.will = 4; beginItemUse(state.players.player.hand.find(c => c.baseId === 'amphisbaena_sofa')); });
  await expect(page.locator('.effect-mode-option')).toHaveCount(2);
  await page.locator('.effect-mode-option').nth(1).click();
  await expect.poll(() => page.evaluate(() => state.pendingCardChoice?.context?.kind)).toBe('sofa_deck');
  await expect(page.locator('#threeGesturesStage')).not.toHaveClass(/effect-mode-choice/);
  const cards = page.locator('#threeGesturesHand .card');
  await expect.poll(() => cards.count()).toBeGreaterThan(10);
  await expect.poll(() => page.evaluate(() => battlePresentationBusy({ignoreFusionTasks:true}))).toBe(false);
  await cards.first().click(); await page.locator('#threeGesturesHand').hover(); await page.mouse.wheel(0,20000);
  await expect(cards.last()).toBeInViewport(); await cards.last().click();
  await inViewport(page.locator('#threeGesturesConfirmButton'), {width:1440,height:900});
  await page.locator('#threeGesturesConfirmButton').click();
  await expect.poll(() => page.evaluate(() => fusionTasksBusy())).toBe(false);
});

test('オンラインのホストとゲストが60枚の一覧から末尾を選び、確定結果を同期できる', async ({ browser }) => {
  test.setTimeout(90000);
  const net = require('node:net'), { spawn } = require('node:child_process');
  const port = await new Promise(resolve => {
    const probe = net.createServer(); probe.listen(0, '127.0.0.1', () => {
      const port = probe.address().port; probe.close(() => resolve(port));
    });
  });
  const server = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'server.js')], {
    env: {...process.env, PORT:String(port)}, stdio:['ignore','pipe','pipe']
  });
  const contexts = await Promise.all([browser.newContext({viewport:{width:1330,height:834}}), browser.newContext({viewport:{width:390,height:844}})]);
  const [host, guest] = await Promise.all(contexts.map(c => c.newPage()));
  const errors=[];
  try {
    await new Promise((resolve,reject) => {
      const timer=setTimeout(() => reject(Error('server startup timeout')),5000);
      server.stdout.on('data', chunk => {if(String(chunk).includes('listening')){clearTimeout(timer);resolve();}});
      server.once('error',reject);
    });
    for(const p of [host,guest]){
      p.on('pageerror',e=>errors.push(e.message));
      await p.goto(`${url}?ws=ws://127.0.0.1:${port}`);
      await p.locator('#homeNavBattleButton').click(); await p.locator('#onlinePrivateMatchButton').click();
    }
    await host.locator('#onlineCreateRoomButton').click();
    await expect.poll(()=>host.evaluate(()=>state.online.role)).toBe('host');
    await guest.locator('.private-code-entry > summary').click();
    await guest.locator('#onlineRoomInput').fill(await host.evaluate(()=>state.online.roomCode));
    await guest.locator('#onlineJoinRoomButton').click();
    for(const p of [host,guest]){
      await expect.poll(()=>p.evaluate(()=>state.online.connected)).toBe(true);
      await p.evaluate(()=>{state.deckBuilder.counts.player=createAutoDeckCounts();document.getElementById('onlineDeckSelect').dispatchEvent(new Event('change',{bubbles:true}));});
      await p.locator('#onlineReadyButton').click();
    }
    await expect.poll(()=>host.evaluate(()=>state.online.remoteReady)).toBe(true);
    await host.locator('#onlineStartButton').click();
    await expect.poll(()=>guest.evaluate(()=>state.online.started)).toBe(true);
    for(const side of ['player','opponent']){
      const setup=await host.evaluate(side=>{
        startCardTest('dropped_cards');state.testMode=false;state.training.skipAnimations=true;state.currentSide=side;state.environment=null;
        for(const owner of ['player','opponent'])Object.assign(state.players[owner],{board:{teacher:null,seats:Array(9).fill(null)},hand:[],deck:[],trash:[],late:[],life:20,will:10,maxWill:10});
        const own=state.players[side],item=createCardFromBase('dropped_cards',side);
        own.hand=[item];own.deck=Array.from({length:60},(_,i)=>createCardFromBase(i%2?'general_student':'onigiri_draw',side));
        render();return {id:item.instanceId,seq:state.online.lastSnapshotSeq};
      },side);
      await expect.poll(()=>guest.evaluate(()=>state.online.lastSnapshotSeq)).toBeGreaterThanOrEqual(setup.seq);
      const actor=side==='player'?host:guest;
      await expect.poll(()=>actor.evaluate(()=>battlePresentationBusy())).toBe(false);
      await actor.evaluate(id=>beginItemUse(state.players.player.hand.find(c=>c.instanceId===id)),setup.id);
      const cards=actor.locator('#threeGesturesHand .card');await expect(cards).toHaveCount(60);
      await cards.first().click();await actor.locator('#threeGesturesHand').hover();await actor.mouse.wheel(0,20000);
      await expect(cards.last()).toBeInViewport();await cards.last().click();
      await inViewport(actor.locator('#threeGesturesConfirmButton'),actor.viewportSize());
      await actor.locator('#threeGesturesConfirmButton').click();
      for(const p of [host,guest]){
        const owner=p===host?side:side==='player'?'opponent':'player';
        await expect.poll(()=>p.evaluate(owner=>[state.players[owner].deck.length,state.players[owner].trash.length],owner)).toEqual([58,3]);
      }
    }
    expect(errors).toEqual([]);
  } finally {await Promise.all(contexts.map(c=>c.close()));server.kill('SIGTERM');}
});
