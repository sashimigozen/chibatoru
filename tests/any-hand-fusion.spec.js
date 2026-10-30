const {test,expect}=require('@playwright/test');
const {pathToFileURL}=require('node:url');const path=require('node:path');
const url=pathToFileURL(path.join(__dirname,'../index.html')).href;
const ids=['tomoyo_mou','rear_queen','illegal_cafeteria','shukii','past_campus','chugidesu','exploding_student'];
async function settle(p){await expect.poll(()=>p.evaluate(()=>fusionTasksBusy()),{timeout:15000}).toBe(false);}
async function choose(p,n=1){await expect.poll(()=>p.evaluate(()=>!!state.pendingCardChoice)).toBe(true);await p.evaluate(n=>{for(const c of state.pendingCardChoice.cards.slice(0,n))toggleCardChoiceCard(c.instanceId);confirmCardChoiceSelection();},n);}
test.beforeEach(async({page})=>{await page.goto(url);await page.evaluate(()=>{startCardTest('chugidesu');scheduleOpponentAI=()=>{};state.training.skipAnimations=true;state.environment=null;state.phase='battle';state.currentSide='player';for(const side of ['player','opponent'])Object.assign(state.players[side],{board:{seats:Array(9).fill(null),teacher:null},hand:[],deck:[],trash:[],late:[],life:10,will:10,maxWill:10});});});
test('7枚の定義、デッキ登録と本文',async({page})=>{expect(await page.evaluate(ids=>ids.map(id=>[id,DIRECT_DECK_CARD_IDS.has(id),CARD_BASES[id].type,CARD_BASES[id].cost,cardRulesText(createCardFromBase(id,'player'))]),ids)).toEqual(expect.arrayContaining([['exploding_student',false,'student',2,expect.stringContaining('[融合]\n')],['rear_queen',true,'student',4,expect.any(String)],['illegal_cafeteria',true,'item',3,expect.any(String)]]));});
test('2枚融合で解禁し、左右に1人出席、分解は1回',async({page})=>{
 expect(await page.evaluate(()=>{const p=state.players.player,c=createCardFromBase('chugidesu','player');p.hand=[c,createCardFromBase('ruler','player'),createCardFromBase('general_student','player')];p.deck=[createCardFromBase('general_student','player'),createCardFromBase('ruler','player')];const before=placeCardFromHand('player',c.instanceId,'seat','player',4,false);fuseAnyHandCards('player',c.instanceId,[p.hand[1].instanceId],false);const middle=placeCardFromHand('player',c.instanceId,'seat','player',4,false);fuseAnyHandCards('player',c.instanceId,[p.hand[1].instanceId],false);const after=placeCardFromHand('player',c.instanceId,'seat','player',4,true);return[before,middle,after];})).toEqual([false,false,true]);
 await expect.poll(()=>page.evaluate(()=>!!state.pendingCopiedCard)).toBe(true);
 await page.evaluate(()=>placePendingCopiedCardForSide('player','seat','player',3));await settle(page);expect(await page.evaluate(()=>[state.players.player.hand.length,state.players.player.life,state.players.player.board.seats[3]?.baseId])).toEqual([0,10,'exploding_student']);
 expect(await page.evaluate(()=>{destroyBoardCard({owner:'player',zone:'seat',index:4});return state.players.player.trash.map(c=>c.baseId).sort();})).toEqual(['chugidesu','general_student','ruler']);
});
for(const death of [true,false])test(`爆発は破壊時のみ、効果出席は融合不要 ${death}`,async({page})=>{
 expect(await page.evaluate(death=>{const c=makeBoardCard(createCardFromBase('exploding_student','player'));attendCard('player',c,'seat',4,{attendanceSource:ATTENDANCE_SOURCE.GENERATED});const jolly=hasKeyword(c,'陽気');destroyBoardCard({owner:'player',zone:'seat',index:4},{isDestruction:death});return[jolly,state.players.opponent.life,state.players.player.trash.length];},death)).toEqual([true,death?8:10,0]);
});
for(const [will,materialCount,expected] of [[4,0,2],[4,1,2],[4,3,2],[8,0,4],[8,5,4]])test(`友よ、もうは素材不足でも固定人数 ${will}/${materialCount}`,async({page})=>{
 await page.evaluate(({will,materialCount})=>{const p=state.players.opponent;state.currentSide='opponent';p.will=will;p.hand=[createCardFromBase('tomoyo_mou','opponent'),...Array.from({length:materialCount},(_,i)=>createCardFromBase(i?'strong_student':'general_student','opponent'))];castImmediateItem('opponent',p.hand[0],false);},{will,materialCount});await settle(page);
 expect(await page.evaluate(()=>[listBoardRefs('opponent').length,state.players.opponent.will,state.players.opponent.hand.length])).toEqual([expected,0,Math.max(0,materialCount-expected)]);
});
test('後ろにいるクイーンは手札から融合して出席、左右のみから選ぶ',async({page})=>{
 await page.evaluate(()=>{const p=state.players.player,c=createCardFromBase('rear_queen','player');p.hand=[c,createCardFromBase('ruler','player'),createCardFromBase('general_student','player')];fuseAnyHandCards('player',c.instanceId,p.hand.slice(1).map(c=>c.instanceId),false);placeCardFromHand('player',c.instanceId,'seat','player',4,false);});await expect.poll(()=>page.evaluate(()=>!!state.pendingCopiedCard)).toBe(true);
 expect(await page.evaluate(()=>[isPendingCopiedCardPlacementLegal('player','seat','player',0),isPendingCopiedCardPlacementLegal('player','seat','player',3),isPendingCopiedCardPlacementLegal('player','seat','player',5)])).toEqual([false,true,true]);
 await page.evaluate(()=>placePendingCopiedCardForSide('player','seat','player',3));await settle(page);expect(await page.evaluate(()=>state.players.player.board.seats[3]?.baseId)).toBe('exploding_student');
});
test('無法の食堂はデッキの食堂1枚だけ軽減',async({page})=>{expect(await page.evaluate(()=>{const p=state.players.player,c=createCardFromBase('illegal_cafeteria','player');p.hand=[c,createCardFromBase('cafeteria','player')];p.deck=['cafeteria','cafeteria','hearty_grandma'].map(id=>createCardFromBase(id,'player'));castImmediateItem('player',c,false);return[p.hand[0].cost,...p.deck.map(c=>c.cost).sort()];})).toEqual([2,1,2,3]);});
test('しゅきーは選んだ手札を捨てて進化を1枚引く',async({page})=>{
 await page.evaluate(()=>{const p=state.players.player,c=createCardFromBase('shukii','player');p.hand=[c,createCardFromBase('ruler','player')];p.deck=['general_student','dark_yuta'].map(id=>createCardFromBase(id,'player'));castImmediateItem('player',c,false);});await choose(page);await settle(page);expect(await page.evaluate(()=>state.players.player.hand.map(c=>c.baseId))).toEqual(['dark_yuta']);
});
for(const count of [3,4])test(`過去のキャンパスは手番終了側だけ補充 ${count}`,async({page})=>{expect(await page.evaluate(count=>{state.environment=makeBoardCard(createCardFromBase('past_campus','player'));for(const side of ['player','opponent']){state.players[side].hand=Array.from({length:count},()=>createCardFromBase('general_student',side));state.players[side].deck=Array.from({length:8},()=>createCardFromBase('ruler',side));}resolveEnvironmentEndTurnEffects('player');return ['player','opponent'].map(side=>state.players[side].hand.length);},count)).toEqual([count===3?5:4,count]);});
for(const id of ids)test(`カードテストの開始状態と主要効果 ${id}`,async({page})=>{
 if(id==='exploding_student'){await page.evaluate(()=>{startCardTest('exploding_student');scheduleOpponentAI=()=>{};state.training.skipAnimations=true;});}else{await page.goto(url);await page.locator('#homeNavDeckButton').click();await page.locator('[data-case-view="cards"]').click();await page.locator('#cardsCatalogSearch').fill(await page.evaluate(id=>CARD_BASES[id].name,id));await page.locator(`[data-catalog-card="${id}"]`).click();await page.locator('#cardTestStartButton').click();}await page.evaluate(()=>{scheduleOpponentAI=()=>{};state.training.skipAnimations=true;});await expect.poll(()=>page.evaluate(()=>battlePresentationBusy())).toBe(false);
 expect(await page.evaluate(id=>state.players.player.hand.some(c=>c.baseId===id),id)).toBe(true);
 if(id==='chugidesu'||id==='exploding_student'||id==='rear_queen'){
  await page.evaluate(id=>showBattleCardPreview(state.players.player.hand.find(c=>c.baseId===id)),id);await page.locator('[data-preview-any-hand-fusion]').click();await choose(page,id==='exploding_student'?1:2);
  await page.evaluate(id=>{const c=state.players.player.hand.find(c=>c.baseId===id);placeCardFromHand('player',c.instanceId,'seat','player',4,true);},id);
 }else await page.evaluate(id=>{const c=state.players.player.hand.find(c=>c.baseId===id);if(c.type==='item')beginItemUse(c);else placeCardFromHand('player',c.instanceId,'environment',null,null,true);},id);
 if(id==='shukii')await choose(page);
 if(id==='rear_queen'||id==='chugidesu'||id==='tomoyo_mou')for(let i=0;i<(id==='tomoyo_mou'?2:1);i++){await expect.poll(()=>page.evaluate(()=>!!state.pendingCopiedCard)).toBe(true);await page.evaluate(()=>{const i=PLAYER_SEAT_ORDER.find(i=>isPendingCopiedCardPlacementLegal('player','seat','player',i));placePendingCopiedCardForSide('player','seat','player',i);});}
 await settle(page);expect(await page.evaluate(()=>state.pendingCardChoice||state.pendingCopiedCard)).toBeFalsy();
});
for(const id of ['tomoyo_mou','rear_queen','chugidesu'])test(`AIが融合と生成を処理してターンを返す ${id}`,async({page})=>{
 await page.evaluate(id=>{state.testMode=false;state.currentSide='opponent';state.aiThinking=true;const p=state.players.opponent;p.will=id==='tomoyo_mou'?4:8;p.maxWill=p.will;p.hand=[id,...(id!=='tomoyo_mou'?['ruler','general_student']:['general_student'])].map(id=>createCardFromBase(id,'opponent'));for(const side of ['player','opponent'])state.players[side].deck=Array.from({length:8},()=>createCardFromBase('general_student',side));runOpponentAI();},id);
 await expect.poll(()=>page.evaluate(()=>state.currentSide),{timeout:15000}).toBe('player');expect(await page.evaluate(()=>[fusionTasksBusy(),!!state.pendingCardChoice,!!state.pendingCopiedCard])).toEqual([false,false,false]);
});
test('高負荷も素材にでき、素材の提出は発動せず分解される',async({page})=>{
 expect(await page.evaluate(()=>{const p=state.players.player,c=createCardFromBase('rear_queen','player'),m=createCardFromBase('wonton_greeting','player');m.handLoadLevel=2;p.hand=[c,m];fuseAnyHandCards('player',c.instanceId,[m.instanceId],false);moveHandCardToTrash('player',c,{effectDiscard:true});return[p.hand.length,p.trash.map(c=>c.baseId).sort(),p.submissionCounters?.['万豚記カウント']||0];})).toEqual([0,['rear_queen','wonton_greeting'],0]);
});
test('自動融合は低戦意順で、使用したカード自身は素材にしない',async({page})=>{
 await page.evaluate(()=>{state.currentSide='opponent';const p=state.players.opponent;p.will=4;p.hand=['tomoyo_mou','strong_student','general_student','ruler'].map(id=>createCardFromBase(id,'opponent'));castImmediateItem('opponent',p.hand[0],false);});await settle(page);expect(await page.evaluate(()=>state.players.opponent.hand.map(c=>c.baseId))).toEqual(['strong_student']);
});

