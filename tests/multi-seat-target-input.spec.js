const {test,expect}=require('@playwright/test');
const {pathToFileURL}=require('node:url');
const path=require('node:path');
test.beforeEach(async({page})=>{
  await page.setViewportSize({width:1440,height:900});
  await page.goto(pathToFileURL(path.join(__dirname,'..','index.html')).href);
  await page.evaluate(()=>{
    startCardTest('king_ghidorah_bed');scheduleOpponentAI=()=>{};state.environment=null;state.training.skipAnimations=true;
    for(const side of ['player','opponent'])Object.assign(state.players[side],{board:{teacher:null,seats:Array(9).fill(null)},hand:[],deck:[],trash:[],late:[],will:4,maxWill:4,life:20});
    render();
  });
  await expect.poll(()=>page.evaluate(()=>battlePresentationBusy())).toBe(false);
});
for(const id of ['loud_members','big_omata','plump_student','adjective_vs_cynical'])test(`${id}をクリックで指名し全占有マスから破壊する`,async({page})=>{
  if(id==='plump_student')await page.setViewportSize({width:390,height:844});
  const targetId=await page.evaluate(id=>{
    const target=makeBoardCard(createCardFromBase(id,'opponent'));placeMultiSeatCard('opponent',0,target);
    const item=createCardFromBase('king_ghidorah_bed','player'),discard=createCardFromBase('key','player');
    state.players.player.hand=[item,discard];openKingGhidorahBedTargetSelection(item,'2',discard.instanceId);return target.instanceId;
  },id);
  const card=page.locator(`.multi-seat-board-card[data-card-id="${targetId}"]`);
  await expect(card).toHaveClass(/selection-candidate/);
  await card.click();
  await expect.poll(()=>page.evaluate(()=>state.pendingKingGhidorahBed?.target?.index),{timeout:1200}).toBe(0);
  await expect(card).toHaveClass(/selected/);
  if(id==='loud_members')await page.screenshot({path:test.info().outputPath('large-card-selected.png')});
  await page.locator('#itemTargetConfirmButton').click();
  await expect.poll(()=>page.evaluate(()=>state.players.opponent.board.seats.filter(Boolean).length)).toBe(0);
  expect(await page.evaluate(id=>state.players.opponent.trash.filter(card=>card.instanceId===id).length,targetId)).toBe(id==='big_omata'?0:1);
});
test('ゲストの出席時指名でも大型カードを直接クリックして送信する',async({page})=>{
  await page.evaluate(()=>{
    const target=makeBoardCard(createCardFromBase('loud_members','opponent'));placeMultiSeatCard('opponent',0,target);
    const source=makeBoardCard(createCardFromBase('small_omata','player'));state.players.player.board.seats[0]=source;
    state.online.role='guest';state.online.started=true;state.online.connected=true;state.online.conn={};state.remoteResolutionPending=true;
    onlineCanSendCommand=()=>true;onlineSendCommand=(type,payload)=>{window.targetCommand={type,payload};return true;};
    state.pendingAttendTarget={owner:'player',targetOwner:'opponent',sourceCardInstanceId:source.instanceId,sourceCardName:source.name,effect:'small_omata'};render();
  });
  await page.locator('.multi-seat-board-card').click();
  await page.locator('#itemTargetConfirmButton').click();
  expect(await page.evaluate(()=>window.targetCommand)).toMatchObject({type:'attendTarget',payload:{target:{owner:'opponent',zone:'seat',index:0}}});
});
test('演出中の大型カードへの指名は引き続きロックする',async({page})=>{
  await page.evaluate(()=>{
    const target=makeBoardCard(createCardFromBase('loud_members','opponent'));placeMultiSeatCard('opponent',0,target);
    const item=createCardFromBase('king_ghidorah_bed','player'),discard=createCardFromBase('key','player');state.players.player.hand=[item,discard];
    openKingGhidorahBedTargetSelection(item,'2',discard.instanceId);showCardPlayAnimation(createCardFromBase('general_student','player'),'board');
  });
  await page.locator('.multi-seat-board-card').click();
  expect(await page.evaluate(()=>state.pendingKingGhidorahBed.target)).toBeNull();
});
