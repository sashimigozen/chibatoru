const {test,expect}=require('@playwright/test');
const url='http://127.0.0.1:8791/narabe-test/';
test.use({reducedMotion:'reduce'});test.setTimeout(60000);
async function setup(page,id='reverse'){
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(url);
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
  const layout=await page.evaluate(()=>{const a=document.querySelector('.normal-hand-area').getBoundingClientRect(),b=document.querySelector('.special-hand-area').getBoundingClientRect();return {right:a.right,left:b.left,frame:getComputedStyle(document.querySelector('#specialHand>.special-card')).borderTopColor};});
  expect(layout.right).toBeLessThan(layout.left);expect(layout.frame).toBe('rgb(119, 131, 143)');
  await page.screenshot({path:'/tmp/chibatoru-narabe-special-hand.png'});
  await page.locator('#specialHand [data-special-id="reverse"]').click();await expect(page.locator('#specialText')).toContainText('逆転');
  await page.locator('#specialClose').click();await expect(page.locator('#specialHand>.special-card')).toHaveCount(3);
  await page.locator('#specialHand [data-special-id="reverse"]').click();await page.locator('#specialConfirm').click();
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
  await page.locator('#specialConfirm').click();await expect(page.locator('#specialDialog')).toBeHidden();await expect(page.locator('#pass')).toBeEnabled();
});
test('交換留学は相手と自分の1枚を選んで確定する',async({page})=>{
  const errors=await setup(page,'exchange');await page.locator('#specialHand [data-special-id="exchange"]').click();
  await page.locator('#specialOptions>.special-option').first().click();await expect(page.locator('#specialConfirm')).toBeDisabled();
  await page.locator('#specialOptions .narabe-shell').first().click();await page.locator('#specialConfirm').click();
  await expect(page.locator('#specialDialog')).toBeHidden();await expect(page.locator('#logs')).toContainText('交換留学');expect(errors).toEqual([]);
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
  await page.locator('#specialConfirm').click();await expect(page.locator('#specialDialog')).toBeHidden();
});
