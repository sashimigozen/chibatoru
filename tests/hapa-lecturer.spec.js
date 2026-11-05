const {test,expect}=require('@playwright/test');
const fs=require('node:fs'),path=require('node:path'),{pathToFileURL}=require('node:url');
const url=pathToFileURL(path.join(__dirname,'../index.html')).href;
async function settle(p){await expect.poll(()=>p.evaluate(()=>!battlePresentationBusy()&&!fusionTasksBusy()),{timeout:20000}).toBe(true);}
async function start(p,id,ui=false){
 await p.setViewportSize({width:1440,height:900});await p.goto(url);
 if(ui){await p.locator('#homeNavDeckButton').click();await p.locator('[data-case-view="cards"]').click();await p.locator('#cardsCatalogSearch').fill(id==='hapa_english'?'Hapa英会話':'質問する講師');await p.locator(`[data-catalog-card="${id}"]`).click();await p.locator('#cardTestStartButton').click();}
 else await p.evaluate(id=>startCardTest(id),id);
 await p.evaluate(()=>{scheduleOpponentAI=()=>{};state.training.skipAnimations=true;});await settle(p);
}
async function useHapa(p){await p.evaluate(()=>beginItemUse(state.players.player.hand.find(c=>c.baseId==='hapa_english')));await settle(p);}
async function playLecturer(p){await p.locator('#playerHand [data-base-id="questioning_lecturer"]').first().click();await p.locator('.slot[data-owner="player"][data-zone="teacher"]').click();}
async function chooseMove(p,index){await expect.poll(()=>p.evaluate(()=>state.pendingCardChoice?.context?.kind)).toBe('lecturer_move');await expect.poll(()=>p.evaluate(()=>battlePresentationBusy({ignoreFusionTasks:true}))).toBe(false);if(index!==null)await p.locator(`.board-card[data-owner="opponent"][data-zone="seat"][data-index="${index}"]`).click();await p.locator('#itemTargetConfirmButton').click();await settle(p);}

test('2枚の定義・完成本文・デッキ登録・管理ログ・台帳が一致',async({page:p})=>{
 await start(p,'hapa_english');const rows=await p.evaluate(()=>['hapa_english','questioning_lecturer'].map(id=>({id,base:CARD_BASES[id],direct:DIRECT_DECK_CARD_IDS.has(id),text:cardRulesText(createCardFromBase(id,'player'))})));
 const catalog=require('../server/card-catalog.json'),ledger=JSON.parse(fs.readFileSync(path.join(__dirname,'../カード管理台帳.html'),'utf8').match(/const CARDS = (\[.*\]);/)[1]);
 expect(rows[0].base).toMatchObject({name:'Hapa英会話',type:'item',cost:2,attack:0,hp:0,category:'common'});expect(rows[1].base).toMatchObject({name:'質問する講師',type:'teacher',cost:4,attack:1,hp:3,category:'common'});
 for(const row of rows){const card=ledger.find(c=>c.id===row.id);const raw=JSON.parse(fs.readFileSync(path.join(__dirname,'../card_rules.txt'),'utf8').split('\n').find(l=>l.trimStart().startsWith(row.id+':')).trim().replace(/^[^:]+: /,'').replace(/,$/,''));expect(raw).toBe(card.effect);expect(row.text).toBe(await p.evaluate(({id,raw})=>formatCardRulesDisplayText(createCardFromBase(id,'player'),raw),{id:row.id,raw}));expect(row.direct).toBe(true);expect(catalog.names[row.id]).toBe(row.base.name);expect(catalog.display[row.id]).toMatchObject({type:row.base.type,cost:row.base.cost,attack:row.base.attack,hp:row.base.hp});expect(catalog.specialties.common).toContain(row.id);expect(await p.evaluate(id=>UPDATE_HISTORY[0].changes.find(c=>c.title===CARD_BASES[id].name).after.split('\n').slice(1).join('\n'),row.id)).toBe(raw);}
 expect(catalog.deckOrder).toEqual(await p.evaluate(()=>getDeckEditorIds('')));
});

