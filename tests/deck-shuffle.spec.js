const { test, expect } = require('@playwright/test');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const url = pathToFileURL(path.join(__dirname, '..', 'index.html')).href;
test.setTimeout(35000);
async function setup(page, size={width:1440,height:900}) {
  await page.setViewportSize(size); await page.goto(url);
  await page.evaluate(() => {
    startCardTest('general_student'); scheduleOpponentAI=()=>{}; state.training.skipAnimations=true;
    for(const side of ['player','opponent']) {
      Object.assign(state.players[side], {hand:[],trash:[],board:{teacher:null,seats:Array(9).fill(null)},
        deck:Array.from({length:20},()=>createCardFromBase('general_student',side))});
    }
    render();
  });
  await expect.poll(()=>page.evaluate(()=>battlePresentationBusy())).toBe(false);
  await page.evaluate(()=>{state.deckVisualEvents=[];state.training.skipAnimations=false;render();
    window.deckStages=[];
    new MutationObserver(()=>{
      for(const e of document.querySelectorAll('.deck-flight,.draw-flight')){
        const phase=e.dataset.deckPhase||e.dataset.drawPhase;if(!phase)continue;
        if(window.deckStages.at(-1)!==phase)window.deckStages.push(phase);
      }
    }).observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['data-deck-phase','data-draw-phase']});
  });
}
async function settled(page) {await expect.poll(()=>page.evaluate(()=>battlePresentationBusy()),{timeout:20000}).toBe(false);}
async function centeredCards(preview,size) {
 const rects=await preview.evaluateAll(nodes=>nodes.map(n=>{const r=n.getBoundingClientRect();return{x:r.x,y:r.y,right:r.right,bottom:r.bottom};}));
 const left=Math.min(...rects.map(r=>r.x)),right=Math.max(...rects.map(r=>r.right));
 const top=Math.min(...rects.map(r=>r.y)),bottom=Math.max(...rects.map(r=>r.bottom));
 expect(Math.abs((left+right)/2-size.width/2)).toBeLessThan(1);
 expect(Math.abs((top+bottom)/2-size.height/2)).toBeLessThan(1);
 const rows=new Map();for(const r of rects){const key=Math.round(r.y);rows.set(key,[...(rows.get(key)||[]),r]);}
 for(const row of rows.values())expect(Math.abs((Math.min(...row.map(r=>r.x))+Math.max(...row.map(r=>r.right)))/2-size.width/2)).toBeLessThan(1);
}


test('通常ドローと上から校外へ送る処理は順番を維持し、シャッフルしない',async({page})=>{
 await setup(page);const r=await page.evaluate(()=>{
   const ids=state.players.player.deck.map(c=>c.instanceId);drawOne('player',false);moveTopDeckCardsToTrash('player',2);
   return {ids,hand:state.players.player.hand.map(c=>c.instanceId),trash:state.players.player.trash.map(c=>c.instanceId),deck:state.players.player.deck.map(c=>c.instanceId),events:state.deckVisualEvents.map(e=>e.type)};
 });expect(r.hand).toEqual(r.ids.slice(0,1));expect(r.trash).toEqual(r.ids.slice(1,3));expect(r.deck).toEqual(r.ids.slice(3));expect(r.events).not.toContain('shuffle');
});

test('下に置く指定は、既存の順番と置いたカードの順番を保つ',async({page})=>{
 await setup(page);const r=await page.evaluate(()=>{
   const ids=state.players.player.deck.map(c=>c.instanceId);resolveTripleEnemyEffect('player',createCardFromBase('triple_enemy','player'));
   return {ids,deck:state.players.player.deck.map(c=>c.instanceId),types:pendingAnimations.map(e=>e.type)};
 });expect(r.deck).toEqual([...r.ids.slice(3),...r.ids.slice(0,3)]);expect(r.types).toEqual(['deck-return']);
});

for(const side of ['player','opponent'])test(`${side}の手札を戻す→シャッフル→ドローの順に表示し、非公開のカード名を出さない`,async({page})=>{
 await setup(page);await page.evaluate(side=>{state.players[side].hand=[createCardFromBase('dark_yuta',side),createCardFromBase('yuta',side)];render();},side);await settled(page);
 await page.evaluate(side=>{window.deckStages=[];redrawHand(side);render();},side);
 const returns=page.locator('.deck-flight[data-deck-phase="deck-return"]');await expect(returns).toHaveCount(2);
 expect(await returns.first().innerHTML()).not.toContain('U太');await expect(returns.locator('.deck-flight-face')).toHaveCount(0);
 expect(await page.evaluate(()=>battleNewActionBlocked())).toBe(true);
 await expect(page.locator('.deck-flight[data-deck-phase="shuffle"]')).toHaveCount(3);
 await page.waitForFunction(()=>document.querySelector('.draw-flight')?.dataset.drawPhase==='moving');
 await settled(page);const phases=await page.evaluate(()=>window.deckStages);
 expect(phases.indexOf('shuffle')).toBeGreaterThan(phases.indexOf('deck-return'));
 expect(phases.indexOf('moving')).toBeGreaterThan(phases.indexOf('shuffle'));
 expect(await page.evaluate(side=>state.players[side].hand.length,side)).toBe(2);
});

