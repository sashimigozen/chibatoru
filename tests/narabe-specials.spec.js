const {test,expect}=require('@playwright/test');
const url='http://127.0.0.1:8791/narabe-test/';
test.use({reducedMotion:'reduce'});test.setTimeout(60000);
async function setup(page,id='reverse',total){
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(url);
  if(total)await page.locator('#total').selectOption(String(total));
  // Controlled rule state through the public engine, not a production debug hook.
  await page.evaluate(id=>{const create=Narabe.create;Narabe.create=names=>{
    const g=create(names,()=>.4);g.turn=0;g.players[0].passes=1;
    const owner=g.players.findIndex(p=>p.specials.includes(id));
    if(owner>0){const index=g.players[owner].specials.indexOf(id);[g.players[0].specials[0],g.players[owner].specials[index]]=[id,g.players[0].specials[0]];}
    else if(owner<0)g.players[0].specials[0]=id;
    return g;
  };},id);
  await page.locator('#solo').click();
  await expect(page.locator('#pass')).toBeEnabled({timeout:30000});
  return errors;
}
test('白銀の別手札・使用確認・キャンセル・1手番1枚を実表示',async({page})=>{
  await page.setViewportSize({width:1440,height:900});const errors=await setup(page);
  await expect(page.locator('#specialHand>.special-card')).toHaveCount(3);
  await expect(page.locator('#specialHand .special-card-text,#specialHand .special-card-tag')).toHaveCount(0);
  const layout=await page.evaluate(()=>{const a=document.querySelector('.normal-hand-area').getBoundingClientRect(),b=document.querySelector('.special-hand-area').getBoundingClientRect();return {right:a.right,left:b.left,frame:getComputedStyle(document.querySelector('#specialHand>.special-card')).borderTopColor};});
  expect(layout.right).toBeLessThan(layout.left);expect(layout.frame).toBe('rgb(119, 131, 143)');
  await page.screenshot({path:'/tmp/chibatoru-narabe-special-hand.png'});
  await page.locator('#specialHand [data-special-id="reverse"]').click();await expect(page.locator('#specialText')).toContainText('逆転');
  await page.locator('#specialClose').click();await expect(page.locator('#specialHand>.special-card')).toHaveCount(3);
  await page.locator('#specialHand [data-special-id="reverse"]').click();await page.locator('#specialConfirm').click();
  await expect(page.locator('#specialReveal')).toBeVisible();await expect(page.locator('#specialRevealName')).toContainText('リバース');
  await expect(page.locator('#pass')).toBeDisabled();
  await expect(page.locator('#turnEffects')).toContainText('逆方向');await expect(page.locator('#specialHand>.special-card')).toHaveCount(2);
  expect(await page.locator('#specialHand button:enabled').count()).toBe(0);expect(errors).toEqual([]);
});
test('タイプを選んで配置禁止を使える',async({page})=>{
  await setup(page,'block');await page.locator('#specialHand [data-special-id="block"]').click();
  await expect(page.locator('#specialConfirm')).toBeDisabled();await page.locator('#specialOptions button').filter({hasText:'環境'}).click();
  await page.locator('#specialConfirm').click();await expect(page.locator('#turnEffects')).toContainText('環境 配置禁止');
});
test('情報収集は対象を選び、本人専用の確認画面を閉じて通常配置へ戻る',async({page})=>{
  await setup(page,'inspect');await page.locator('#specialHand [data-special-id="inspect"]').click();
  await page.locator('#specialOptions button').filter({hasText:'CPU 1'}).click();await page.locator('#specialConfirm').click();
  await expect(page.locator('#specialText')).toContainText('あなただけ');await expect(page.locator('#specialOptions chibatoru-original-card')).not.toHaveCount(0);
  await expect(page.locator('#specialClose')).toBeHidden();await page.screenshot({path:'/tmp/chibatoru-narabe-private-inspection.png'});
  await page.locator('#selectionPeek').click();await expect(page.locator('#specialDialog')).toBeHidden();await expect(page.locator('#pass')).toBeDisabled();
  await page.locator('#selectionReturn').click();await expect(page.locator('#specialOptions chibatoru-original-card')).not.toHaveCount(0);
  await page.locator('#specialConfirm').click();await expect(page.locator('#specialDialog')).toBeHidden();await expect(page.locator('#pass')).toBeEnabled();
});
test('交換留学は相手と自分の1枚を選んで確定する',async({page})=>{
  const errors=await setup(page,'exchange');await page.locator('#specialHand [data-special-id="exchange"]').click();
  await page.locator('#specialOptions>.special-option').first().click();await expect(page.locator('#specialConfirm')).toBeDisabled();
  await page.locator('#specialOptions .narabe-shell').first().click();await page.locator('#specialConfirm').click();
  await expect(page.locator('#specialDialog')).toBeHidden();await expect(page.locator('#logs')).toContainText('交換留学');expect(errors).toEqual([]);
});
test('選択を保持して盤面・ログを確認でき、戻ってから確定する',async({page})=>{
  await setup(page,'exchange');await page.locator('#specialHand [data-special-id="exchange"]').click();
  await page.locator('#specialOptions>.special-option').first().click();await page.locator('#specialOptions .narabe-shell').first().click();
  await page.locator('#selectionPeek').click();await expect(page.locator('#specialDialog')).toBeHidden();
  await expect(page.locator('#selectionReturn')).toBeVisible();
  await page.locator('#table .slot[role="button"]').first().click();await expect(page.locator('#cardPreview')).toBeVisible();
  await page.locator('#logButton').click();await expect(page.locator('#logDrawer')).toBeVisible();await page.locator('#logClose').click();
  await page.locator('#selectionReturn').click();await expect(page.locator('#specialDialog')).toBeVisible();
  await expect(page.locator('#specialOptions .selected')).toHaveCount(2);await expect(page.locator('#specialConfirm')).toBeEnabled();
  await page.locator('#specialConfirm').click();await expect(page.locator('#specialDialog')).toBeHidden();
});
test('2人戦の多い手札もPC・スマホでスクロールなし、パスは盤面内',async({page})=>{
  for(const size of [{width:1440,height:900},{width:390,height:844}]){
    await page.setViewportSize(size);await setup(page,'reverse',2);
    const layout=await page.evaluate(()=>{
      const rect=e=>e.getBoundingClientRect().toJSON(),hand=document.querySelector('.normal-hand-area'),special=document.querySelector('.special-hand-area');
      return {hand:rect(hand),special:rect(special),cards:[...document.querySelectorAll('#hand>.playing-card')].map(rect),strips:[...document.querySelectorAll('#specialHand>.special-card')].map(rect),scroll:document.querySelector('.hand-window').scrollWidth,client:document.querySelector('.hand-window').clientWidth,table:rect(document.querySelector('.table-panel')),controls:rect(document.querySelector('.self-controls'))};
    });
    expect(layout.scroll).toBeLessThanOrEqual(layout.client+1);
    expect(layout.table.bottom).toBeLessThanOrEqual(layout.hand.top);
    for(const c of layout.cards){expect(c.x).toBeGreaterThanOrEqual(layout.hand.x);expect(c.right).toBeLessThanOrEqual(layout.hand.right+1);expect(c.bottom).toBeLessThan(size.height-65);}
    for(const c of layout.strips){expect(c.right).toBeLessThanOrEqual(layout.special.right);expect(c.x).toBeGreaterThanOrEqual(layout.special.x);}
    expect(layout.controls.right).toBeLessThanOrEqual(layout.table.right);expect(layout.controls.bottom).toBeLessThanOrEqual(layout.table.bottom);
    await page.screenshot({path:`/tmp/narabe-hand-fit-${size.width}.png`});
  }
});
test('6人の一斉点呼では手番外の人にも選択画面が開き選択を確定できる',async({page})=>{
  await page.goto(url);
  await page.evaluate(()=>{const create=Narabe.create;Narabe.create=names=>{
    const g=create(names,()=>.4),card=Narabe.cardAt(0,4),owner=g.players.findIndex(p=>p.hand.some(c=>c.id===card.id));
    const index=g.players[owner].hand.findIndex(c=>c.id===card.id);
    [g.players[0].hand[0],g.players[owner].hand[index]]=[card,g.players[0].hand[0]];
    return g;
  };});await page.locator('#total').selectOption('6');
  await page.locator('#solo').click();await expect(page.locator('#specialDialog')).toBeVisible({timeout:40000});
  await expect(page.locator('#specialTitle')).toContainText('一斉点呼');await expect(page.locator('#specialClose')).toBeHidden();
  await page.locator('#specialOptions button').first().click();await page.screenshot({path:'/tmp/chibatoru-narabe-rollcall.png'});
  await page.locator('#selectionPeek').click();await expect(page.locator('#specialDialog')).toBeHidden();
  await page.locator('#selectionReturn').click();await expect(page.locator('#specialOptions .selected')).toHaveCount(1);
  await page.locator('#specialConfirm').click();await expect(page.locator('#specialDialog')).toBeHidden();
});