test('Hapaの実カードテストで手札の見た目を変えず、体力0も残して出席時に判明',async({page:p})=>{
 await start(p,'hapa_english',true);const victim=await p.evaluate(()=>state.players.opponent.hand[0].instanceId);await useHapa(p);
 expect(await p.evaluate(()=>({count:state.players.opponent.hand.length,hp:state.players.opponent.hand[0].currentHp,hidden:state.players.opponent.hand[0].hapaHandDamage,trash:state.players.opponent.trash.length}))).toEqual({count:1,hp:2,hidden:2,trash:0});
 const own=await p.evaluate(()=>{const c=state.players.player.hand.find(c=>c.baseId==='suit_student');return {hp:displayedCardHp(c),notes:handCardEffectNotes(c),payload:JSON.stringify(cardRevealPayload(c))};});expect(own.hp).toBe(1);expect(own.notes).toEqual([]);expect(own.payload).not.toContain('hapaHandDamage');
 await p.locator('#playerHand [data-base-id="suit_student"]').click();const deck=await p.evaluate(()=>state.players.player.deck.length);await p.locator('#playerSeatGrid .slot[data-index="4"]').click();await settle(p);
 expect(await p.evaluate(()=>({deck:state.players.player.deck.length,field:listBoardRefs('player').length,trash:state.players.player.trash.map(c=>c.baseId)}))).toEqual({deck:deck-1,field:0,trash:['hapa_english','suit_student']});
 expect(await p.evaluate(()=>state.log.some(l=>l.includes('スーツを着た学生')&&l.includes('Hapa英会話による2')))).toBe(true);
 // The other player still cannot know until that player's card actually attends.
 expect(await p.evaluate(id=>state.players.opponent.hand.find(c=>c.instanceId===id)?.currentHp,victim)).toBe(2);
});

for(const kind of ['empty','items','zero'])test(`Hapaは対象不足・体力0でも通常使用でき、秘密の結果をログに漏らさない ${kind}`,async({page:p})=>{
 await start(p,'hapa_english');await p.evaluate(kind=>{state.players.opponent.hand=kind==='empty'?[]:kind==='items'?['ruler','classroom'].map(id=>createCardFromBase(id,'opponent')):[{...createCardFromBase('general_student','opponent'),hapaHandDamage:4}];},kind);const will=await p.evaluate(()=>state.players.player.will);await useHapa(p);expect(await p.evaluate(()=>state.players.player.will)).toBe(will-2);
 const r=await p.evaluate(()=>({hand:state.players.opponent.hand.map(c=>({id:c.baseId,hp:c.currentHp,damage:c.hapaHandDamage})),log:state.log[0]}));expect(r.log).not.toContain('一般学生');if(kind==='zero')expect(r.hand).toEqual([{id:'general_student',hp:2,damage:6}]);
});

test('手札ダメージで体力0のエンドレストーカーも効果を発動してから破壊',async({page:p})=>{
 await start(p,'endless_talker');await p.evaluate(()=>{state.players.player.hand.find(c=>c.baseId==='endless_talker').hapaHandDamage=2;playCard(state.players.player.hand.find(c=>c.baseId==='endless_talker').instanceId,'seat','player',2);});await settle(p);
 expect(await p.evaluate(()=>[state.players.player.maxWill,state.players.opponent.maxWill,listBoardRefs('player').length,listBoardRefs('opponent').length,state.players.player.trash.some(c=>c.baseId==='endless_talker')])).toEqual([3,3,0,0,true]);
});

test('体力0でも対象選択を完了してから破壊、単位の体力強化も先に反映',async({page:p})=>{
 await start(p,'hapa_english');await p.evaluate(()=>{state.players.player.hand=[{...createCardFromBase('short_sleeve_student','player'),hapaHandDamage:2}];state.players.opponent.board.seats[0]=makeBoardCard(createCardFromBase('general_student','opponent'));playCard(state.players.player.hand[0].instanceId,'seat','player',4);});await settle(p);
 expect(await p.evaluate(()=>[listBoardRefs('player').length,listBoardRefs('opponent').length,state.players.player.pointScore])).toEqual([0,0,1]);
 await start(p,'hapa_english');await p.evaluate(()=>{state.players.player.pointScore=10;state.players.player.pointSystemActive=true;state.players.player.hand=[{...createCardFromBase('long_sleeve_student','player'),hapaHandDamage:2}];playCard(state.players.player.hand[0].instanceId,'seat','player',4);});await settle(p);expect(await p.evaluate(()=>[state.players.player.board.seats[4].currentHp,state.players.player.board.seats[4].maxHp])).toEqual([4,6]);
});

