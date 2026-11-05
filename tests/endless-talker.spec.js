const {test,expect}=require('@playwright/test');
const {pathToFileURL}=require('node:url');
const path=require('node:path'),fs=require('node:fs');
const id='endless_talker',url=pathToFileURL(path.join(__dirname,'../index.html')).href;
async function settle(p){await expect.poll(()=>p.evaluate(()=>!battlePresentationBusy()&&!fusionTasksBusy()),{timeout:15000}).toBe(true);}
async function start(p,ui=false){
 await p.setViewportSize({width:1440,height:900});await p.goto(url);
 if(ui){await p.locator('#homeNavDeckButton').click();await p.locator('[data-case-view="cards"]').click();await p.locator('#cardsCatalogSearch').fill('エンドレストーカー');await p.locator('[data-catalog-card="endless_talker"]').click();await p.locator('#cardTestStartButton').click();}
 else await p.evaluate(()=>startCardTest('endless_talker'));
 await p.evaluate(()=>{scheduleOpponentAI=()=>{};state.training.skipAnimations=true;});await settle(p);
}
async function play(p){return p.evaluate(()=>playCard(state.players.player.hand.find(c=>c.baseId==='endless_talker').instanceId,'seat','player',2));}

test('定義・完成テキスト・デッキ登録・管理ログ・台帳が一致',async({page:p})=>{
 await start(p);const r=await p.evaluate(()=>({base:CARD_BASES.endless_talker,direct:DIRECT_DECK_CARD_IDS.has('endless_talker'),text:cardRulesText(createCardFromBase('endless_talker','player')),order:getDeckEditorIds('')}));
 expect(r.base).toMatchObject({name:'エンドレストーカー',type:'student',category:'common',cost:10,attack:1,hp:1});expect(r.direct).toBe(true);
 const ledger=JSON.parse(fs.readFileSync(path.join(__dirname,'../カード管理台帳.html'),'utf8').match(/const CARDS = (\[.*\]);/)[1]).find(c=>c.id===id);
 const raw=JSON.parse(fs.readFileSync(path.join(__dirname,'../card_rules.txt'),'utf8').split('\n').find(l=>l.trimStart().startsWith(id+':')).trim().replace(/^[^:]+: /,'').replace(/,$/,''));
 expect(raw).toBe(ledger.effect);expect(r.text).toBe(await p.evaluate(raw=>formatCardRulesDisplayText(createCardFromBase('endless_talker','player'),raw),raw));
 const catalog=require('../server/card-catalog.json');expect(catalog.direct).toContain(id);expect(catalog.specialties.common).toContain(id);expect(catalog.names[id]).toBe(r.base.name);expect(catalog.display[id]).toMatchObject({type:'student',cost:10,attack:1,hp:1});expect(catalog.deckOrder).toEqual(r.order);
 expect(await p.evaluate(()=>UPDATE_HISTORY[0].changes.find(c=>c.title==='エンドレストーカー').after.split('\n').slice(1).join('\n'))).toBe(raw);
});

test('カード一覧から開始し、手札と席をクリックして主要効果を確認',async({page:p})=>{
 const errors=[];p.on('pageerror',e=>errors.push(e.message));await start(p,true);
 const before=await p.evaluate(()=>({life:state.players.player.life,enemyLife:state.players.opponent.life,ownDeck:state.players.player.deck.length,enemyDeck:state.players.opponent.deck.length,late:JSON.stringify(state.players.player.late),env:state.environment.instanceId}));
 await p.locator('#playerHand [data-base-id="endless_talker"]').click();await p.locator('#playerSeatGrid .slot[data-index="2"]').click();await settle(p);
 const r=await p.evaluate(()=>({own:state.players.player,enemy:state.players.opponent,refs:listBoardRefs('player').map(getBoardCardFromRef),enemyRefs:listBoardRefs('opponent'),late:JSON.stringify(state.players.player.late),env:state.environment.instanceId}));
 expect(r.own.will).toBe(0);expect(r.own.maxWill).toBe(3);expect(r.enemy.will).toBe(3);expect(r.enemy.maxWill).toBe(3);
 expect(r.own.hand.map(c=>c.baseId)).toEqual(['go_home','classroom']);expect(r.enemy.hand.map(c=>c.baseId)).toEqual(['ruler','cafeteria']);
 expect(r.refs.map(c=>c.baseId)).toEqual([id]);expect(r.refs[0].cost).toBe(10);expect(r.enemyRefs).toEqual([]);
 expect(r.own.life).toBe(before.life);expect(r.enemy.life).toBe(before.enemyLife);expect(r.late).toBe(before.late);expect(r.env).toBe(before.env);
 expect(r.own.trash.map(c=>c.baseId)).toEqual(['ruler']);expect(r.enemy.trash.map(c=>c.baseId)).toEqual(['onigiri_draw']);
 expect(r.own.deck.length).toBe(before.ownDeck+8);expect(r.enemy.deck.length).toBe(before.enemyDeck+5);
 for(const c of [...r.own.deck,...r.enemy.deck]){const b=await p.evaluate(id=>CARD_BASES[id],c.baseId);expect(c.cost).toBe(['student','teacher','vampire'].includes(c.type)?Math.max(0,b.cost-3):b.cost);expect(c.handFusionStored).toBeUndefined();expect(c.evolvedFrom).toBeUndefined();}
 expect(r.own.deck.some(c=>c.baseId==='yuta')).toBe(true);expect(r.own.deck.some(c=>c.baseId==='dark_yuta')).toBe(true);expect(r.own.deck.some(c=>c.baseId==='umaibo')).toBe(false);
 expect(r.own.deck.filter(c=>['fusion_uma','fusion_maibo'].includes(c.baseId))).toHaveLength(2);
 expect(r.enemy.deck.filter(c=>c.baseId==='two_achievers')).toHaveLength(1);expect(r.enemy.deck.some(c=>c.baseId==='exploding_student')).toBe(false);
 expect(errors).toEqual([]);await p.screenshot({path:test.info().outputPath('endless-talker-after.png')});
});

