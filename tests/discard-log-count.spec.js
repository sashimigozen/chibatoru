const {test,expect}=require('@playwright/test');
const {pathToFileURL}=require('node:url');
const path=require('node:path');
const url=pathToFileURL(path.join(__dirname,'..','index.html')).href;
test.beforeEach(async({page})=>{
 await page.goto(url);
 await page.evaluate(()=>{startCardTest('failure_student');scheduleOpponentAI=()=>{};state.training.skipAnimations=true;});
 await expect.poll(()=>page.evaluate(()=>battlePresentationBusy())).toBe(false);
});
for(const side of ['player','opponent'])for(const ids of [['general_student','ruler'],['exploding_student','ruler'],['exploding_student','extra_student']]) {
 test(`${side}: 手札2枚の移動とログ・詳細の枚数が一致する ${ids.join('/')}`,async({page})=>{
  const r=await page.evaluate(({side,ids})=>{
   const own=state.players[side];own.hand=ids.map(id=>createCardFromBase(id,side));own.trash=[];state.log=[];state.trashDetailEvents=[];
   const moved=resolveBadStudentDiscardChoice(side,own.hand.map(c=>c.instanceId),CARD_BASES.failure_student);
   const el=document.createElement('div');renderLogMessage(el,state.log[0]);
   return{moved:moved.length,hand:own.hand.length,trash:own.trash.map(c=>c.baseId),text:el.textContent,
    details:state.trashDetailEvents[0]?.cards.map(c=>c.baseId),vanished:moved.filter(c=>c.tokenVanished).length};
  },{side,ids});
  expect(r.moved).toBe(2);expect(r.hand).toBe(0);expect(r.text).toContain('手札から2枚');expect(r.details).toEqual(ids);
  expect(r.trash).toEqual(ids);
  expect(r.vanished).toBe(0);
 });
}
test('実際の出席・手札選択から2枚のログを開き、校外にあるトークンも確認できる',async({page})=>{
 await page.evaluate(()=>{const own=state.players.player;own.hand=['failure_student','exploding_student','ruler'].map(id=>createCardFromBase(id,'player'));own.board={teacher:null,seats:Array(9).fill(null)};state.log=[];render();});
 await page.evaluate(()=>playCard(state.players.player.hand[0].instanceId,'seat','player',4));
 await expect.poll(()=>page.evaluate(()=>state.pendingCardChoice?.mode)).toBe('bad_student_discard');
 await expect.poll(()=>page.evaluate(()=>battlePresentationBusy())).toBe(false);
 await page.locator('#threeGesturesHand .card').nth(0).click();await page.locator('#threeGesturesHand .card').nth(1).click();
 await page.locator('#threeGesturesConfirmButton').click();
 await expect.poll(()=>page.evaluate(()=>battlePresentationBusy())).toBe(false);
 await page.locator('#battleLogButton').click();
 await expect(page.locator('#log .log-trash-count-button')).toHaveText('2枚');
 await page.locator('#log .log-trash-count-button').click();
 await expect(page.locator('#battleCardPreview .battle-card-preview-collection-title')).toContainText('2枚');
 await expect(page.locator('#battleCardPreview .battle-card-preview-collection-title')).not.toContainText('消滅');
 await expect(page.locator('#battleCardPreview .battle-card-preview-collection-card')).toHaveCount(2);
 expect(await page.evaluate(()=>state.players.player.trash.map(c=>c.baseId))).toEqual(['exploding_student','ruler']);
});
for(const side of ['player','opponent'])test(`${side}: ハンディジェットエンジンの自分1枚・相手2枚にトークンも含める`,async({page})=>{
 const r=await page.evaluate(side=>{
  const other=oppositeSide(side),own=state.players[side],enemy=state.players[other];state.currentSide=side;state.log=[];state.trashDetailEvents=[];
  const item=createCardFromBase('handy_jet_engine',side);own.hand=[item,createCardFromBase('exploding_student',side)];own.will=10;own.trash=[];
  enemy.hand=['extra_student','ruler','general_student'].map(id=>createCardFromBase(id,other));enemy.trash=[];
  const random=Math.random;Math.random=()=>0;
  try{castImmediateItem(side,item,false);}finally{Math.random=random;}
  const log=state.log.find(t=>t.includes('自分の手札からランダムに'));const el=document.createElement('div');renderLogMessage(el,log);
  const events=state.trashDetailEvents;const snap=onlineCreateSnapshot();
  return{text:el.textContent,labels:[...el.querySelectorAll('.log-trash-count-button')].map(b=>b.textContent),
   counts:events.map(e=>e.cards.length).sort(),own:own.hand.length,enemy:enemy.hand.map(c=>c.baseId),
   ownTrash:own.trash.map(c=>c.baseId),enemyTrash:enemy.trash.map(c=>c.baseId),
   sharedCounts:snap.state.trashDetailEvents.map(e=>e.cards.length).sort()};
 },side);
 expect(r.labels).toEqual(['1枚','2枚']);expect(r.counts).toEqual([1,2]);expect(r.sharedCounts).toEqual([1,2]);
 expect(r.own).toBe(0);expect(r.enemy).toEqual(['general_student']);expect(r.ownTrash).toEqual(['handy_jet_engine','exploding_student']);expect(r.enemyTrash).toEqual(['extra_student','ruler']);
});
test('デッキから3枚送る場合もトークンを含む枚数と詳細を表示する',async({page})=>{
 const r=await page.evaluate(()=>{
  const own=state.players.player;own.hand=[createCardFromBase('dos_attack','player')];own.will=10;state.log=[];state.trashDetailEvents=[];
  state.players.opponent.deck=['exploding_student','ruler','general_student'].map(id=>createCardFromBase(id,'opponent'));state.players.opponent.trash=[];
  castImmediateItem('player',own.hand[0],false);
  const text=state.log.find(t=>t.includes('デッキの上から'));const el=document.createElement('div');renderLogMessage(el,text);
  return{text:el.textContent,detail:state.trashDetailEvents[0]?.cards.length,trash:state.players.opponent.trash.map(c=>c.baseId)};
 });expect(r.text).toContain('3枚');expect(r.detail).toBe(3);expect(r.trash).toEqual(['exploding_student','ruler','general_student']);
});
test('送れた枚数が0枚・1枚のときと二桁の表示も実枚数に一致する',async({page})=>{
 const r=await page.evaluate(()=>[0,1,12].map(n=>{
  const cards=Array.from({length:n},()=>createCardFromBase('general_student','player'));
  const text=trashDetailCountText('player',cards,'枚数確認'),el=document.createElement('div');renderLogMessage(el,text);
  return el.textContent;
 }));expect(r).toEqual(['0枚','1枚','12枚']);
});

