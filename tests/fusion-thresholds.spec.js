const {test,expect}=require('@playwright/test');
const {pathToFileURL}=require('node:url');
const path=require('node:path');
const url=pathToFileURL(path.join(__dirname,'../index.html')).href;
async function ready(page,id='chugidesu'){
 await page.goto(url);
 await page.evaluate(id=>{startCardTest(id);scheduleOpponentAI=()=>{};state.training.skipAnimations=true;},id);
 await expect.poll(()=>page.evaluate(()=>battlePresentationBusy())).toBe(false);
}
for(const [position,blocked,count] of [[4,[],0],[4,[],1],[4,[],2],[0,[],1],[4,[3],1],[4,[3,5],0]])test(`3枚融合の選択人数・左右制限・出席後のドロー回復 ${position}/${blocked}/${count}`,async({page})=>{
 await ready(page);
 await page.evaluate(({position,blocked})=>{
  const p=state.players.player,c=p.hand.find(c=>c.baseId==='chugidesu');
  for(const index of blocked)attendCard('player',makeBoardCard(createCardFromBase('general_student','player')),'seat',index,{attendanceSource:ATTENDANCE_SOURCE.GENERATED});
  fuseAnyHandCards('player',c.instanceId,p.hand.filter(x=>x.instanceId!==c.instanceId).map(c=>c.instanceId),false);
  placeCardFromHand('player',c.instanceId,'seat','player',position,true);
 },{position,blocked});
 const available=(position%3>0&&!blocked.includes(position-1)?1:0)+(position%3<2&&!blocked.includes(position+1)?1:0);
 if(available){
  await expect.poll(()=>page.evaluate(()=>state.pendingCardChoice?.context?.kind)).toBe('attendance_count');
  expect(await page.evaluate(()=>[state.players.player.hand.length,state.players.player.life])).toEqual([0,10]);
  await page.evaluate(count=>{toggleCardChoiceCard(state.pendingCardChoice.cards.find(c=>c.attendanceCount===count).instanceId);confirmCardChoiceSelection();},count);
  for(let n=0;n<count;n++){
   await expect.poll(()=>page.evaluate(()=>!!state.pendingCopiedCard)).toBe(true);
   expect(await page.evaluate(()=>[state.players.player.hand.length,state.players.player.life])).toEqual([0,10]);
   await page.evaluate(()=>{const index=PLAYER_SEAT_ORDER.find(index=>isPendingCopiedCardPlacementLegal('player','seat','player',index));placePendingCopiedCardForSide('player','seat','player',index);});
  }
 }
 await expect.poll(()=>page.evaluate(()=>fusionTasksBusy())).toBe(false);
 expect(await page.evaluate(()=>[state.players.player.hand.length,state.players.player.life,listBoardRefs('player').filter(r=>getBoardCardFromRef(r).baseId==='exploding_student').length])).toEqual([2,12,count]);
});
test('クイーンは1枚で出席できず2枚で解禁し、3枚目は融合できない',async({page})=>{
 await ready(page,'rear_queen');
 expect(await page.evaluate(()=>{
  const p=state.players.player,c=p.hand.find(c=>c.baseId==='rear_queen');
  const fuse=()=>fuseAnyHandCards('player',c.instanceId,[p.hand.find(x=>x.instanceId!==c.instanceId).instanceId],false);
  fuse();const partial=[handFusionReady(c),placeCardFromHand('player',c.instanceId,'seat','player',4,false)];
  fuse();return [...partial,handFusionReady(c),fuse(),c.handFusionStored.length];
 })).toEqual([false,false,true,false,2]);
});
test('融合の有無にかかわらず、効果出席のチュギデスは出席時効果を使わない',async({page})=>{
 await ready(page);
 await page.evaluate(()=>{
  const p=state.players.player,c=p.hand.find(c=>c.baseId==='chugidesu');
  fuseAnyHandCards('player',c.instanceId,p.hand.filter(x=>x.instanceId!==c.instanceId).map(c=>c.instanceId),false);
  p.hand=p.hand.filter(x=>x!==c);
  attendCard('player',makeBoardCard(c),'seat',4,{attendanceSource:ATTENDANCE_SOURCE.GENERATED});
 });
 await expect.poll(()=>page.evaluate(()=>fusionTasksBusy())).toBe(false);
 expect(await page.evaluate(()=>[listBoardRefs('player').length,state.players.player.hand.length,state.players.player.life])).toEqual([1,0,10]);
});
test('AIは素材3枚でチュギデスの強化効果を最後まで処理する',async({page})=>{
 await ready(page);
 await page.evaluate(()=>{
  state.testMode=false;state.currentSide='opponent';state.aiThinking=true;
  for(const side of ['player','opponent'])Object.assign(state.players[side],{board:{teacher:null,seats:Array(9).fill(null)},deck:Array.from({length:8},()=>createCardFromBase('ruler',side)),hand:[],will:6,maxWill:6,life:10});
  state.players.opponent.hand=['chugidesu','ruler','ruler','ruler'].map(id=>createCardFromBase(id,'opponent'));
  runOpponentAI();
 });
 await expect.poll(()=>page.evaluate(()=>state.currentSide),{timeout:15000}).toBe('player');
 expect(await page.evaluate(()=>[fusionTasksBusy(),state.players.opponent.life,state.players.opponent.board.seats.filter(c=>c?.baseId==='exploding_student').length,state.players.opponent.board.seats.find(c=>c?.baseId==='chugidesu')?.handFusionStored.length])).toEqual([false,12,2,3]);
});

for(const [side,materials] of [['opponent',2],['player',2],['player',3]])test(`左右のAIが必要枚数で融合し、出席と効果を完了する ${side}/${materials}`,async({page})=>{
 await ready(page);
 await page.evaluate(({side,materials})=>{
  state.testMode=false;state.currentSide=side;state.aiThinking=true;
  state.training.active=side==='player';state.training.leftController='ai';
  for(const owner of ['player','opponent'])Object.assign(state.players[owner],{board:{teacher:null,seats:Array(9).fill(null)},deck:Array.from({length:8},()=>createCardFromBase('ruler',owner)),hand:[],will:6,maxWill:6,life:10});
  state.players[side].hand=['chugidesu',...Array(materials).fill('ruler')].map(id=>createCardFromBase(id,side));
  if(side==='player')runTrainingLeftAI();else runOpponentAI();
 },{side,materials});
 await expect.poll(()=>page.evaluate(()=>state.currentSide),{timeout:15000}).toBe(side==='player'?'opponent':'player');
 expect(await page.evaluate(side=>{const p=state.players[side];return [fusionTasksBusy(),p.life,p.board.seats.filter(c=>c?.baseId==='exploding_student').length,p.board.seats.find(c=>c?.baseId==='chugidesu')?.handFusionStored.length];},side)).toEqual([false,materials===3?12:10,materials===3?2:1,materials]);
});