for(const cost of [7,9,10,11])test(`カード自身の現在戦意${cost}で出席を制限`,async({page:p})=>{
 await start(p);const r=await p.evaluate(cost=>{const c=state.players.player.hand[0];c.cost=cost;state.players.player.will=20;return {can:canPlaceCard('player',c,'seat','player',2),effect:!!attendCard('player',makeBoardCard(c),'seat',2,{attendanceSource:ATTENDANCE_SOURCE.EFFECT})};},cost);
 expect(r).toEqual({can:cost===10,effect:cost===10});
});

test('効果による出席ではリセットせず、出席時効果禁止も尊重する',async({page:p})=>{
 await start(p);expect(await p.evaluate(()=>{const c=createCardFromBase('endless_talker','player');attendCard('player',makeBoardCard(c),'seat',2,{attendanceSource:ATTENDANCE_SOURCE.EFFECT});return state.players.player.maxWill;})).toBe(10);
 await start(p);await p.evaluate(()=>{state.players.player.effectUseLockTurnsRemaining=1;});await play(p);await settle(p);
 expect(await p.evaluate(()=>[state.players.player.maxWill,state.players.opponent.maxWill,listBoardRefs('opponent').length])).toEqual([10,10,3]);
});

test('融合済み手札・進化・U太融合を分解し、素材を重複させない',async({page:p})=>{
 await start(p);const r=await p.evaluate(()=>{
  const own=state.players.player;own.board={teacher:null,seats:Array(9).fill(null)};state.players.opponent.board={teacher:null,seats:Array(9).fill(null)};own.trash=[];
  const fused=createCardFromBase('chugidesu','player');fused.handFusionStored=[createCardFromBase('general_student','player'),createCardFromBase('ruler','player')];
  const uta=makeBoardCard(createCardFromBase('yuta','player'));uta.utaFusionMaterials=[{baseId:'tsurai_nara'},{baseId:'company_one_day'}];
  const dark=makeBoardCard(createCardFromBase('dark_yuta','player'));dark.evolvedFrom=uta;own.board.seats[4]=dark;
  own.hand=[createCardFromBase('endless_talker','player'),fused];own.deck=[];resolveEndlessTalker('player',own.hand.shift());
  return own.deck.map(c=>({id:c.baseId,cost:c.cost,fusion:c.handFusionStored,uta:c.utaFusionMaterials}));
 });
 expect(r.map(c=>c.id).sort()).toEqual(['chugidesu','general_student','ruler','dark_yuta','yuta','tsurai_nara','company_one_day'].sort());expect(r.find(c=>c.id==='chugidesu').cost).toBe(4);expect(r.every(c=>!c.fusion&&!c.uta)).toBe(true);
});

test('残り戦意は補充せず、最大戦意制限の保存値も3から再成長する',async({page:p})=>{
 await start(p);await p.evaluate(()=>{state.players.player.padPresentNaturalMaxWill=10;state.players.opponent.padPresentNaturalMaxWill=9;state.players.opponent.will=1;});await play(p);await settle(p);
 expect(await p.evaluate(()=>['player','opponent'].map(side=>{const p=state.players[side];return [p.will,p.maxWill,p.padPresentNaturalMaxWill];}))).toEqual([[0,3,null],[1,3,null]]);
 expect(await p.evaluate(()=>['player','opponent'].map(side=>{preparePadPresentCreatorTurnWill(side);const p=state.players[side];return [p.will,p.maxWill];}))).toEqual([[4,4],[4,4]]);
});

test('デッキに元からあるカードも戦意−3、0未満にせず、引いた後も維持',async({page:p})=>{
 await start(p);await play(p);await settle(p);
 const r=await p.evaluate(()=>{const own=state.players.player;const a=own.deck.find(c=>c.baseId==='long_sleeve_student');const b=own.deck.find(c=>c.baseId==='endless_talker');own.deck=[a,b];drawCards('player',2);return {costs:own.hand.slice(-2).map(c=>effectiveCardCost(c)),blocked:canPlaceCard('player',b,'seat','player',3),notes:handCardEffectNotes(a)};});
 expect(r.costs).toEqual([1,7]);expect(r.blocked).toBe(false);expect(r.notes).toContain('戦意が変化しています');
});

