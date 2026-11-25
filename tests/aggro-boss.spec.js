const {test, expect} = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const root = path.join(__dirname, '..');
const url = pathToFileURL(path.join(root, 'index.html')).href;
const text = '[超陽気]\n自分の「アグロ」とつく出席者が相手本体を攻撃するたび、ターン終了時まで、このカードの攻撃力を+1する。';
async function setup(page, side = 'player') {
 await page.goto(url);
 await page.evaluate(side => {
  startCardTest('aggro_boss'); scheduleOpponentAI = () => {};
  state.preBattleToken += 1000;
  Object.assign(state, {phase:'battle', currentSide:side, actionTurn:9, gameOver:false, gameWinner:null,
   testMode:false, environment:null, noAttackUntilActionTurn:0});
  Object.assign(state.training, {active:true, leftController:'ai', skipAnimations:true, speed:4});
  for (const owner of ['player','opponent']) Object.assign(state.players[owner], {
   life:20, will:10, maxWill:10, turnsTaken:5, hand:[], trash:[], late:[], originalDeckCounts:{},
   deck:Array.from({length:20},()=>createCardFromBase('general_student',owner)),
   board:{teacher:null,seats:Array(9).fill(null)}
  });
  window.put = (owner,index,id='aggro_boss') => {
   const c=makeBoardCard(createCardFromBase(id,owner)); c.playedOnTurn=0;
   state.players[owner].board.seats[index]=c; return c;
  };
  window.hit = async (owner,index,target=oppositeSide(owner)) => {
   state.selectedAttacker={owner,zone:'seat',index};
   await attackLifeForCurrentSide(target);
  };
 },side);
 await expect.poll(()=>page.evaluate(()=>battlePresentationBusy())).toBe(false);
}
test('本文・台帳・デッキ登録・管理ログ表示・並びを揃える', async ({page}) => {
 await page.goto(url);
 const result=await page.evaluate(()=>({base:CARD_BASES.aggro_boss,
  text:cardRulesText(createCardFromBase('aggro_boss','player')),
  deck:DIRECT_DECK_CARD_IDS.has('aggro_boss'),order:getDeckEditorIds('')}));
 expect(result.base).toMatchObject({name:'アグロボス',type:'student',category:'common',cost:3,attack:0,hp:2,keywords:['超陽気']});
 expect(result.text).toBe(text); expect(result.deck).toBe(true);
 const catalog=require('../server/card-catalog.json');
 expect(catalog.direct).toContain('aggro_boss'); expect(catalog.specialties.common).toContain('aggro_boss');
 expect(catalog.names.aggro_boss).toBe('アグロボス');
 expect(catalog.display.aggro_boss).toEqual({type:'student',cost:3,noCost:false,attack:0,hp:2});
 expect(catalog.deckOrder).toEqual(result.order);
 const raw=JSON.parse(fs.readFileSync(path.join(root,'card_rules.txt'),'utf8').split('\n')
  .find(l=>l.trimStart().startsWith('aggro_boss:')).trim().replace(/^[^:]+: /,'').replace(/,$/,''));
 const ledger=JSON.parse(fs.readFileSync(path.join(root,'カード管理台帳.html'),'utf8').match(/const CARDS = (\[.*\]);/)[1]);
 expect(ledger.find(c=>c.id==='aggro_boss')).toMatchObject({cost:3,attack:0,hp:2,effect:raw});
 expect(await page.evaluate(raw=>formatCardRulesDisplayText(createCardFromBase('aggro_boss','player'),raw),raw)).toBe(text);
});
for (const side of ['player','opponent']) {
 test(`${side}: 自身の初回攻撃は0から1になり、ダメージ前に反映する`, async ({page}) => {
  await setup(page,side);
  const result=await page.evaluate(async side=>{
   const boss=put(side,0); boss.playedOnTurn=state.actionTurn;
   await hit(side,0);
   return {attack:boss.attack,hp:boss.currentHp,enemyLife:state.players[oppositeSide(side)].life,
    buffs:boss.statBuffVisuals.map(e=>e.attack),used:cardAttacksUsedThisTurn(boss)};
  },side);
  expect(result).toEqual({attack:1,hp:2,enemyLife:19,buffs:[1],used:1});
 });
 test(`${side}: ボス2人と他のアグロ2人で7の追加打点になり、相手側と手札は反応しない`,async({page})=>{
  await setup(page,side);
  const result=await page.evaluate(async side=>{
   const boss=put(side,0),second=put(side,1),enemyBoss=put(oppositeSide(side),0);
   put(side,2,'aggro_king');put(side,3,'aggro_queen');
   const hand=createCardFromBase('aggro_boss',side);state.players[side].hand=[hand];
   await hit(side,2);await hit(side,3);
   const before=state.players[oppositeSide(side)].life;
   await hit(side,0);await hit(side,1);
   return {damage:before-state.players[oppositeSide(side)].life,attacks:[boss.attack,second.attack],
    enemy:enemyBoss.attack,hand:hand.attack};
  },side);
  expect(result).toEqual({damage:7,attacks:[4,4],enemy:0,hand:0});
 });
 test(`${side}: 注目で本体攻撃できず、出席者への攻撃とアグロ以外の攻撃は強化しない`,async({page})=>{
  await setup(page,side);
  const result=await page.evaluate(async side=>{
   const boss=put(side,0);put(side,1,'general_student');
   const guard=put(oppositeSide(side),0,'ae_female_student');
   await hit(side,0);
   const blocked={attack:boss.attack,used:cardAttacksUsedThisTurn(boss)};
   state.players[oppositeSide(side)].board.seats[0]=null;
   await hit(side,1);
   const normal=boss.attack;
   markCardAttackUsed(put(side,2,'aggro_king'));
   return {blocked,normal,cardAttack:boss.attack};
  },side);
  expect(result).toEqual({blocked:{attack:0,used:0},normal:0,cardAttack:0});
 });
 test(`${side}: 終了時は一時強化だけ消え、散歩と弱体化を保つ`,async({page})=>{
  await setup(page,side);
  const result=await page.evaluate(async side=>{
   const boss=put(side,0);
   applyPermanentStatBuff(boss,2,0,0,'アグロ散歩');
   await hit(side,0);
   const before=boss.attack;
   resolveEndTurnEffects(side);
   const after=boss.attack;
   state.actionTurn++;state.currentSide=side;resetCardAttackUsage(boss);
   await hit(side,0);
   return {before,after,next:boss.attack,hp:boss.currentHp,
    modifiers:boss.statModifiers.map(e=>e.source)};
  },side);
  expect(result).toEqual({before:3,after:2,next:3,hp:2,modifiers:['アグロ散歩','アグロボス']});
 });
}
test('後から出席したボスは過去の攻撃を遡って数えない',async({page})=>{
 await setup(page);
 const result=await page.evaluate(async()=>{
  put('player',0,'aggro_king');await hit('player',0);
  const boss=put('player',1);const before=boss.attack;
  await hit('player',1);return {before,after:boss.attack};
 });expect(result).toEqual({before:0,after:1});
});
test('継続効果無効中・効果のないコピーでは発動しない',async({page})=>{
 await setup(page);
 const result=await page.evaluate(()=>{
  const boss=put('player',0),copy=put('player',1);copy.generatedWithoutEffects=true;
  state.kashikashiActionTurn=state.actionTurn;markCardAttackUsed(boss,'opponent');
  const suppressed=[boss.attack,copy.attack];
  state.kashikashiActionTurn=null;resetCardAttackUsage(boss);markCardAttackUsed(boss,'opponent');
  return {suppressed,normal:[boss.attack,copy.attack]};
 });expect(result).toEqual({suppressed:[0,0],normal:[1,0]});
});
test('手札へ戻った場合も終了時に解除し、負の基礎攻撃力を消さない',async({page})=>{
 await setup(page);
 const result=await page.evaluate(()=>{
  const boss=put('player',0);applyPermanentStatBuff(boss,-2,0,0,'病');applyBoardAuras();
  markCardAttackUsed(boss,'opponent');const boosted=boss.attack;
  state.players.player.board.seats[0]=null;state.players.player.hand.push(boss);
  resolveEndTurnEffects('player');return {boosted,base:boss.baseAttack,attack:boss.attack,modifiers:boss.statModifiers.map(e=>e.source)};
 });expect(result).toEqual({boosted:0,base:-2,attack:0,modifiers:['病']});
});
test('アグロドーム下で追加出席したアグロも反応し、キングダムの強化は終了後も残る',async({page})=>{
 await setup(page);
 const result=await page.evaluate(async()=>{
  const boss=put('player',0);state.environment=makeBoardCard(createCardFromBase('aggro_dome','player'));
  const king=put('player',6,'aggro_king');king.playedOnTurn=state.actionTurn;applyBoardAuras();
  await hit('player',6);const dome=boss.attack;
  const queen=put('player',5,'aggro_queen');put('player',2,'aggro_student');
  state.environment=makeBoardCard(createCardFromBase('aggro_kingdom','player'));applyBoardAuras();
  const kingdom=boss.attack;resolveEndTurnEffects('player');return {dome,kingdom,after:boss.attack,hp:boss.maxHp};
 });expect(result).toEqual({dome:1,kingdom:3,after:2,hp:3});
});
for (const side of ['player','opponent']) test(`${side}: AIはボスを先に出し、他のアグロの後に攻撃する`,async({page})=>{
 await setup(page,side);
 const result=await page.evaluate(async side=>{
  state.players[side].hand=['aggro_princess','aggro_boss','aggro_boss'].map(id=>createCardFromBase(id,side));
  const first=side==='player'?findTrainingAiPlayMove(side):findAiPlayMove();
  const boss=put(side,0),king=put(side,1,'aggro_king');
  const order=aiOrderedAttackRefs(side).map(getBoardCardFromRef).map(c=>c.baseId);
  const predicted=aiBoardFaceDamage(side,{readyOnly:true}).guaranteed;
  if(side==='opponent')await aiAttackWithReadyCards();
  else {for(const ref of aiOrderedAttackRefs(side))await hit(side,ref.index);}
  return {first:first.card.baseId,order,predicted,damage:20-state.players[oppositeSide(side)].life};
 },side);
 expect(result).toEqual({first:'aggro_boss',order:['aggro_king','aggro_boss'],predicted:3,damage:3});
});
test('AIの次ターン予測は現在の一時強化を除き、複数ボスの連動を数える',async({page})=>{
 await setup(page);
 const result=await page.evaluate(()=>{
  const boss=put('opponent',0);put('opponent',1);put('opponent',2,'aggro_king');
  markCardAttackUsed(boss,'player');
  const before=JSON.stringify(state.players);
  const predicted=aiIncomingBoardDamage('player');
  return {predicted,unchanged:before===JSON.stringify(state.players)};
 });expect(result).toEqual({predicted:6,unchanged:true});
});
test('カード一覧からテストを開き、初期状態を書き換えず効果を試せる',async({page})=>{
 await page.goto(url);await page.locator('#homeNavDeckButton').click();
 await page.locator('[data-case-view="cards"]').click();await page.locator('#cardsCatalogSearch').fill('アグロボス');
 await page.locator('[data-catalog-card="aggro_boss"]').click();await page.locator('#cardTestStartButton').click();
 await page.evaluate(()=>{scheduleOpponentAI=()=>{};state.training.skipAnimations=true;});
 await expect.poll(()=>page.evaluate(()=>battlePresentationBusy())).toBe(false);
 await page.evaluate(()=>placeCardFromHand('player',state.players.player.hand.find(c=>c.baseId==='aggro_boss').instanceId,'seat','player',4,true));
 await expect.poll(()=>page.evaluate(()=>state.players.player.board.seats[4]?.baseId)).toBe('aggro_boss');
 await page.evaluate(async()=>{
  for(const index of [0,2,4]){state.selectedAttacker={owner:'player',zone:'seat',index};await attackLifeForCurrentSide('opponent');}
 });
 expect(await page.evaluate(()=>({life:state.players.opponent.life,attack:state.players.player.board.seats[4].attack,will:state.players.player.will})))
  .toEqual({life:15,attack:3,will:7});
});

test('戦意10でボス3枚とプリンセス1枚を使うと合計10ダメージで、攻撃権は増えない',async({page})=>{
 await setup(page);
 const result=await page.evaluate(async()=>{
  const own=state.players.player;own.hand=['aggro_boss','aggro_boss','aggro_boss','aggro_princess'].map(id=>createCardFromBase(id,'player'));
  for(const index of [0,1,2,3])placeCardFromHand('player',own.hand[0].instanceId,'seat','player',index,false);
  for(const index of [3,0,1,2])await hit('player',index);
  return {will:own.will,life:own.life,damage:20-state.players.opponent.life,
   attacks:[0,1,2].map(i=>cardAttacksUsedThisTurn(own.board.seats[i])),
   ready:[0,1,2].map(i=>canAttackSilently(own.board.seats[i]))};
 });expect(result).toEqual({will:0,life:19,damage:10,attacks:[1,1,1],ready:[false,false,false]});
});
