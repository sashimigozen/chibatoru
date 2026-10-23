const { test, expect } = require('@playwright/test');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const url = 'http://127.0.0.1:8791/narabe-test/';
test.setTimeout(90000);
test.beforeEach(async({page})=>{await page.addInitScript(()=>{Math.random=()=>.4;});});
async function reachTurn(page){
  await expect(page.locator('#dealSource')).toBeHidden({timeout:20000});
  for(let n=0;n<300;n++){
    if(await page.locator('#pass').isEnabled())return;
    const dialog=page.locator('#specialDialog');
    if(await dialog.isVisible()&&!(await page.locator('#specialClose').isVisible())){
      const option=page.locator('#specialOptions button').first();if(await option.count())await option.click();
      if(await page.locator('#specialConfirm').isEnabled())await page.locator('#specialConfirm').click();
    }
    await page.waitForTimeout(100);
  }
  await expect(page.locator('#pass')).toBeEnabled();
}
test('チバトル素材を使ったマッチング画面とCPU戦をPC・スマホで確認', async ({page}) => {
  const errors=[];page.on('pageerror', e=>errors.push(e.message));
  for(const viewport of [{width:1440,height:900},{width:390,height:844}]){
    await page.setViewportSize(viewport);await page.goto(url);
    await expect(page.locator('#lobby')).toBeVisible();
    await expect.poll(()=>page.locator('.battle-art').evaluate(img=>img.naturalWidth)).toBeGreaterThan(0);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.screenshot({path:test.info().outputPath(`lobby-${viewport.width}.png`),fullPage:true});
    await page.locator('#solo').click(); await expect(page.locator('#battle')).toBeVisible();
    await expect(page.locator('#table .slot')).toHaveCount(50);
    expect(await page.locator('#table [data-row-label]').evaluateAll(rows=>rows.map(row=>row.dataset.rowLabel))).toEqual(['環境','教師','学生','ヴァンパイア','持ち物']);
    await expect(page.locator('#table .empty-seat')).toHaveCount(7);
    await expect(page.locator('#players .player')).toHaveCount(3);
    await reachTurn(page);
    await expect(page.locator('#specialHand .special-card')).toHaveCount(3);
    const board=await page.locator('#table .slot').evaluateAll(cells=>cells.map(cell=>({visible:getComputedStyle(cell).visibility,border:getComputedStyle(cell).borderStyle,number:cell.querySelector('.slot-number')?.textContent,hasCard:!!cell.querySelector('chibatoru-original-card')})));
    expect(board.every(cell=>cell.visible==='visible'&&cell.border==='dashed')).toBe(true);
    expect(board.filter(cell=>!cell.hasCard).every(cell=>/^([1-9]|10)$/.test(cell.number))).toBe(true);
    const playable=page.locator('#hand .playable:not(:disabled)');
    if(await playable.count())expect(await playable.first().evaluate(el=>getComputedStyle(el).animationName)).toBe('narabe-playable-glow');
    await page.screenshot({path:test.info().outputPath(`battle-${viewport.width}.png`),fullPage:true});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    const rev = await page.locator('#logs li').count();
    const card=page.locator('#hand button.playable:enabled').first();
    if(await card.count())await card.click();else await page.locator('#pass').click();
    await expect.poll(()=>page.locator('#logs li').count()).toBeGreaterThan(rev);
  }
  expect(errors).toEqual([]);
});

test('別々の3画面が同じ部屋で準備して七並べを開始できる', async ({browser}) => {
  const contexts = await Promise.all([0,1,2].map(()=>browser.newContext()));
  try {
    const pages=await Promise.all(contexts.map(c=>c.newPage()));
    for(let i=0;i<3;i++){await pages[i].goto('http://127.0.0.1:8791/narabe-test/');await pages[i].locator('#name').fill(`学生${i+1}`);}
    await pages[0].locator('#create').click(); await expect(pages[0].locator('#connected')).toBeVisible();
    const code=await pages[0].locator('#copy').textContent();
    for(const page of pages.slice(1)){await page.locator('#code').fill(code);await page.locator('#join').click();await expect(page.locator('#connected')).toBeVisible();}
    await expect(pages[0].locator('#people .person')).toHaveCount(3);
    for(const page of pages)await page.locator('#ready').click();
    await expect(pages[0].locator('#start')).toBeEnabled();await pages[0].locator('#start').click();
    for(const page of pages){await expect(page.locator('#battle')).toBeVisible();await expect(page.locator('#players .player')).toHaveCount(3);await expect(page.locator('#hand button')).not.toHaveCount(0);}
    for(const page of pages)await expect(page.locator('#dealSource')).toBeHidden({timeout:15000});
    await pages[0].screenshot({path:test.info().outputPath('online-three-players.png'),fullPage:true});
  } finally {await Promise.all(contexts.map(c=>c.close()));}
});

