const { test, expect } = require("@playwright/test");
const { spawn } = require("node:child_process");
const net = require("node:net");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
let server, gameUrl;

test.beforeAll(async () => {
  const port = await new Promise(resolve => {
    const probe = net.createServer();
    probe.listen(0, "127.0.0.1", () => { const port = probe.address().port; probe.close(() => resolve(port)); });
  });
  gameUrl = pathToFileURL(path.join(__dirname, "..", "index.html"));
  gameUrl.searchParams.set("ws", `ws://127.0.0.1:${port}`);
  server = spawn(process.execPath, [path.join(__dirname, "..", "server", "server.js")], {
    env: { ...process.env, PORT: String(port) }, stdio: ["ignore", "pipe", "pipe"]
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("server startup timeout")), 5000);
    server.stdout.on("data", chunk => { if (String(chunk).includes("listening")) { clearTimeout(timer); resolve(); } });
    server.once("error", reject);
  });
});
test.afterAll(() => server?.kill("SIGTERM"));

test('終了時の点数・単位強化を実WebSocketで双方へ同期し、ゲスト側で二重加点しない', async ({ browser }) => {
 test.setTimeout(120000);
 const contexts = await Promise.all([browser.newContext(), browser.newContext()]);
 const [host, guest] = await Promise.all(contexts.map(c => c.newPage()));
 const errors = [];
 try {
  for (const p of [host, guest]) {
   p.on('pageerror', e => errors.push(e.message));
   await p.goto(gameUrl.href); await p.locator('#homeNavBattleButton').click(); await p.locator('#onlinePrivateMatchButton').click();
  }
  await host.locator('#onlineCreateRoomButton').click();
  await expect.poll(() => host.evaluate(() => state.online.role)).toBe('host');
  await guest.locator('.private-code-entry > summary').click();
  await guest.locator('#onlineRoomInput').fill(await host.evaluate(() => state.online.roomCode));
  await guest.locator('#onlineJoinRoomButton').click();
  for (const p of [host, guest]) {
   await expect.poll(() => p.evaluate(() => state.online.connected)).toBe(true);
   await p.evaluate(() => {
    state.deckBuilder.counts.player = createAutoDeckCounts();
    document.getElementById('onlineDeckSelect').dispatchEvent(new Event('change', { bubbles: true }));
   });
   await p.locator('#onlineReadyButton').click();
  }
  await expect.poll(() => host.evaluate(() => state.online.remoteReady)).toBe(true);
  await host.locator('#onlineStartButton').click();
  await expect.poll(() => guest.evaluate(() => state.online.started)).toBe(true);
  for (const side of ['player', 'opponent']) for (const { count, earned } of [{ count: 9, earned: false }, { count: 10, earned: false }, { count: 10, earned: true }]) {
   const seq = await host.evaluate(({ side, count, earned }) => {
    startCardTest('long_sleeve_student'); state.testMode = false; state.training.skipAnimations = true;
    state.currentSide = side; state.environment = null;
    for (const owner of ['player', 'opponent']) Object.assign(state.players[owner], {
     board: { teacher: null, seats: Array(9).fill(null) }, hand: [], trash: [], late: [], life: 20,
     deck: Array.from({ length: 20 }, () => createCardFromBase('general_student', owner)),
     pointScore: 9, pointSystemActive: true,
     originalDeckCounts: { short_sleeve_student: 3, long_sleeve_student: 3, pinige: 3, lucky_man: count - 9 }
    });
    state.players[side].board.seats[0] = makeBoardCard(createCardFromBase('long_sleeve_student', side));
    if (earned) {
     state.players[side].pointScore = 8;
     const enemy = makeBoardCard(createCardFromBase('aggro_student', oppositeSide(side)));
     state.players[oppositeSide(side)].board.seats[0] = enemy;
     dealDamageToCard(enemy, 1, createCardFromBase('short_sleeve_student', side));
     cleanupDestroyedCards();
    }
    render(); return state.online.lastSnapshotSeq;
   }, { side, count, earned });
   await expect.poll(() => guest.evaluate(() => state.online.lastSnapshotSeq)).toBeGreaterThanOrEqual(seq);
   for (const p of [host, guest]) await expect.poll(() => p.evaluate(() => battlePresentationBusy())).toBe(false);
   await (side === 'player' ? host : guest).locator('#endTurnButton').click();
   await expect.poll(() => host.evaluate(side => !state.lectureRoomCheck && state.currentSide !== side, side)).toBe(true);
   for (const p of [host, guest]) {
    const owner = p === host ? side : side === 'player' ? 'opponent' : 'player';
    await expect.poll(() => p.evaluate(owner => {
     const own = state.players[owner], other = state.players[oppositeSide(owner)], card = own.board.seats[0];
     return [own.pointScore, other.pointScore, card?.attack, card?.currentHp, playerActiveEffectLines(owner)[0]];
    }, owner)).toEqual(count === 10 && !earned ? [10, 9, 4, 6, '[単位] 取得済み'] : [9, 9, 1, 3, '[点数] 9/10']);
   }
   expect(await host.evaluate(side => {
    const snapshot = onlineTransformSnapshotForSpectator(onlineCreateSnapshot().state);
    return snapshot.players[side].pointScore;
   }, side)).toBe(count === 10 && !earned ? 10 : 9);
  }
  expect(errors).toEqual([]);
 } finally { await Promise.all(contexts.map(c => c.close())); }
});

