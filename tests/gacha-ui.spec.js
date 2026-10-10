const { test, expect } = require('@playwright/test');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const C = require('../gacha-core.js');
const url = pathToFileURL(path.join(__dirname, '..', 'index.html')).href;
const styleKey = 'chibattle-dungeon-card-styles-v1';
async function boot(page, economy = C.initial(), style = null) {
  await page.setViewportSize({width:1440,height:900});
  await page.addInitScript(({key,economy,style,styleKey}) => {
    if (sessionStorage.getItem('gacha-test-ready')) return;
    localStorage.clear(); localStorage.setItem(key,JSON.stringify(economy));
    if (style) localStorage.setItem(styleKey,JSON.stringify(style));
    sessionStorage.setItem('gacha-test-ready','yes');
  },{key:C.KEY,economy,style,styleKey});
  await page.goto(url);
  await expect(page.locator('#homeNavGachaButton')).toBeEnabled();
}
const saved = page => page.evaluate(key=>JSON.parse(localStorage.getItem(key)),C.KEY);
test('personal gift import preserves saves and cannot award CP twice', async ({page}) => {
  const s=C.initial();s.cp=75;s.owned.general_student={rare:true};
  await boot(page,s,{unlocked:{},selected:{general_student:'rare'},cardUnlocks:{general_student:{rare:true}}});
  const gift={name:'personal.chibagift',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({format:'chibattle-personal-gift',version:1,id:'personal-cp:2026-10-10',amount:1000000}))};
  for (let i=0;i<2;i++) {
    await page.locator('#homeProfileButton').click();
    await page.locator('#profileDataButton').click();
    await page.locator('#gachaBackupInput').setInputFiles(gift);
    await expect(page.locator('#gachaBackupConfirm')).toContainText('プレゼントボックス');
    await page.locator('[data-gacha-close]').click();
    await page.locator('#profileCloseButton').click();
    await page.locator('#homeGiftsButton').click();
    if (!i) await page.locator('[data-gacha-claim="personal-cp:2026-10-10"]').click();
    else await expect(page.locator('[data-gacha-claim="personal-cp:2026-10-10"]')).toHaveCount(0);
    await page.locator('[data-gacha-close]').click();
    await page.reload();
    expect((await saved(page)).cp).toBe(1000075);
    expect((await saved(page)).owned).toEqual(s.owned);
    expect(await page.evaluate(key=>JSON.parse(localStorage.getItem(key)).selected.general_student,styleKey)).toBe('rare');
  }
});
test('TV pickup cycles all pack URs every five seconds without changing saves', async ({page}) => {
  await boot(page);
  await page.clock.install();
  await page.clock.pauseAt(new Date(Date.now() + 1000));
  await page.locator('#homeNavGachaButton').click();
  await expect(page.locator('.gacha-featured h2')).toHaveText('PICK UP');
  await expect(page.locator('.gacha-featured-cards [data-gacha-detail="aggro_student"]')).toHaveCount(1);
  await expect(page.locator('.gacha-featured-cards [data-gacha-detail="general_student"]')).toHaveCount(0);
  await expect(page.locator('.gacha-purchase-panel')).not.toContainText('SR保証');
  await expect(page.locator('.gacha-purchase-panel')).toContainText('UR交換 0 / 200');
  const before = await saved(page);
  const ids = () => page.locator('.gacha-featured-cards button').evaluateAll(nodes=>nodes.map(n=>n.dataset.gachaDetail));
  for (const pack of C.PACKS) {
    const pages = await page.evaluate(ur => [ur.filter(id=>CARD_BASES[id].type==='student'),ur.filter(id=>CARD_BASES[id].type!=='student')],pack.ur);
    await page.locator(`[data-gacha-pack="${pack.id}"]`).click();
    expect(await ids()).toEqual(pages[0]);
    const fits = () => page.locator('.gacha-featured-cards').evaluate(el=>{
      const box=el.getBoundingClientRect();
      return [...el.querySelectorAll('button')].every(b=>{
        const r=b.getBoundingClientRect();
        return r.width>0 && r.height>0 && r.left>=box.left-1 && r.right<=box.right+1 && r.top>=box.top-1 && r.bottom<=box.bottom+1;
      });
    });
    expect(await fits()).toBe(true);
    await page.clock.runFor(4999);
    expect(await ids()).toEqual(pages[0]);
    if (pack.id === 'cynical') {
      const boxes = await page.locator('.gacha-featured-cards button').evaluateAll(nodes=>nodes.map(n=>{
        const r=n.getBoundingClientRect();return {top:r.top,width:r.width};
      }));
      expect(boxes).toHaveLength(5);
      expect(new Set(boxes.map(r=>Math.round(r.top))).size).toBe(1);
      expect(boxes.every(r=>r.width>140)).toBe(true);
      await page.screenshot({path:test.info().outputPath('students-page.png')});
    }
    await page.clock.runFor(1);
    expect(await ids()).toEqual(pages[1]);
    expect(await fits()).toBe(true);
    await page.clock.runFor(5000);
    expect(await ids()).toEqual(pages[0]);
  }
  await page.locator('[data-gacha-rates]').click();
  await expect(page.locator('.gacha-dialog tbody th')).toHaveText(['レギュラー','R','SR','UR']);
  expect(await page.evaluate(()=>['rare','superRare','ultraRare'].map(cardStyleModeLabel))).toEqual(['R','SR','UR']);
  await expect(page.locator('script[src^="gacha-ui.js"]')).toHaveAttribute('src','gacha-ui.js?v=0.23.18-shop-11');
  const paused = await ids();
  await page.clock.runFor(10000);
  expect(await ids()).toEqual(paused);
  await page.locator('[data-gacha-close]').click();
  await page.clock.runFor(5000);
  expect(await ids()).not.toEqual(paused);
  await page.locator('#homeNavHomeButton').click();
  await page.clock.runFor(10000);
  await page.locator('#homeNavGachaButton').click();
  const resumed = await ids();
  await page.clock.runFor(4999);
  expect(await ids()).toEqual(resumed);
  expect(await saved(page)).toEqual(before);
  await page.screenshot({path:test.info().outputPath('pickup-tv.png')});
});
test('initial 50CP is a gift, not direct credit, and cannot be claimed twice', async ({page}) => {
  await boot(page);
  await page.locator('#homeGiftsButton').click();
  expect((await saved(page)).cp).toBe(0);
  await expect(page.locator('.gacha-gifts')).toContainText('初期CPプレゼント');
  await page.locator('[data-gacha-claim="initial-cp"]').click();
  await expect.poll(async()=>(await saved(page)).cp).toBe(50);
  await page.reload(); await page.locator('#homeGiftsButton').click();
  await expect(page.locator('.gacha-dialog')).toContainText('プレゼントはありません');
  expect((await saved(page)).cp).toBe(50);
});
test('normal UR reveal resumes; skip completes the whole batch without changing awards or selection', async ({page}) => {
  const errors=[]; page.on('pageerror',e=>errors.push(e.message));
  let s = C.initial(); s.cp=10;
  s = C.purchase(s,'cynical',1,()=>.99999,'fixed-ur');
  await boot(page,s,{unlocked:{},cardUnlocks:{general_student:{rare:true}},selected:{general_student:'rare'}});
  await page.locator('#homeNavGachaButton').click();
  await expect(page.locator('[data-gacha-receive]')).toBeVisible();
  const before = await saved(page);
  await page.locator('[data-gacha-receive]').click();
  await page.locator('[data-gacha-tear]').focus();await page.keyboard.press('Enter');
  await page.locator('[data-gacha-reveal="0"]').click();
  await expect(page.locator('.gacha-ur-moment')).toBeVisible();
  expect((await saved(page)).pending.revealed).toBe(1);
  await page.reload(); await page.locator('#homeNavGachaButton').click();
  await expect(page.locator('.gacha-ur-moment')).toBeVisible();
  expect((await saved(page)).cp).toBe(before.cp);
  const selected = await page.evaluate(key=>JSON.parse(localStorage.getItem(key)).selected.general_student,styleKey);
  expect(selected).toBe('rare');
  await page.locator('[data-gacha-skip]').click();
  await expect(page.locator('.gacha-summary-grid .rarity-ultra-rare')).toHaveCount(5);
  expect((await saved(page)).pending.results).toEqual(before.pending.results);
  expect((await saved(page)).cp).toBe(before.cp);
  await page.locator('[data-gacha-finish]').click();
  await page.locator('[data-gacha-buy="1"]').click();
  await page.locator('[data-gacha-receive]').click();
  const line = await page.locator('[data-gacha-tear]').boundingBox();
  await page.mouse.move(line.x+10,line.y+15); await page.mouse.down();
  await page.mouse.move(line.x+line.width-10,line.y+15,{steps:10}); await page.mouse.up();
  await expect(page.locator('.gacha-counter-cards')).toBeVisible();
  await page.screenshot({path:test.info().outputPath('counter-cards.png')});
  expect(errors).toEqual([]);
});
test('legacy gifts are received once and grant 150CP per specialty; shop layout fits', async ({page}) => {
  const economy=C.initial();
  economy.gifts['dungeon:king_ghidorah_bed:5']={amount:50,label:'キングギドラベッド・5階 初回クリア',claimed:false};
  await boot(page,economy,{unlocked:{design:true,king_ghidorah_bed:true},selected:{},prismUnlocked:{king_ghidorah_bed:true}});
  await page.locator('#homeGiftsButton').click();
  await expect(page.locator('[data-gacha-claim]')).toHaveCount(4);
  await expect(page.locator('.gacha-dialog')).not.toContainText('キングギドラベッド');
  await page.locator('[data-gacha-claim="all"]').click();
  await expect.poll(async()=>(await saved(page)).cp).toBe(200);
  await page.locator('[data-gacha-close]').click();
  await page.reload(); await page.locator('#homeGiftsButton').click();
  await expect(page.locator('.gacha-dialog')).toContainText('プレゼントはありません');
  await page.locator('[data-gacha-close]').click();
  await page.locator('#homeNavGachaButton').click();
  await expect(page.locator('#homeNavGachaButton')).toHaveText('ショップ');
  expect(await page.locator('.gacha-table-set .table').first().evaluate(el=>getComputedStyle(el).backgroundColor)).toBe('rgb(185, 155, 123)');
  await page.screenshot({path:test.info().outputPath('shop-1440.png')});
  await page.setViewportSize({width:1280,height:800});
  await page.screenshot({path:test.info().outputPath('shop-1280.png')});
  const layout = await page.locator('#gachaScreen').evaluate(el=>({overflow:el.scrollHeight>el.clientHeight,hidden:el.classList.contains('hidden')}));
  expect(layout).toEqual({overflow:false,hidden:false});
});
test('mandatory UR exchange blocks purchases and survives closing the dialog', async ({page}) => {
  const s=C.initial(); s.cp=100; s.packs.echoes.total=200; s.packs.echoes.tickets=1;
  await boot(page,s); await page.locator('#homeNavGachaButton').click();
  await expect(page.locator('[data-gacha-buy="1"]')).toBeDisabled();
  await page.locator('[data-gacha-exchange]').click();
  await page.locator('[data-gacha-close]').click();
  await page.locator('[data-gacha-exchange]').click();
  await page.locator('[data-gacha-redeem="triple_enemy"]').click();
  await expect(page.locator('[data-gacha-buy="1"]')).toBeEnabled();
  expect((await saved(page)).owned.triple_enemy).toEqual({ultraRare:true});
});
test('AI wins pay once, losses/training/tutorial excluded and dungeon milestones distinct', async ({page}) => {
  await boot(page);
  await page.evaluate(() => {
    const s=window.__chibattle.state;
    s.screen='battle';s.analytics.game={gameId:'reward-test',mode:'solo'};
    window.ChibattleGacha.recordBattleResult('opponent');
    s.training.active=true;window.ChibattleGacha.recordBattleResult('player');s.training.active=false;
    s.tutorial.active=true;window.ChibattleGacha.recordBattleResult('player');s.tutorial.active=false;
    window.ChibattleGacha.recordBattleResult('player');window.ChibattleGacha.recordBattleResult('player');
  });
  await expect.poll(async()=>(await saved(page)).cp).toBe(5);
  await page.evaluate(() => { const s=window.__chibattle.state;s.dungeon.active=true;s.dungeon.run={specialtyId:'design',floor:5};window.ChibattleGacha.recordBattleResult('player'); });
  await expect.poll(async()=>(await saved(page)).cp).toBe(55);
  await page.evaluate(() => { window.__chibattle.state.dungeon.run.floor=10;window.ChibattleGacha.recordBattleResult('player'); });
  await expect.poll(async()=>(await saved(page)).cp).toBe(155);
});
test('backup roundtrip keeps CP, owned, selected, decks; repeated import replaces, not adds', async ({page}) => {
  const s=C.initial();s.cp=75;s.owned.general_student={rare:true};
  await boot(page,s,{unlocked:{},selected:{general_student:'rare'},cardUnlocks:{general_student:{rare:true}}});
  await page.locator('#homeProfileButton').click();await page.locator('#profileDataButton').click();
  const downloadPromise=page.waitForEvent('download');await page.locator('[data-gacha-export]').click();
  const download=await downloadPromise; const backup=await download.path();
  await page.locator('#gachaBackupInput').setInputFiles(backup);
  await expect(page.locator('[data-gacha-restore]')).toBeVisible();
  await page.locator('[data-gacha-restore]').click();await page.waitForLoadState('load');
  expect((await saved(page)).cp).toBe(75);
  expect((await saved(page)).owned.general_student.rare).toBe(true);
  const settings=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)),styleKey);expect(settings.selected.general_student).toBe('rare');
  await page.locator('#homeProfileButton').click();await page.locator('#profileDataButton').click();
  await page.locator('#gachaBackupInput').setInputFiles(backup);await page.locator('[data-gacha-restore]').click();
  await page.waitForLoadState('load');expect((await saved(page)).cp).toBe(75);
});
test('cut strip separates before cards appear', async ({page}) => {
  let s=C.initial();s.cp=5;s=C.purchase(s,'endless',1,()=>0,'cut-animation');
  await boot(page,s);await page.locator('#homeNavGachaButton').click();
  await page.locator('[data-gacha-receive]').click();
  await page.locator('[data-gacha-tear]').focus();await page.keyboard.press('Enter');
  await expect(page.locator('.gacha-cut-strip')).toHaveCount(1);
  await expect(page.locator('[data-gacha-tear]')).toBeHidden();
  await page.locator('.gacha-cut-strip').evaluate(el => {
    const animation = el.getAnimations()[0];animation.pause();animation.currentTime = 250;
  });
  await page.screenshot({path:test.info().outputPath('cut-strip.png')});
  await page.locator('.gacha-cut-strip').evaluate(el => el.getAnimations()[0].play());
  await expect(page.locator('[data-gacha-reveal]')).toHaveCount(5);
  await expect(page.locator('.gacha-cut-strip')).toHaveCount(0);
  expect((await saved(page)).pending.revealed).toBe(0);
});
test('tear accepts a held pointer approaching from outside the pack, in both directions', async ({page}) => {
  let s=C.initial();s.cp=50;s=C.purchase(s,'endless',10,()=>0,'tear-wide');
  await boot(page,s);await page.locator('#homeNavGachaButton').click();
  await page.locator('[data-gacha-receive]').click();
  for (const direction of [1,-1]) {
    const r=await page.locator('[data-gacha-tear]').boundingBox();
    const y=r.y+r.height/2;
    const start=direction===1?r.x-100:r.x+r.width+100;
    const entry=direction===1?r.x-50:r.x+r.width+50;
    await page.mouse.move(start,y+100);await page.mouse.down();
    await page.mouse.move(entry,y,{steps:5});
    await page.mouse.move(entry+direction*r.width*.8,y,{steps:12});await page.mouse.up();
    await expect(page.locator('[data-gacha-reveal]')).toHaveCount(5);
    if(direction===1) {
      for(let i=0;i<5;i++) await page.locator(`[data-gacha-reveal="${i}"]`).click();
      await page.locator('#gachaScreen').click({position:{x:15,y:100}});
    }
  }
});
test('completed pack advances only on empty space; buttons keep their functions and UR pauses remain', async ({page}) => {
  let s=C.initial();s.cp=50;s=C.purchase(s,'endless',10,()=>0,'anywhere-next');
  s.pending.results[1][4]={baseId:C.PACKS.find(p=>p.id==='endless').ur[0],mode:'ultraRare'};
  await boot(page,s);await page.locator('#homeNavGachaButton').click();
  await page.locator('[data-gacha-receive]').click();
  for(let pack=0;pack<2;pack++) {
    await page.locator('[data-gacha-tear]').focus();await page.keyboard.press('Enter');
    await page.locator('#gachaScreen').click({position:{x:15,y:100}});
    expect((await saved(page)).pending.index).toBe(pack);
    for(let i=0;i<5;i++) await page.locator(`[data-gacha-reveal="${i}"]`).click();
    expect((await saved(page)).pending.phase).toBe('cards');
    expect((await saved(page)).pending.index).toBe(pack);
    if(pack===1) {
      await page.locator('.gacha-ur-moment').click({position:{x:5,y:5}});
      expect((await saved(page)).pending.urPause).toBe(true);
      await page.locator('[data-gacha-ur-continue]').click();
      expect((await saved(page)).pending.index).toBe(pack);
      await page.locator('[data-gacha-reveal="0"]').click();
      expect((await saved(page)).pending.index).toBe(pack);
      await page.locator('[data-gacha-rates]').click();
      await expect(page.locator('.gacha-dialog')).toBeVisible();
      expect((await saved(page)).pending.index).toBe(pack);
      await page.locator('[data-gacha-close]').click();
    }
    await page.locator('#gachaScreen').click({position:{x:15,y:100}});
    await expect(page.locator('[data-gacha-tear]')).toBeVisible();
    expect((await saved(page)).pending.index).toBe(pack+1);
  }
  await page.screenshot({path:test.info().outputPath('next-pack.png')});
});
test('last completed pack advances to summary on a background click', async ({page}) => {
  let s=C.initial();s.cp=5;s=C.purchase(s,'endless',1,()=>0,'last-anywhere');
  await boot(page,s);await page.locator('#homeNavGachaButton').click();
  await page.locator('[data-gacha-receive]').click();
  await page.locator('[data-gacha-tear]').focus();await page.keyboard.press('Enter');
  for(let i=0;i<5;i++) await page.locator(`[data-gacha-reveal="${i}"]`).click();
  expect((await saved(page)).pending.phase).toBe('cards');
  await expect(page.locator('[data-gacha-next]')).toHaveCount(0);
  await page.waitForTimeout(650);
  await page.screenshot({path:test.info().outputPath('completed-pack.png')});
  await page.locator('#gachaScreen').click({position:{x:15,y:100}});
  await expect(page.locator('.gacha-summary-grid button')).toHaveCount(5);
  const returnStyle=await page.locator('[data-gacha-finish]').evaluate(el=>{
    const s=getComputedStyle(el);return [s.backgroundColor,s.borderTopWidth,s.boxShadow,s.alignSelf];
  });
  expect(returnStyle).toEqual(['rgba(0, 0, 0, 0)','0px','none','flex-end']);
  await expect(page.locator('#homeNavigation')).toBeHidden();
  await page.screenshot({path:test.info().outputPath('summary-no-nav.png')});
  await page.locator('[data-gacha-finish]').click();
  await expect(page.locator('#homeNavigation')).toBeVisible();
});
test('fast continuous drag reveals all visited cards; ten-pack progress persists', async ({page}) => {
  let s=C.initial();s.cp=50;s=C.purchase(s,'endless',10,()=>0,'ten-fixed');
  await boot(page,s);await page.locator('#homeNavGachaButton').click();
  await page.locator('[data-gacha-receive]').click();await page.locator('[data-gacha-tear]').focus();await page.keyboard.press('Enter');
  const first=await page.locator('[data-gacha-reveal="0"]').boundingBox();
  const last=await page.locator('[data-gacha-reveal="4"]').boundingBox();
  await page.mouse.move(first.x+first.width/2,first.y+first.height/2);await page.mouse.down();
  await page.mouse.move(last.x+last.width/2,last.y+last.height/2,{steps:15});await page.mouse.up();
  await expect.poll(async()=>(await saved(page)).pending.revealed).toBe(5);
  await page.locator('#gachaScreen').click({position:{x:15,y:100}});await expect.poll(async()=>(await saved(page)).pending.index).toBe(1);
  await page.reload();await page.locator('#homeNavGachaButton').click();
  expect((await saved(page)).pending.index).toBe(1);expect((await saved(page)).cp).toBe(0);
  await page.locator('[data-gacha-skip]').click();
  await expect(page.locator('.gacha-summary-grid button')).toHaveCount(50);
  await page.screenshot({path:test.info().outputPath('ten-results.png')});
});
test('fixed packs, equal front/back size, sparse copy and scrollable batch results', async ({page}) => {
  const s=C.initial();s.cp=50;
  await boot(page,s);await page.locator('#homeNavGachaButton').click();
  const sizes=[];
  for(const p of C.PACKS) {
    await page.locator(`[data-gacha-pack="${p.id}"]`).click();
    const r=await page.locator('.gacha-purchase-panel .gacha-packet').boundingBox();sizes.push([r.width,r.height]);
    expect(await page.locator('.gacha-purchase-panel .gacha-packet').evaluate(el=>Array.from(el.children).every(child=>child.getBoundingClientRect().bottom<=el.getBoundingClientRect().bottom+1))).toBe(true);
  }
  expect(new Set(sizes.map(JSON.stringify)).size).toBe(1);
  expect(await page.locator('#gachaScreen').evaluate(el=>getComputedStyle(el).backgroundImage)).toBe('none');
  await page.locator('[data-gacha-buy="10"]').click();
  await expect(page.locator('[data-gacha-receive]')).toBeVisible();
  await expect(page.locator('#homeNavigation')).toBeHidden();
  await page.waitForTimeout(900);
  expect(await page.locator('.gacha-handoff').evaluate(el=>{
    const counter=getComputedStyle(el,'::before');
    const robot=getComputedStyle(el.querySelector('.gacha-robot'));
    const pack=getComputedStyle(el.querySelector('[data-gacha-receive]'));
    return counter.backgroundColor==='rgb(185, 155, 123)' && Number(robot.zIndex)<Number(counter.zIndex) && Number(counter.zIndex)<Number(pack.zIndex);
  })).toBe(true);
  await page.screenshot({path:test.info().outputPath('handoff.png')});
  await page.locator('[data-gacha-receive]').click();
  await expect(page.locator('[data-gacha-tear]')).toBeVisible();
  await expect(page.locator('#homeNavigation')).toBeHidden();
  await page.screenshot({path:test.info().outputPath('sealed.png')});
  await page.locator('[data-gacha-tear]').focus();await page.keyboard.press('Enter');
  const back=await page.locator('[data-gacha-reveal="0"] .gacha-card-back').boundingBox();
  await expect(page.locator('#homeNavigation')).toBeHidden();
  expect(await page.locator('.gacha-reveal-stage').evaluate(el=>getComputedStyle(el,'::before').backgroundColor)).toBe('rgb(185, 155, 123)');
  await page.locator('[data-gacha-reveal="0"]').click();
  if(await page.locator('[data-gacha-ur-continue]').count()) await page.locator('[data-gacha-ur-continue]').click();
  await page.waitForTimeout(700);
  const front=await page.locator('[data-gacha-reveal="0"] .card').boundingBox();
  expect(front.width).toBeCloseTo(back.width,0);expect(front.height).toBeCloseTo(back.height,0);
  await expect(page.locator('#gachaScreen')).not.toContainText('左から順に');
  await expect(page.locator('#gachaScreen')).not.toContainText('点線に沿って');
  await page.screenshot({path:test.info().outputPath('reveal-fixed.png')});
  const before=await saved(page);await page.locator('[data-gacha-skip]').click();
  await expect(page.locator('.gacha-summary-grid button')).toHaveCount(50);
  expect((await saved(page)).pending.results).toEqual(before.pending.results);
  const grid=page.locator('.gacha-summary-grid');
  expect(await grid.evaluate(el=>el.scrollHeight>el.clientHeight)).toBe(true);
  await grid.hover();await page.mouse.wheel(0,5000);
  await expect.poll(()=>grid.evaluate(el=>el.scrollTop)).toBeGreaterThan(0);
  await page.screenshot({path:test.info().outputPath('results-scrolled.png')});
  await page.reload();await page.locator('#homeNavGachaButton').click();
  await expect(page.locator('.gacha-summary-grid button')).toHaveCount(50);
  expect((await saved(page)).cp).toBe(0);
});
test('narrow preview keeps shop controls inside their panels', async({page})=>{
  await boot(page);await page.setViewportSize({width:390,height:844});await page.locator('#homeNavGachaButton').click();
  await page.screenshot({path:test.info().outputPath('shop-narrow.png')});
  const boxes=await page.locator('.gacha-pack-list,.gacha-featured,.gacha-purchase-panel').evaluateAll(els=>els.map(el=>{const r=el.getBoundingClientRect();return {left:r.left,right:r.right,bottom:r.bottom};}));
  const nav=await page.locator('#homeNavigation').boundingBox();
  for(const b of boxes){expect(b.left).toBeGreaterThan(0);expect(b.right).toBeLessThan(390);expect(b.bottom).toBeLessThan(nav.y);}
});
test('purchase save failure changes no CP/progress/style; old style import keeps gacha grants', async ({page}) => {
  const s=C.initial();s.cp=10;s.owned.general_student={rare:true};
  await boot(page,s);await page.locator('#homeNavGachaButton').click();
  const before=await saved(page);
  await page.evaluate(key=>{
    const original=Storage.prototype.setItem;
    Storage.prototype.setItem=function(k,v){if(k===key)throw new Error('quota');return original.call(this,k,v);};
  },C.KEY);
  await page.locator('[data-gacha-buy="1"]').click();
  await expect(page.locator('.gacha-error')).toContainText('quota');expect(await saved(page)).toEqual(before);
  await page.evaluate(()=>{unlockedExtraCardStyles={yuta:{superRare:true}};persistDungeonCardStyles();});
  const styles=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)).cardUnlocks,styleKey);
  expect(styles.general_student.rare).toBe(true);expect(styles.yuta.superRare).toBe(true);
});
test('gacha navigation protects an unsaved deck draft',async({page})=>{
  await boot(page);await page.locator('#homeNavDeckButton').click();await page.locator('[data-case-view="library"]').click();
  await page.locator('#deckLibraryGrid .new-deck').click();
  await page.locator('#deckSaveNameInput').fill('編集中');
  await page.locator('#homeNavGachaButton').click();await expect(page.locator('.case-confirm')).toBeVisible();
  await page.locator('[data-discard-cancel]').click();await expect(page.locator('#gachaScreen')).toBeHidden();
  await page.locator('#homeNavGachaButton').click();await page.locator('[data-discard-yes]').click();await expect(page.locator('#gachaScreen')).toBeVisible();
});
test('existing endGame hook awards real AI match once without affecting battle result',async({page})=>{
  await boot(page);
  await page.evaluate(()=>{
    const deck=Object.values(createStarterSavedDecks())[0];
    state.deckBuilder.counts.player={...deck.counts};
    state.deckBuilder.counts.opponent={...deck.counts};
    startNewGameWithDecks();endGame('player','テスト勝利');
  });
  await expect.poll(async()=>(await saved(page)).cp).toBe(5);
  expect(await page.evaluate(()=>window.__chibattle.state.gameWinner)).toBe('player');
});