for(const size of [{width:1440,height:900},{width:390,height:844}])test(`生成10枚をすべて表で見せ、山札へ入れてから混ぜる ${size.width}`,async({page})=>{
 await setup(page,size);await page.evaluate(()=>{generateCardsIntoDeck('player','scary_question',10);render();});
 const preview=page.locator('.deck-flight[data-deck-phase="deck-generate"]');await expect(preview).toHaveCount(10);
 await expect(preview.first()).toContainText('怖い質問');await expect(preview.locator('.deck-flight-count')).toHaveCount(0);
 await page.waitForTimeout(260);const rects=await preview.evaluateAll(nodes=>nodes.map(n=>{const r=n.getBoundingClientRect();return{x:r.x,y:r.y,right:r.right,bottom:r.bottom};}));for(const rect of rects){expect(rect.x).toBeGreaterThanOrEqual(0);expect(rect.y).toBeGreaterThanOrEqual(0);expect(rect.right).toBeLessThanOrEqual(size.width+1);expect(rect.bottom).toBeLessThanOrEqual(size.height+1);}expect(new Set(rects.map(r=>`${Math.round(r.x)},${Math.round(r.y)}`)).size).toBe(10);
 await centeredCards(preview,size);
 await page.screenshot({path:test.info().outputPath(`deck-generation-${size.width}.png`)});
 await expect(page.locator('.deck-flight[data-deck-phase="deck-insert"]')).toHaveCount(10);
 await expect(page.locator('.deck-flight[data-deck-phase="shuffle"]')).toHaveCount(3);
 await settled(page);expect(await page.evaluate(()=>state.players.player.deck.filter(c=>c.baseId==='scary_question').length)).toBe(10);
 expect(await page.evaluate(()=>window.deckStages)).toEqual(['deck-generate','deck-insert','shuffle']);
});

test('生成したカードを直後に引く場合も、生成→挿入→シャッフル→ドローとなる',async({page})=>{
 await setup(page);await page.evaluate(()=>{
   state.players.player.deck=[];generateCardsIntoDeck('player','scary_question',3);drawCards('player',2,false);render();
 });await expect(page.locator('.deck-flight[data-deck-phase="deck-generate"]')).toHaveCount(3);
 await settled(page);const phases=await page.evaluate(()=>window.deckStages);
 expect(phases.indexOf('deck-insert')).toBeGreaterThan(phases.indexOf('deck-generate'));
 expect(phases.indexOf('shuffle')).toBeGreaterThan(phases.indexOf('deck-insert'));
 expect(phases.indexOf('moving')).toBeGreaterThan(phases.indexOf('shuffle'));
 expect(await page.evaluate(()=>state.players.player.hand.length)).toBe(2);
});

test('サーチ・校外から戻す・デッキ内の調整で、残りのデッキを実際に混ぜる',async({page})=>{
 await setup(page);const result=await page.evaluate(()=>{
   battleRandom=()=>0;
   const ids=state.players.player.deck.map(c=>c.instanceId);pullCardsFromDeck('player','general_student',1);
   const searched=state.players.player.deck.map(c=>c.instanceId);
   const returned=createCardFromBase('yuta','player');state.players.player.trash=[returned];state.players.player.trash=[];
   insertCardsIntoDeck('player',[returned],{sourceZone:'trash'});
   const insertion=state.players.player.deck.map(c=>c.instanceId);
   state.players.player.will=10;const item=createCardFromBase('illegal_cafeteria','player');state.players.player.hand=[item];
   state.training.skipAnimations=true;castImmediateItem('player',item,false);
   return {ids,searched,insertion,last:state.players.player.deck.map(c=>c.instanceId),returned:returned.instanceId};
 });expect(result.searched).not.toEqual(result.ids.slice(1));expect([...result.searched].sort()).toEqual(result.ids.slice(1).sort());
 expect(result.insertion).toContain(result.returned);expect(result.last).not.toEqual(result.insertion);
});