test('コピーした融合状態は元の素材を消費せず独立し、通常の校外送りでも分解する',async({page})=>{
 expect(await page.evaluate(()=>{const p=state.players.player,c=createCardFromBase('rear_queen','player');p.hand=[c,createCardFromBase('ruler','player')];fuseAnyHandCards('player',c.instanceId,[p.hand[1].instanceId],false);const copy=copyHorseFusionProgress(c,createCardFromBase(c.baseId,'player'));const originalId=c.handFusionStored[0].instanceId,copyId=copy.handFusionStored[0].instanceId;moveToTrash('player',copy,{sourceZone:'generated'});return[handFusionReady(copy),handFusionReady(c),originalId!==copyId,p.hand.length,p.trash.map(c=>c.baseId).sort()];})).toEqual([false,false,true,1,['rear_queen','ruler']]);
});
test('融合素材の詳細と手札の印、本文と台帳を同期する',async({page})=>{
 const fs=require('node:fs');const ledger=JSON.parse(fs.readFileSync(path.join(__dirname,'../カード管理台帳.html'),'utf8').match(/const CARDS = (\[[^\r\n]*\]);/)[1]);
 for(const id of ids){const entry=ledger.find(c=>c.id===id);expect(await page.evaluate(({id,text})=>cardRulesText(createCardFromBase(id,'player'))===formatCardRulesDisplayText(createCardFromBase(id,'player'),text),{id,text:entry.effect})).toBe(true);}
 await page.evaluate(()=>{const p=state.players.player,c=createCardFromBase('rear_queen','player');p.hand=[c,createCardFromBase('ruler','player')];fuseAnyHandCards('player',c.instanceId,[p.hand[1].instanceId]);showBattleCardPreview(c);});
 await expect(page.locator('#battleCardPreview')).toContainText('融合済み：定規');
});

test('融合で生成されたカードも素材にでき、校外で内側の素材まで分解する',async({page})=>{
 expect(await page.evaluate(()=>{const p=state.players.player,c=createCardFromBase('rear_queen','player');p.hand=[c,createCardFromBase('umaibo','player')];fuseAnyHandCards('player',c.instanceId,[p.hand[1].instanceId],false);moveHandCardToTrash('player',c,{effectDiscard:true});return p.trash.map(c=>c.baseId).sort();})).toEqual(['fusion_maibo','fusion_uma','rear_queen']);
});
