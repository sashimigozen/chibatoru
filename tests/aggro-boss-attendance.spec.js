const {test,expect}=require('@playwright/test');
const {pathToFileURL}=require('node:url');const path=require('node:path');
const url=pathToFileURL(path.join(__dirname,'..','index.html')).href;
async function open(page) {
 await page.goto(url);
 await page.evaluate(()=>{startCardTest('aggro_boss');scheduleOpponentAI=()=>{};state.training.skipAnimations=true;});
 await expect.poll(()=>page.evaluate(()=>battlePresentationBusy())).toBe(false);
}
async function spawn(page,index=4) {
 await page.evaluate(index=>playCard(state.players.player.hand.find(c=>c.baseId==='aggro_boss').instanceId,'seat','player',index),index);
 await expect.poll(()=>page.evaluate(index=>state.players.player.board.seats[index]?.baseId,index)).toBe('aggro_boss');
}
async function choose(page,id,index) {
 await expect.poll(()=>page.evaluate(()=>state.pendingCopiedCard?.baseId)).toBe(id);
 await expect.poll(()=>page.evaluate(()=>battlePresentationBusy({ignoreFusionTasks:true}))).toBe(false);
 await page.locator(`#playerSeatGrid .slot[data-index="${index}"]`).click();
}
for(const width of [1280,390])test(`左右の席マスを直接選び、キングから順に出席させる ${width}`,async({page})=>{
 await page.setViewportSize({width,height:900});await open(page);await spawn(page);
 await expect.poll(()=>page.evaluate(()=>state.pendingCopiedCard?.baseId)).toBe('aggro_king');
 await expect(page.locator('#threeGesturesStage')).toBeHidden();
 await expect(page.locator('#playerSeatGrid .slot.click-ready')).toHaveCount(2);
 await expect.poll(()=>page.evaluate(()=>battlePresentationBusy({ignoreFusionTasks:true}))).toBe(false);
 await page.locator('#playerSeatGrid .slot[data-index="0"]').click({force:true});
 expect(await page.evaluate(()=>state.pendingCopiedCard.baseId)).toBe('aggro_king');
 // The first card can use either neighbor; placement is not fixed left/right.
 await choose(page,'aggro_king',5);
 await expect.poll(()=>page.evaluate(()=>state.pendingCopiedCard?.baseId)).toBe('aggro_princess');
 await expect(page.locator('#playerSeatGrid .slot.click-ready')).toHaveCount(1);
 await choose(page,'aggro_princess',3);
 await expect.poll(()=>page.evaluate(()=>fusionTasksBusy())).toBe(false);
 expect(await page.evaluate(()=>[3,4,5].map(i=>{
  const c=state.players.player.board.seats[i];return [c.baseId,c.attack,c.currentHp,c.lastAttendanceSource,canAttackSilently(c),hasKeyword(c,'超陽気')];
 }))).toEqual([
  ['aggro_princess',1,1,'generated',true,true],['aggro_boss',1,2,'hand',true,true],['aggro_king',1,1,'generated',false,false]
 ]);
 expect(await page.evaluate(()=>state.players.player.will)).toBe(6);
});
test('隣接マスが1つならキングだけが出席し、プリンセスを校外に生成しない',async({page})=>{
 await open(page);await spawn(page,0);await choose(page,'aggro_king',1);
 await expect.poll(()=>page.evaluate(()=>fusionTasksBusy())).toBe(false);
 expect(await page.evaluate(()=>({king:state.players.player.board.seats[1].baseId,
  princes:listBoardRefs('player').map(getBoardCardFromRef).filter(c=>c.baseId==='aggro_princess').length,
  trash:state.players.player.trash.filter(c=>['aggro_king','aggro_princess'].includes(c.baseId)).length,
  pending:!!state.pendingCopiedCard}))).toEqual({king:'aggro_king',princes:0,trash:0,pending:false});
});
test('左右が埋まっていてもボスは出席でき、別の行へ追加出席しない',async({page})=>{
 await open(page);
 await page.evaluate(()=>{for(const index of [3,5])state.players.player.board.seats[index]=makeBoardCard(createCardFromBase('general_student','player'));});
 await spawn(page);await expect.poll(()=>page.evaluate(()=>fusionTasksBusy())).toBe(false);
 expect(await page.evaluate(()=>({count:listBoardRefs('player').length,attack:state.players.player.board.seats[4].attack,
  pending:!!state.pendingCopiedCard,will:state.players.player.will}))).toEqual({count:4,attack:1,pending:false,will:6});
});
for(const reason of ['effect','suppressed','effectless'])test(`追加出席は手札からの有効な出席時だけ ${reason}`,async({page})=>{
 await open(page);
 await page.evaluate(reason=>{
  const card=state.players.player.hand.find(c=>c.baseId==='aggro_boss');
  if(reason==='effect') {
   state.players.player.hand=state.players.player.hand.filter(c=>c!==card);
   attendCard('player',makeBoardCard(card),'seat',4,{attendanceSource:ATTENDANCE_SOURCE.GENERATED});
  }else {
   if(reason==='suppressed')state.players.player.effectUseLockTurnsRemaining=1;
   if(reason==='effectless')card.generatedWithoutEffects=true;
   playCard(card.instanceId,'seat','player',4);
  }
 },reason);
 await expect.poll(()=>page.evaluate(()=>state.players.player.board.seats[4]?.baseId)).toBe('aggro_boss');
 await expect.poll(()=>page.evaluate(()=>fusionTasksBusy())).toBe(false);
 expect(await page.evaluate(()=>listBoardRefs('player').map(getBoardCardFromRef).filter(c=>['aggro_king','aggro_princess'].includes(c.baseId)).length)).toBe(0);
});
for(const side of ['player','opponent'])test(`${side}: AIは2人出せる席を選び、追加出席で停止しない`,async({page})=>{
 await open(page);
 await page.evaluate(side=>{
  state.currentSide=side;state.testMode=false;
  Object.assign(state.training,{active:true,leftController:'ai',skipAnimations:true});
  for(const owner of ['player','opponent'])Object.assign(state.players[owner],{
   board:{teacher:null,seats:Array(9).fill(null)},hand:[],will:10,maxWill:10
  });
  state.players[side].hand=[createCardFromBase('aggro_boss',side)];
 },side);
 const index=await page.evaluate(side=>{
  const move=side==='player'?findTrainingAiPlayMove(side):findAiPlayMove();
  placeCardFromHand(side,move.card.instanceId,move.zone,side,move.index,false);return move.index;
 },side);
 expect(index%3).toBe(1);
 await expect.poll(()=>page.evaluate(()=>fusionTasksBusy())).toBe(false);
 expect(await page.evaluate(side=>({ids:listBoardRefs(side).map(getBoardCardFromRef).map(c=>c.baseId).sort(),
  queue:!!state.pendingSpecialAttendanceQueue,pending:!!state.pendingCopiedCard,will:state.players[side].will}),side))
  .toEqual({ids:['aggro_boss','aggro_king','aggro_princess'],queue:false,pending:false,will:6});
});
test('ドーム下では追加出席したキングも即攻撃でき、合計6ダメージになる',async({page})=>{
 await open(page);
 await page.evaluate(()=>{state.environment=makeBoardCard(createCardFromBase('aggro_dome','player'));applyBoardAuras();});
 await spawn(page);await choose(page,'aggro_king',3);await choose(page,'aggro_princess',5);
 await expect.poll(()=>page.evaluate(()=>fusionTasksBusy())).toBe(false);
 await page.evaluate(async()=>{for(const index of [3,5,4]){state.selectedAttacker={owner:'player',zone:'seat',index};await attackLifeForCurrentSide('opponent');}});
 expect(await page.evaluate(()=>({life:state.players.opponent.life,own:state.players.player.life,boss:state.players.player.board.seats[4].attack})))
  .toEqual({life:14,own:19,boss:4});
});