test('通常版と同じ配札演出とドラッグ表示を使用し、左上MENU・右上ログを維持する', async ({page}) => {
  await page.setViewportSize({width:1600,height:1200});await page.goto(url);
  await page.locator('#total').selectOption('5');await page.locator('#solo').click();
  await expect(page.locator('#dealSource')).toBeVisible();await expect(page.locator('#pass')).toBeDisabled();
  await expect.poll(()=>page.locator('.narabe-deal-flight').count()).toBeGreaterThan(0);
  await expect(page.locator('#dealSource')).toBeHidden({timeout:15000});
  await reachTurn(page);
  const info=await page.evaluate(()=>({menu:document.querySelector('#menuButton').getBoundingClientRect().toJSON(),log:document.querySelector('#logButton').getBoundingClientRect().toJSON(),hand:document.querySelector('#hand').getBoundingClientRect().toJSON(),opponents:document.querySelector('#players').getBoundingClientRect().toJSON(),draw:typeof ChibattleDraw.play,drag:typeof ChibattleHandDrag.bind}));
  expect(info.menu.x).toBe(20);expect(info.log.right).toBe(1580);expect(info.menu.y).toBe(16);expect(info.log.y).toBe(16);
  expect(info.hand.y).toBeGreaterThan(650);expect(info.opponents.x).toBeLessThan(50);expect(info.draw).toBe('function');expect(info.drag).toBe('function');
  const layout=await page.evaluate(()=>{
    const rect=s=>document.querySelector(s).getBoundingClientRect().toJSON();
    const cards=[...document.querySelectorAll('#hand>.playing-card')].map(e=>e.getBoundingClientRect().toJSON());
    return {table:rect('.table-panel'),hand:rect('.self-area'),controls:rect('.self-controls'),cards,surface:getComputedStyle(document.querySelector('.table-panel')).backgroundColor,outer:getComputedStyle(document.querySelector('#battle')).backgroundColor};
  });
  expect(layout.table.height).toBeGreaterThan(650);
  expect(layout.table.bottom).toBeLessThan(layout.hand.top);
  expect(layout.hand.right).toBeLessThan(layout.controls.left);
  expect(layout.controls.width).toBe(160);
  expect(layout.surface).toBe('rgb(248, 251, 253)');expect(layout.outer).toBe('rgb(237, 243, 247)');
  if(layout.cards.length>1)expect(layout.cards[1].x-layout.cards[0].x).toBeGreaterThanOrEqual(layout.cards[0].width*.59);
  const card=page.locator('#hand button.playable').first(),cardId=await card.getAttribute('data-card-id'),source=await card.boundingBox();
  const target=await page.locator(`#table [data-card-id="${cardId}"]`).boundingBox();
  await page.mouse.move(source.x+10,source.y+source.height/2);await page.mouse.down();await page.mouse.move(target.x+target.width/2,target.y+target.height/2,{steps:12});
  await expect(page.locator('.drag-ghost-card')).toHaveCount(1);await page.mouse.up();
  await expect(page.locator(`#table [data-card-id="${cardId}"]`)).toHaveClass(/filled/);
  await expect(page.locator('.drag-ghost-card')).toHaveCount(0);
  await page.locator('#menuButton').click();await expect(page.locator('#menuDrawer')).toBeVisible();await page.locator('#menuClose').click();
  await page.locator('#logButton').click();await expect(page.locator('#logDrawer')).toBeVisible();await page.locator('#logClose').click();
});