for(const side of ['player','opponent'])test(`${side}: 破壊した爆発する学生を復活し、再破壊しても1枚ずつ校外へ残す`,async({page})=>{
 const r=await page.evaluate(side=>{
  const own=state.players[side],other=state.players[oppositeSide(side)];
  for(const owner of ['player','opponent'])Object.assign(state.players[owner],{board:{teacher:null,seats:Array(9).fill(null)},trash:[],hand:[],life:20});
  state.recentBoardTrash=[];state.actionTurn=2;
  const token=makeBoardCard(createCardFromBase('exploding_student',side));token.lastDamageSource={baseId:'general_student'};own.board.seats[0]=token;
  destroyBoardCard({owner:side,zone:'seat',index:0},{reason:'体力0',showDestroyFeedback:false});
  const first={life:other.life,trash:own.trash.map(c=>c.baseId)};state.actionTurn=3;
  const restored=restoreRecentBoardCard(side),sameId=own.board.seats[0]?.instanceId===token.instanceId;
  destroyBoardCard({owner:side,zone:'seat',index:0},{reason:'体力0',showDestroyFeedback:false});
  return{first,restored,sameId,life:other.life,trash:own.trash.map(c=>c.baseId),vanished:!!own.trash[0]?.tokenVanished,
   directlyBuildable:DIRECT_DECK_CARD_IDS.has('exploding_student')};
 },side);
 expect(r).toEqual({first:{life:18,trash:['exploding_student']},restored:true,sameId:true,life:16,trash:['exploding_student'],vanished:false,directlyBuildable:false});
});