test('AIは劣勢時にリセットを評価し、優勢な盤面は維持する',async({page:p})=>{
 await start(p);const r=await p.evaluate(()=>{const source=createCardFromBase('endless_talker','opponent');for(const side of ['player','opponent'])Object.assign(state.players[side],{board:{teacher:null,seats:Array(9).fill(null)},hand:[],deck:[createCardFromBase('ruler',side)],trash:[]});state.players.player.board.seats[0]=makeBoardCard(createCardFromBase('strong_student','player'));const behind=scoreAiEndlessTalker('opponent',source);state.players.opponent.board.seats[0]=makeBoardCard(createCardFromBase('strong_student','opponent'));state.players.player.board.seats[0]=null;return [behind,scoreAiEndlessTalker('opponent',source)];});expect(r[0]).toBeGreaterThan(0);expect(r[1]).toBeLessThan(0);
});


test('完成した融合・重ねた進化と装備を分解し、破壊時効果や点数を発動しない',async({page:p})=>{
 await start(p);const r=await p.evaluate(()=>{
  const own=state.players.player,enemy=state.players.opponent;
  for(const side of ['player','opponent'])Object.assign(state.players[side],{board:{teacher:null,seats:Array(9).fill(null)},hand:[],deck:[],trash:[]});
  const horse=makeBoardCard(createCardFromBase('where_uma_bone_maibo','opponent'));enemy.board.seats[0]=horse;
  const ultimate=createCardFromBase('ultimate_yuta','player');ultimate.utaFusionMaterials=UTA_FUSION_MATERIAL_IDS.map(baseId=>({baseId}));own.hand=[ultimate];
  const nested=makeBoardCard(createCardFromBase('dark_yuta','player'));nested.evolvedFrom=makeBoardCard(createCardFromBase('yuta','player'));
  own.board.seats[4]=nested;
  const top=makeBoardCard(createCardFromBase('gigi_blood','opponent'));top.evolvedFrom=makeBoardCard(createCardFromBase('gitch','opponent'));top.evolvedFrom.evolvedFrom=makeBoardCard(createCardFromBase('wood_gitch','opponent'));enemy.board.teacher=top;
  const e=createCardFromBase('red_happi','player');nested.evolvedFrom.yutaEquipments=[{...e}];nested.yutaEquipments=[{...e}];
  enemy.board.seats[4]=makeBoardCard(createCardFromBase('exploding_student','opponent'));own.pointScore=2;own.pointSystemActive=true;
  const life=own.life;resolveEndlessTalker('player',createCardFromBase('endless_talker','player'));
  return {own:own.deck.map(c=>c.baseId),enemy:enemy.deck.map(c=>c.baseId),trash:own.trash.map(c=>c.baseId),life:own.life,beforeLife:life,points:own.pointScore};
 });
 expect(r.own.sort()).toEqual(['yuta','dark_yuta','yuta','tsurai_nara','company_one_day','enough_to_fly','ii_daro_tte'].sort());
 expect(r.enemy.sort()).toEqual(['fusion_uma','fusion_maibo','fusion_bone','fusion_where','wood_gitch','gitch','gigi_blood'].sort());expect(r.trash).toEqual(['red_happi']);expect(r.life).toBe(r.beforeLife);expect(r.points).toBe(2);
});

test('CPUが実際に出席させて効果を解決し、通常の使用演出を経てリセットする',async({page:p})=>{
 await start(p);await p.evaluate(()=>{
  state.currentSide='opponent';state.environment=null;
  for(const side of ['player','opponent'])Object.assign(state.players[side],{board:{teacher:null,seats:Array(9).fill(null)},hand:[],trash:[],late:[],will:10,maxWill:10});
  state.players.player.board.seats[0]=makeBoardCard(createCardFromBase('strong_student','player'));
  state.players.opponent.hand=[createCardFromBase('endless_talker','opponent')];
  const move=findAiPlayMove();if(!move)throw new Error('AI did not select a reset');
  placeCardFromHand('opponent',move.card.instanceId,move.zone,move.owner,move.index);
 });await settle(p);expect(await p.evaluate(()=>[state.players.opponent.maxWill,state.players.opponent.will,listBoardRefs('player').length,listBoardRefs('opponent').map(getBoardCardFromRef).map(c=>c.baseId)])).toEqual([3,0,0,['endless_talker']]);
 await start(p);await p.evaluate(()=>{state.training.skipAnimations=false;playCard(state.players.player.hand[0].instanceId,'seat','player',2);});
 expect(await p.evaluate(()=>[!!state.pendingCardPlay,state.players.player.maxWill])).toEqual([true,10]);await settle(p);expect(await p.evaluate(()=>state.players.player.maxWill)).toBe(3);
});