test('非公開ダメージを受けた進化カードも進化時効果の後に破壊',async({page:p})=>{
 await start(p,'hapa_english');await p.evaluate(()=>{state.players.player.hand=[{...createCardFromBase('dark_yuta','player'),hapaHandDamage:10}];const base=makeBoardCard(createCardFromBase('yuta','player'));base.playedOnTurn=0;state.players.player.board.seats[4]=base;playCard(state.players.player.hand[0].instanceId,'seat','player',4);});
 await expect.poll(()=>p.evaluate(()=>state.players.player.hand.some(c=>c.baseId==='yuta')),{timeout:15000}).toBe(true);await settle(p);expect(await p.evaluate(()=>listBoardRefs('player').length)).toBe(0);
});


test('体力0の進化カードも時間差の10回効果を終えてから破壊',async({page:p})=>{
 await start(p,'hapa_english');await p.evaluate(()=>{state.players.player.hand=[{...createCardFromBase('demon_a_plus','player'),hapaHandDamage:20}];const base=makeBoardCard(createCardFromBase('bird_a','player'));base.playedOnTurn=0;state.players.player.board.teacher=base;state.players.opponent.board={teacher:null,seats:Array(9).fill(null)};const victim=makeBoardCard(createCardFromBase('strong_student','opponent'));applyPermanentStatBuff(victim,0,20,0,"試験");state.players.opponent.board.seats[0]=victim;playCard(state.players.player.hand[0].instanceId,'teacher','player',null);});
 await expect.poll(()=>p.evaluate(()=>state.players.player.trash.some(c=>c.baseId==='demon_a_plus')),{timeout:20000}).toBe(true);await settle(p);expect(await p.evaluate(()=>state.log.filter(l=>l.includes('連続攻撃')).length)).toBe(10);expect(await p.evaluate(()=>state.players.player.board.teacher)).toBe(null);
});

test('質問する講師の実カードテストで盤面から移動し、陽気で講義して1枚生成',async({page:p})=>{
 const errors=[];p.on('pageerror',e=>errors.push(e.message));await start(p,'questioning_lecturer',true);await playLecturer(p);await chooseMove(p,0);
 expect(await p.evaluate(()=>({target:state.players.opponent.board.teacher.baseId,attack:canAttackSilently(state.players.player.board.teacher),jolly:hasKeyword(state.players.player.board.teacher,'陽気'),lecture:canTeacherChooseLecture({owner:'player',zone:'teacher',index:null}),count:teacherLectureDamage('player',state.players.player.board.teacher)}))).toEqual({target:'general_student',attack:false,jolly:true,lecture:true,count:3});
 await p.locator('.slot[data-owner="player"][data-zone="teacher"] .board-card').click();await expect(p.locator('#teacherAttackChoiceButton')).toBeDisabled();await expect(p.locator('#teacherLectureChoiceButton')).toBeEnabled();await p.locator('#teacherLectureChoiceButton').click();await settle(p);
 expect(await p.evaluate(()=>({hand:state.players.player.hand.filter(c=>c.baseId==='hapa_english').length,teacher:state.players.opponent.board.teacher,used:cardAttacksUsedThisTurn(state.players.player.board.teacher)}))).toEqual({hand:2,teacher:null,used:1});expect(errors).toEqual([]);await p.screenshot({path:test.info().outputPath('questioning-lecturer.png')});
});

test('移動しない選択・教卓が埋まった場合・効果出席・複数マスの除外',async({page:p})=>{
 await start(p,'questioning_lecturer');await playLecturer(p);await chooseMove(p,null);expect(await p.evaluate(()=>state.players.opponent.board.teacher)).toBe(null);expect(await p.evaluate(()=>hasKeyword(state.players.player.board.teacher,'陽気'))).toBe(false);
 await start(p,'questioning_lecturer');await p.evaluate(()=>{const c=makeBoardCard(createCardFromBase('two_achievers','opponent'));placeMultiSeatCard('opponent',0,c);state.players.opponent.board.seats[6]=makeBoardCard(createCardFromBase('acting_out_man_2','opponent'));});
 expect(await p.evaluate(()=>questioningLecturerMoveCandidates('player').map(e=>e.card.baseId))).toEqual(['strong_student']);
 await start(p,'questioning_lecturer');await p.evaluate(()=>{attendCard('player',makeBoardCard(createCardFromBase('questioning_lecturer','player')),'teacher',null,{attendanceSource:ATTENDANCE_SOURCE.GENERATED});});await settle(p);expect(await p.evaluate(()=>state.pendingCardChoice)).toBe(null);expect(await p.evaluate(()=>state.players.opponent.board.teacher)).toBe(null);
});