test('マリガンは戻す演出と混ぜる演出が終わってから引き直す',async({page})=>{
 await setup(page);await page.evaluate(()=>{
   state.phase='mulligan';state.players.player.mulliganUsed=false;state.players.opponent.mulliganUsed=true;
   state.players.player.hand=Array.from({length:5},()=>createCardFromBase('yuta','player'));render();
   state.players.player.mulliganSelection=[state.players.player.hand[0].instanceId];confirmPlayerMulligan();
 });await expect(page.locator('.deck-flight[data-deck-phase="deck-return"]')).toHaveCount(1);
 expect(await page.evaluate(()=>state.players.player.hand.length)).toBe(4);
 await expect(page.locator('.deck-flight[data-deck-phase="shuffle"]')).toHaveCount(3);
 expect(await page.evaluate(()=>state.players.player.hand.length)).toBe(4);
 await expect.poll(()=>page.evaluate(()=>state.players.player.hand.length)).toBe(5);
});

for(const mode of ['skip','reduce','leave','reset','resize'])test(`${mode}で演出が操作を止め続けない`,async({page})=>{
 await setup(page);
 if(mode==='reduce')await page.emulateMedia({reducedMotion:'reduce'});
 await page.evaluate(mode=>{if(mode==='skip')state.training.skipAnimations=true;generateCardsIntoDeck('player','scary_question',10);render();},mode);
 if(['leave','reset','resize'].includes(mode)) {
   await expect(page.locator('.deck-flight')).toHaveCount(10);
   if(mode==='resize')await page.setViewportSize({width:1300,height:850});
   else await page.evaluate(mode=>{if(mode==='leave')state.screen='home';else state.preBattleToken+=1;render();},mode);
 }
 await expect.poll(()=>page.evaluate(()=>window.ChibattleDeck.isBusy())).toBe(false);
 await expect(page.locator('.deck-flight')).toHaveCount(0);
 expect(await page.evaluate(()=>state.players.player.deck.filter(c=>c.baseId==='scary_question').length)).toBe(10);
});

test('ゲストと観戦者にも公開生成の順番を同期し、同じ更新で重ねて再生しない',async({page})=>{
 await setup(page);for(const role of ['guest','spectator']) {
   await page.evaluate(role=>{
     state.online.role='host';state.online.enabled=true;state.online.started=true;
     const before=onlineCreateSnapshot();const owner=role==='guest'?'opponent':'player';
     generateCardsIntoDeck(owner,'scary_question',10);const after=onlineCreateSnapshot();pendingAnimations.length=0;
     state.online.role=role;
     onlineHandleMessage({type:'gameState',protocol:1,snapshot:{...before,seq:state.online.lastSnapshotSeq+1}});
     onlineHandleMessage({type:'gameState',protocol:1,snapshot:{...after,seq:state.online.lastSnapshotSeq+1}});
     window.savedDeckSnapshot=after;
   },role);
   await expect(page.locator('.deck-flight[data-deck-phase="deck-generate"]')).toHaveCount(10);
   await expect(page.locator('.deck-flight-face').first()).toContainText('怖い質問');
   await page.evaluate(()=>onlineHandleMessage({type:'gameState',protocol:1,snapshot:{...window.savedDeckSnapshot,seq:state.online.lastSnapshotSeq+1}}));
   await expect(page.locator('.deck-flight[data-deck-phase="deck-generate"]')).toHaveCount(10);
   await expect(page.locator('.deck-flight[data-deck-phase="shuffle"]')).toHaveCount(3);
   await settled(page);
   await page.evaluate(()=>onlineHandleMessage({type:'gameState',protocol:1,snapshot:{...window.savedDeckSnapshot,seq:state.online.lastSnapshotSeq+1}}));
   await page.waitForTimeout(100);await expect(page.locator('.deck-flight')).toHaveCount(0);
 }
});

test('ガン詰め講師を実際の手札から教卓へ出し、生成するカードを見せる',async({page})=>{
 await page.goto(url);await page.evaluate(()=>{startCardTest('cornering_lecturer');scheduleOpponentAI=()=>{};state.training.skipAnimations=true;render();});
 await settled(page);await page.evaluate(()=>{state.training.skipAnimations=false;render();});
 const before=await page.evaluate(()=>state.players.player.deck.filter(c=>c.baseId==='scary_question').length);
 const played=await page.evaluate(()=>placeCardFromHand('player',state.players.player.hand.find(c=>c.baseId==='cornering_lecturer').instanceId,'teacher','player',null,true,{corneringLecturerChoiceId:'generate'}));
 expect(played).toBe(true);
 await expect(page.locator('.deck-flight[data-deck-phase="deck-generate"]')).toHaveCount(10,{timeout:15000});
 await expect(page.locator('.deck-flight-count')).toHaveCount(0);
 await expect(page.locator('.deck-flight-face').first()).toContainText('怖い質問');
 await settled(page);
 expect(await page.evaluate(()=>state.players.player.board.teacher.baseId)).toBe('cornering_lecturer');
 expect(await page.evaluate(()=>state.players.player.deck.filter(c=>c.baseId==='scary_question').length)).toBe(before+10);
});