for (const actorSide of ['player','opponent']) test(`実WebSocketで${actorSide==='player'?'ホスト':'ゲスト'}の新点数カードと選択・強化・破壊が同期する`,async({browser})=>{
 test.setTimeout(120000);
 const contexts=await Promise.all([browser.newContext(),browser.newContext()]);const [host,guest]=await Promise.all(contexts.map(c=>c.newPage()));const errors=[];
 try{
  for(const p of [host,guest]){p.on('pageerror',e=>errors.push(e.message));await p.goto(gameUrl.href);await p.locator('#homeNavBattleButton').click();await p.locator('#onlinePrivateMatchButton').click();}
  await host.locator('#onlineCreateRoomButton').click();await expect.poll(()=>host.evaluate(()=>state.online.role)).toBe('host');await guest.locator('.private-code-entry > summary').click();await guest.locator('#onlineRoomInput').fill(await host.evaluate(()=>state.online.roomCode));await guest.locator('#onlineJoinRoomButton').click();
  for(const p of [host,guest]){await expect.poll(()=>p.evaluate(()=>state.online.connected)).toBe(true);await p.evaluate(()=>{state.deckBuilder.counts.player=createAutoDeckCounts();document.getElementById('onlineDeckSelect').dispatchEvent(new Event('change',{bubbles:true}));});await p.locator('#onlineReadyButton').click();}
  await expect.poll(()=>host.evaluate(()=>state.online.remoteReady)).toBe(true);await host.locator('#onlineStartButton').click();await expect.poll(()=>guest.evaluate(()=>state.online.started)).toBe(true);
  const actor=actorSide==='player'?host:guest;
  for(const [id,score] of [['sports_spectator_student',0],['sports_spectator_student',10],['lucky_man',0],['lucky_man',10],['gecko_carrier_student',0],['long_sleeve_student',10],['could_not_escape_student',10],['secretly_mocked_student',0],['pinige',9],['pinige',0]]){
   const setup=await host.evaluate(({id,score,side})=>{
    startCardTest(id);state.testMode=false;state.training.skipAnimations=true;state.currentSide=side;state.environment=null;
    for(const owner of ['player','opponent'])Object.assign(state.players[owner],{board:{teacher:null,seats:Array(9).fill(null)},hand:[],deck:[],trash:[],late:[],will:20,maxWill:20,life:10,pointScore:0});
    const own=state.players[side],enemy=state.players[oppositeSide(side)];own.pointScore=score;const card=createCardFromBase(id,side);own.hand=[card];if(id==='pinige'&&score===0)own.deck=['pinige','tojirika','general_student','short_sleeve_student','long_sleeve_student'].map(id=>createCardFromBase(id,side));for(const i of (id==='could_not_escape_student'?[0,1,2,3]:[0]))enemy.board.seats[i]=makeBoardCard(createCardFromBase(id==='pinige'?'general_student':'strong_student',oppositeSide(side)));render();return {cardId:card.instanceId,seq:state.online.lastSnapshotSeq};
   },{id,score,side:actorSide});
   await expect.poll(()=>guest.evaluate(()=>state.online.lastSnapshotSeq)).toBeGreaterThanOrEqual(setup.seq);for(const p of [host,guest])await expect.poll(()=>p.evaluate(()=>battlePresentationBusy())).toBe(false);
   await actor.evaluate(({cardId,index,id})=>id==='pinige'?beginItemUse(state.players.player.hand.find(c=>c.instanceId===cardId)):playCard(cardId,'seat','player',index),{cardId:setup.cardId,index:id==='secretly_mocked_student'?8:4,id});
   if(id==='sports_spectator_student'||id==='gecko_carrier_student'||id==='pinige'){
    await expect.poll(()=>actor.evaluate(()=>!!state.pendingCardChoice)).toBe(true);
    await expect(actor.locator('#effectModeSource .card')).toHaveCount(1);
    await expect.poll(()=>actor.evaluate(()=>battlePresentationBusy({ignoreFusionTasks:true}))).toBe(false);
    const selection = await actor.evaluate(({id,score})=>{
     const choice=state.pendingCardChoice;
     const modes=id==='pinige'?(score===0?[2,1]:[4,1]):id==='sports_spectator_student'&&score===10?[2,1]:[1];
     return {max:choice.max,ids:modes.map(mode=>choice.cards.find(c=>c.pointMode===mode).instanceId)};
    },{id,score});
    for(const cardId of selection.ids) await actor.locator(`.effect-mode-option[data-card-id="${cardId}"]`).click();
    await expect(actor.locator('#threeGesturesConfirmButton')).toBeHidden();
   }
   if(id==='lucky_man')for(let i=0;i<(score===10?2:1);i++){await expect.poll(()=>actor.evaluate(()=>!!state.pendingCardChoice)).toBe(true);await expect.poll(()=>actor.evaluate(()=>battlePresentationBusy({ignoreFusionTasks:true}))).toBe(false);await actor.locator('.board-card[data-owner="opponent"][data-zone="seat"][data-index="0"]').click();await actor.locator('#itemTargetConfirmButton').click();}
   await expect.poll(()=>host.evaluate(()=>fusionTasksBusy())).toBe(false);await expect.poll(()=>guest.evaluate(()=>state.online.lastSnapshotSeq)).toBeGreaterThan(setup.seq);
   for(const p of [host,guest]){
    const side=p===host?actorSide:actorSide==='player'?'opponent':'player';
    const expected=id==='sports_spectator_student'?[score===10?5:1,score===10?5:1,score===10?3:5,10]:id==='lucky_man'?[2,2,score===10?1:4,score===10?14:12]:id==='long_sleeve_student'?[4,6,7,10]:id==='secretly_mocked_student'?[1,1,1,10]:null;
    if(expected)await expect.poll(()=>p.evaluate(({side,id})=>{const own=state.players[side],other=state.players[oppositeSide(side)],c=own.board.seats[id==='secretly_mocked_student'?8:4];return c?[c.attack,c.currentHp,other.board.seats[0]?.currentHp,own.life]:[];},{side,id})).toEqual(expected);
    if(id==='pinige'&&score!==0)await expect.poll(()=>p.evaluate(side=>[state.players[side].pointScore,listBoardRefs(oppositeSide(side)).length,playerActiveEffectLines(side)[0]],side)).toEqual([10,0,'[単位] 取得済み']);
    if(id==='pinige'&&score===0){
     if(p===actor||p===host)await expect.poll(()=>p.evaluate(side=>[state.players[side].hand.map(c=>c.baseId).sort(),state.players[side].deck.map(c=>c.baseId).sort()],side)).toEqual([['long_sleeve_student','short_sleeve_student'],['general_student','pinige','tojirika']]);
     else await expect.poll(()=>p.evaluate(side=>[state.players[side].hand.length,state.players[side].deck.length,state.players[side].hand.every(c=>!c.baseId)],side)).toEqual([2,3,true]);
    }
    if(id==='gecko_carrier_student')await expect.poll(()=>p.evaluate(side=>[3,4,5].map(i=>{const c=state.players[side].board.seats[i];return [c?.attack,c?.currentHp,c?hasKeyword(c,'陽気'):false];}),side)).toEqual(Array(3).fill([3,3,true]));
    if(id==='could_not_escape_student')await expect.poll(()=>p.evaluate(side=>[listBoardRefs(oppositeSide(side)).length,...state.players[side].board.seats.slice(0,3).map(c=>c?.attack)],side)).toEqual([0,2,2,2]);
    if(id==='secretly_mocked_student')expect(await p.evaluate(side=>[state.players[side].board.seats[8].name,isOneHpAttackLocked(state.players[oppositeSide(side)].board.seats[0])],side)).toEqual(['謎多き女学生',true]);
   }
  }
  expect(errors).toEqual([]);
 }finally{await Promise.all(contexts.map(c=>c.close()));}
});