for(const target of ['ta_killer','earphones','suit_student','on_demand_business'])test(`特殊講義でも既存の講義対策を尊重 ${target}`,async({page:p})=>{
 await start(p,'questioning_lecturer');const r=await p.evaluate(target=>{
  const c=makeBoardCard(createCardFromBase(target==='earphones'||target==='on_demand_business'?'general_student':target,'opponent'));state.players.opponent.board.teacher=c;
  if(target==='earphones')attachEarphones(c,createCardFromBase('earphones','opponent'));
  if(target==='on_demand_business')state.environment=makeBoardCard(createCardFromBase('on_demand_business','player'));
  state.players.player.board.teacher=makeBoardCard(createCardFromBase('questioning_lecturer','player'));
  const before=state.players.player.hand.filter(c=>c.baseId==='hapa_english').length;
  performTeacherLecture('player',{owner:'player',zone:'teacher',index:null});
  return {hp:c.currentHp,beforeHp:c.hp,exists:!!state.players.opponent.board.teacher,count:state.players.player.hand.filter(c=>c.baseId==='hapa_english').length-before};
 },target);expect(r.exists).toBe(true);expect(r.hp).toBe(r.beforeHp);expect(r.count).toBe(0);
});

test('トークンの撃破は生成、生き残る蘇生は生成せず、講義人数は複数マスでも1人',async({page:p})=>{
 await start(p,'questioning_lecturer');const r=await p.evaluate(()=>{
  const own=state.players.player;own.board.teacher=makeBoardCard(createCardFromBase('questioning_lecturer','player'));
  const enemy=state.players.opponent;enemy.board={teacher:makeBoardCard(createCardFromBase('extra_student','opponent')),seats:Array(9).fill(null)};placeMultiSeatCard('opponent',0,makeBoardCard(createCardFromBase('two_achievers','opponent')));
  const damage=teacherLectureDamage('player',own.board.teacher),n=own.hand.length;resolveTeacherLectureEffect('player',own.board.teacher);const generated=own.hand.length-n;
  enemy.board.teacher=makeBoardCard(createCardFromBase('rebirth_student','opponent'));enemy.board.teacher.currentHp=1;const m=own.hand.length;resolveTeacherLectureEffect('player',own.board.teacher);
  return {damage,generated,rebirth:enemy.board.teacher?.baseId,extra:own.hand.length-m};
 });expect(r).toEqual({damage:2,generated:1,rebirth:'rebirth_student',extra:0});
});

test('移動は出席時効果や行動権を再発生させず、AIは教卓と講義を使う',async({page:p})=>{
 await start(p,'questioning_lecturer');await p.evaluate(()=>{state.players.opponent.board.seats[0]=makeBoardCard(createCardFromBase('suit_student','opponent'));state.players.opponent.board.seats[0].attacksUsedThisTurn=1;state.players.opponent.board.seats[0].hasAttacked=true;});const deck=await p.evaluate(()=>state.players.opponent.deck.length);await playLecturer(p);await chooseMove(p,0);expect(await p.evaluate(()=>state.players.opponent.deck.length)).toBe(deck);expect(await p.evaluate(()=>cardAttacksUsedThisTurn(state.players.opponent.board.teacher))).toBe(1);
 await start(p,'questioning_lecturer');await p.evaluate(()=>{state.currentSide='opponent';const c=createCardFromBase('questioning_lecturer','opponent');state.players.opponent.board={teacher:null,seats:Array(9).fill(null)};state.players.opponent.hand=[c];state.players.player.board={teacher:null,seats:Array(9).fill(null)};state.players.player.board.seats[0]=makeBoardCard(createCardFromBase('general_student','player'));state.players.player.board.seats[4]=makeBoardCard(createCardFromBase('general_student','player'));state.players.opponent.will=10;const move=findAiPlayMove();if(move?.zone!=='teacher')throw new Error('AI did not choose lectern');placeCardFromHand('opponent',c.instanceId,move.zone,'opponent',move.index);});await settle(p);
 expect(await p.evaluate(()=>shouldAiUseLecture({owner:'opponent',zone:'teacher',index:null},state.players.opponent.board.teacher,'opponent'))).toBe(true);expect(await p.evaluate(()=>state.players.player.board.teacher?.baseId)).toBe('general_student');
});