test('戻す演出の共有データに非公開のカードの本文を含めない',async({page})=>{
 await setup(page);const r=await page.evaluate(()=>{
   state.players.player.hand=[createCardFromBase('dark_yuta','player')];redrawHand('player');
   const events=onlineCreateSnapshot().state.deckVisualEvents;
   return {text:JSON.stringify(events),returns:events.find(e=>e.type==='deck-return')};
 });expect(r.returns.cards).toEqual([]);expect(r.returns).not.toHaveProperty('origins');expect(r.text).not.toContain('dark_yuta');expect(r.text).not.toContain('裏U太');
});

for(const side of ['player','opponent'])for(const size of [{width:1440,height:900},{width:390,height:844}])
test(`生成3枚をそれぞれ見せ、めくって入れ終わった後に上下の束を混ぜる ${side} ${size.width}`,async({page})=>{
 await setup(page,size);
 await page.evaluate(side=>{generateCardsIntoDeck(side,'scary_question',3);render();},side);
 const preview=page.locator(`.deck-flight[data-deck-side="${side}"][data-deck-phase="deck-generate"]`);
 await expect(preview).toHaveCount(3);await expect(preview.locator('.deck-flight-count')).toHaveCount(0);
 await page.waitForTimeout(260);
 const bounds=await preview.evaluateAll(nodes=>nodes.map(n=>{const r=n.getBoundingClientRect();return{x:r.x,y:r.y,right:r.right,bottom:r.bottom};}));
 expect(new Set(bounds.map(r=>Math.round(r.x))).size).toBe(3);
 for(const r of bounds){expect(r.x).toBeGreaterThanOrEqual(0);expect(r.y).toBeGreaterThanOrEqual(0);expect(r.right).toBeLessThanOrEqual(size.width+1);expect(r.bottom).toBeLessThanOrEqual(size.height+1);}
 await centeredCards(preview,size);
 await page.screenshot({path:test.info().outputPath(`three-generated-${side}-${size.width}.png`)});
 const inserting=page.locator('.deck-flight[data-deck-phase="deck-insert"]');await expect(inserting).toHaveCount(3);
 const timings=await inserting.evaluateAll(nodes=>nodes.map(n=>({move:n.getAnimations().at(-1).effect.getTiming(),turn:n.firstElementChild.getAnimations().at(-1).effect.getTiming()})));
 expect(timings.map(t=>t.move.delay)).toEqual([0,95,190]);expect(timings.map(t=>t.turn.delay)).toEqual([50,145,240]);
 await expect(page.locator('.deck-flight[data-deck-phase="shuffle"]')).toHaveCount(3);
 await expect(inserting).toHaveCount(0);
 const keyframes=await page.locator('.deck-flight[data-deck-phase="shuffle"]').evaluateAll(nodes=>nodes.map(n=>n.getAnimations()[0].effect.getKeyframes().map(f=>{const m=new DOMMatrix(f.transform);return{x:m.m41,y:m.m42,b:m.b,c:m.c};})));
 // Packets stay upright, with only a small horizontal offset and two distinct lifts.
 const packetA=keyframes[1],packetB=keyframes[2];
 expect(packetA[2].y).toBeLessThan(packetA[1].y-15);expect(packetB[4].y).toBeLessThan(packetB[3].y-15);
 expect(packetA.every(m=>Math.abs(m.b)<.001&&Math.abs(m.c)<.001)).toBe(true);
 expect(Math.max(...packetA.map(m=>m.x))-Math.min(...packetA.map(m=>m.x))).toBeLessThan(7);
 await page.screenshot({path:test.info().outputPath(`packet-shuffle-${side}-${size.width}.png`)});
 await settled(page);expect(await page.evaluate(side=>state.players[side].deck.filter(c=>c.baseId==='scary_question').length,side)).toBe(3);
});

for(const size of [{width:1440,height:900},{width:390,height:844}])test(`生成1枚も中央で見せてから山札へ入れる ${size.width}`,async({page})=>{
 await setup(page,size);await page.evaluate(()=>{generateCardsIntoDeck('player','scary_question',1);render();});
 const preview=page.locator('.deck-flight[data-deck-phase="deck-generate"]');await expect(preview).toHaveCount(1);
 await page.waitForTimeout(260);await centeredCards(preview,size);
 await page.screenshot({path:test.info().outputPath(`one-generated-center-${size.width}.png`)});
 await settled(page);
});
