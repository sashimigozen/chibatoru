const {test,expect}=require('@playwright/test');
const {pathToFileURL}=require('node:url');
const path=require('node:path');
const url=pathToFileURL(path.join(__dirname,'..','index.html')).href;
async function setup(page,will=10,skip=false,singleDiscard=false) {
 await page.goto(url);
 await page.evaluate(({will,skip,singleDiscard})=>{
  startCardTest('failure_student');scheduleOpponentAI=()=>{};
  state.training.skipAnimations=skip;state.testMode=false;state.training.active=false;
  const own=state.players.player;
  own.hand=['failure_student','padlock','private_teacher','general_student','ruler'].map(id=>createCardFromBase(id,'player'));
  if(singleDiscard) {
   own.hand=own.hand.filter(c=>!['private_teacher','ruler'].includes(c.baseId));
   own.hand.find(c=>c.baseId==='padlock').handLoadLevel=2;
  }
  own.board={teacher:null,seats:Array(9).fill(null)};own.will=will;own.maxWill=10;render();
 },{will,skip,singleDiscard});
 await expect.poll(()=>page.evaluate(()=>battlePresentationBusy())).toBe(false);
 await page.evaluate(()=>playCard(state.players.player.hand[0].instanceId,'seat','player',4));
 await expect.poll(()=>page.evaluate(()=>state.pendingCardChoice?.mode)).toBe('bad_student_discard');
 await expect.poll(()=>page.evaluate(()=>battlePresentationBusy())).toBe(false);
 for(const id of (singleDiscard?['general_student']:['general_student','ruler'])) {
  const instanceId=await page.evaluate(id=>state.players.player.hand.find(c=>c.baseId===id).instanceId,id);
  await page.locator(`#threeGesturesHand [data-card-id="${instanceId}"]`).click();
 }
 await page.locator('#threeGesturesConfirmButton').click();
 await expect.poll(()=>page.evaluate(()=>battlePresentationBusy())).toBe(false);
}
test('融合素材用のドラッグ後も、戦意不足の南京錠で対象選択に閉じ込めない',async({page})=>{
 await setup(page,4,true);
 expect(await page.evaluate(()=>{const c=state.players.player.hand[0];return [canStartHandDrag(c),canUseHandCardNow(c)];})).toEqual([true,false]);
 const source=await page.locator('#playerHand [data-base-id="padlock"]').boundingBox();
 const target=await page.locator('#playerSeatGrid .board-card[data-index="4"]').boundingBox();
 await page.mouse.move(source.x+source.width/2,source.y+30);await page.mouse.down();
 await page.mouse.move(target.x+target.width/2,target.y+target.height/2,{steps:12});await page.mouse.up();
 await page.waitForTimeout(250);
 await page.locator('#playerSeatGrid .board-card[data-index="4"]').click();
 expect(await page.evaluate(()=>state.pendingDestroyItem)).toBeNull();
 await expect(page.locator('#endTurnButton')).toBeVisible();
 expect(await page.evaluate(()=>[state.players.player.will,isPadlocked(state.players.player.board.seats[4])])).toEqual([1,false]);
 // The same card remains usable as fusion material despite insufficient will.
 expect(await page.evaluate(()=>performHandFusionDrop(state.players.player.hand.find(c=>c.baseId==='padlock').instanceId,state.players.player.hand.find(c=>c.baseId==='private_teacher').instanceId))).toBe(true);
});
for(const reason of ['will','missing'])test(`確定直前に使用できなくなった場合は通常操作へ戻す ${reason}`,async({page})=>{
 await setup(page,10,true);
 await page.evaluate(()=>beginItemUse(state.players.player.hand.find(c=>c.baseId==='padlock')));
 await page.locator('#playerSeatGrid .board-card[data-index="4"]').click();
 await page.evaluate(reason=>{
  if(reason==='will')state.players.player.will=1;
  else state.players.player.hand=state.players.player.hand.filter(c=>c.baseId!=='padlock');
 },reason);
 await page.locator('#itemTargetConfirmButton').click();
 expect(await page.evaluate(()=>[state.pendingDestroyItem,isPadlocked(state.players.player.board.seats[4])])).toEqual([null,false]);
 await expect(page.locator('#endTurnButton')).toBeVisible();
});
for(const singleDiscard of [false,true])test(`通常演出ありで手札${singleDiscard?1:2}枚を送った後に装備・鍵・手番終了ができる`,async({page})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));await setup(page,10,false,singleDiscard);
 await page.evaluate(()=>beginItemUse(state.players.player.hand.find(c=>c.baseId==='padlock')));
 await page.locator('#playerSeatGrid .board-card[data-index="4"]').click();
 await page.locator('#itemTargetConfirmButton').click();
 await expect.poll(()=>page.evaluate(()=>battlePresentationBusy())).toBe(false);
 expect(await page.evaluate(()=>[state.players.player.will,isPadlocked(state.players.player.board.seats[4]),state.players.player.hand.filter(c=>c.baseId==='key').length])).toEqual([singleDiscard?3:4,true,1]);
 await page.evaluate(()=>beginItemUse(state.players.player.hand.find(c=>c.baseId==='key')));
 await page.locator('#playerSeatGrid .board-card[data-index="4"]').click();
 await page.locator('#itemTargetConfirmButton').click();
 await expect.poll(()=>page.evaluate(()=>battlePresentationBusy())).toBe(false);
 expect(await page.evaluate(()=>[state.pendingDestroyItem,isPadlocked(state.players.player.board.seats[4])])).toEqual([null,false]);
 await expect(page.locator('#endTurnButton')).toBeEnabled();
 await page.locator('#endTurnButton').click({force:true});
 await expect.poll(()=>page.evaluate(()=>state.currentSide)).toBe('opponent');expect(errors).toEqual([]);
});
