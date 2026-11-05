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



async function pair(browser){
 const contexts=await Promise.all([browser.newContext(),browser.newContext()]);const [host,guest]=await Promise.all(contexts.map(c=>c.newPage()));const errors=[];
 for(const p of [host,guest]){p.on('pageerror',e=>errors.push(e.message));await p.goto(gameUrl.href);await p.locator('#homeNavBattleButton').click();await p.locator('#onlinePrivateMatchButton').click();}
 await host.locator('#onlineCreateRoomButton').click();await expect.poll(()=>host.evaluate(()=>state.online.role)).toBe('host');await guest.locator('.private-code-entry > summary').click();await guest.locator('#onlineRoomInput').fill(await host.evaluate(()=>state.online.roomCode));await guest.locator('#onlineJoinRoomButton').click();
 for(const p of [host,guest]){await expect.poll(()=>p.evaluate(()=>state.online.connected)).toBe(true);await p.evaluate(()=>{state.deckBuilder.counts.player=createAutoDeckCounts();document.getElementById('onlineDeckSelect').dispatchEvent(new Event('change',{bubbles:true}));});await p.locator('#onlineReadyButton').click();}
 await expect.poll(()=>host.evaluate(()=>state.online.remoteReady)).toBe(true);await host.locator('#onlineStartButton').click();await expect.poll(()=>guest.evaluate(()=>state.online.started)).toBe(true);
 return {contexts,host,guest,errors};
}
async function idle(p){await expect.poll(()=>p.evaluate(()=>!battlePresentationBusy()&&!fusionTasksBusy())).toBe(true);}
for(const side of ['player','opponent'])test(`Hapaの秘密を双方の手札表示に漏らさず出席時に同期 ${side}`,async({browser})=>{
 test.setTimeout(90000);const {contexts,host,guest,errors}=await pair(browser);
 try{
  const actor=side==='player'?host:guest,victim=actor===host?guest:host;
  const seq=await host.evaluate(side=>{
   startCardTest('hapa_english');state.testMode=false;state.training.skipAnimations=true;state.currentSide=side;
   for(const owner of ['player','opponent'])Object.assign(state.players[owner],{board:{teacher:null,seats:Array(9).fill(null)},hand:[],deck:['ruler','classroom','ruler'].map(id=>createCardFromBase(id,owner)),trash:[],late:[],life:20,will:10,maxWill:10});
   state.players[side].hand=[createCardFromBase('hapa_english',side)];state.players[oppositeSide(side)].hand=[createCardFromBase('suit_student',oppositeSide(side))];render();return state.online.lastSnapshotSeq;
  },side);
  await expect.poll(()=>guest.evaluate(()=>state.online.lastSnapshotSeq)).toBeGreaterThanOrEqual(seq);for(const p of [host,guest])await idle(p);
  const before=await victim.locator('#playerHand [data-base-id="suit_student"]').innerHTML();
  await actor.evaluate(()=>beginItemUse(state.players.player.hand[0]));await expect.poll(()=>host.evaluate(side=>state.players[oppositeSide(side)].hand[0].hapaHandDamage,side)).toBe(2);for(const p of [host,guest])await idle(p);
  expect(await victim.locator('#playerHand [data-base-id="suit_student"]').innerHTML()).toBe(before);
  expect(await guest.evaluate(()=>JSON.stringify(state.players).includes('hapaHandDamage'))).toBe(false);
  expect(await host.evaluate(side=>state.players[oppositeSide(side)].hand[0].currentHp,side)).toBe(1);
  // Use the real turn-change command; the recommended button pulses continuously.
  await actor.locator('#endTurnButton').click({force:true});await expect.poll(()=>victim.evaluate(()=>state.currentSide)).toBe('player');for(const p of [host,guest])await idle(p);
  await victim.locator('#playerHand [data-base-id="suit_student"]').click();await victim.locator('#playerSeatGrid .slot[data-index="4"]').click();
  for(const p of [host,guest])await expect.poll(()=>p.evaluate(()=>['player','opponent'].some(side=>state.players[side].trash.some(c=>c.baseId==='suit_student')))).toBe(true);
  expect(await host.evaluate(side=>({field:listBoardRefs(oppositeSide(side)).length,deck:state.players[oppositeSide(side)].deck.length}),side)).toEqual({field:0,deck:1});
  expect(errors).toEqual([]);
 }finally{await Promise.all(contexts.map(c=>c.close()));}
});
for(const side of ['player','opponent'])test(`質問する講師の盤面選択・特殊講義・生成を同期 ${side}`,async({browser})=>{
 test.setTimeout(90000);const {contexts,host,guest,errors}=await pair(browser);
 try{
  const actor=side==='player'?host:guest;
  const seq=await host.evaluate(side=>{
   startCardTest('questioning_lecturer');state.testMode=false;state.training.skipAnimations=true;state.currentSide=side;
   for(const owner of ['player','opponent'])Object.assign(state.players[owner],{board:{teacher:null,seats:Array(9).fill(null)},hand:[],deck:['ruler','classroom','ruler'].map(id=>createCardFromBase(id,owner)),trash:[],late:[],life:20,will:10,maxWill:10});
   state.players[side].hand=[createCardFromBase('questioning_lecturer',side)];for(const i of [0,4])state.players[oppositeSide(side)].board.seats[i]=makeBoardCard(createCardFromBase('general_student',oppositeSide(side)));render();return state.online.lastSnapshotSeq;
  },side);
  await expect.poll(()=>guest.evaluate(()=>state.online.lastSnapshotSeq)).toBeGreaterThanOrEqual(seq);for(const p of [host,guest])await idle(p);
  await actor.locator('#playerHand [data-base-id="questioning_lecturer"]').click();await actor.locator('.slot[data-owner="player"][data-zone="teacher"]').click();await expect.poll(()=>actor.evaluate(()=>state.pendingCardChoice?.context?.kind)).toBe('lecturer_move');await expect.poll(()=>actor.evaluate(()=>battlePresentationBusy({ignoreFusionTasks:true}))).toBe(false);await actor.locator('.board-card[data-owner="opponent"][data-zone="seat"][data-index="0"]').click();await actor.locator('#itemTargetConfirmButton').click();for(const p of [host,guest])await idle(p);
  await expect.poll(()=>actor.evaluate(()=>state.players.opponent.board.teacher?.baseId)).toBe('general_student');await actor.locator('.slot[data-owner="player"][data-zone="teacher"] .board-card').click();await expect(actor.locator('#teacherAttackChoiceButton')).toBeDisabled();await actor.locator('#teacherLectureChoiceButton').click();
  for(const p of [host,guest]){const own=p===host?side:side==='player'?'opponent':'player';await expect.poll(()=>p.evaluate(own=>({teacher:state.players[oppositeSide(own)].board.teacher,hand:state.players[own].hand.map(c=>c.baseId||'hidden'),used:cardAttacksUsedThisTurn(state.players[own].board.teacher)}),own)).toEqual({teacher:null,hand:[p===host||p===actor?'hapa_english':'hidden'],used:1});}
  expect(errors).toEqual([]);
 }finally{await Promise.all(contexts.map(c=>c.close()));}
});
