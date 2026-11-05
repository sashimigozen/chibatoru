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


for(const actorSide of ['player','opponent'])test(`エンドレストーカーをホスト・ゲストから使用し実WebSocketで同期 ${actorSide}`,async({browser})=>{
 test.setTimeout(90000);const contexts=await Promise.all([browser.newContext(),browser.newContext()]);const [host,guest]=await Promise.all(contexts.map(c=>c.newPage()));const errors=[];
 try{
  for(const p of [host,guest]){p.on('pageerror',e=>errors.push(e.message));await p.goto(gameUrl.href);await p.locator('#homeNavBattleButton').click();await p.locator('#onlinePrivateMatchButton').click();}
  await host.locator('#onlineCreateRoomButton').click();await expect.poll(()=>host.evaluate(()=>state.online.role)).toBe('host');await guest.locator('.private-code-entry > summary').click();await guest.locator('#onlineRoomInput').fill(await host.evaluate(()=>state.online.roomCode));await guest.locator('#onlineJoinRoomButton').click();
  for(const p of [host,guest]){await expect.poll(()=>p.evaluate(()=>state.online.connected)).toBe(true);await p.evaluate(()=>{state.deckBuilder.counts.player=createAutoDeckCounts();document.getElementById('onlineDeckSelect').dispatchEvent(new Event('change',{bubbles:true}));});await p.locator('#onlineReadyButton').click();}
  await expect.poll(()=>host.evaluate(()=>state.online.remoteReady)).toBe(true);await host.locator('#onlineStartButton').click();await expect.poll(()=>guest.evaluate(()=>state.online.started)).toBe(true);
  const actor=actorSide==='player'?host:guest;
  const seq=await host.evaluate(side=>{
   startCardTest('endless_talker');state.testMode=false;state.training.skipAnimations=true;state.currentSide=side;state.environment=makeBoardCard(createCardFromBase('classroom','player'));
   for(const owner of ['player','opponent']){
    const p=state.players[owner];Object.assign(p,{board:{teacher:null,seats:Array(9).fill(null)},hand:[],deck:[],trash:[],late:[],will:10,maxWill:10,life:14});
    p.hand=['ruler','general_student'].map(id=>createCardFromBase(id,owner));p.deck=['general_teacher','onigiri_draw'].map(id=>createCardFromBase(id,owner));p.trash=['vampire','ruler'].map(id=>createCardFromBase(id,owner));
    const fused=makeBoardCard(createCardFromBase('chugidesu',owner));fused.handFusionStored=[createCardFromBase('general_student',owner),createCardFromBase('ruler',owner)];p.board.seats[0]=fused;
   }
   state.players[side].hand.unshift(createCardFromBase('endless_talker',side));render();return state.online.lastSnapshotSeq;
  },actorSide);
  await expect.poll(()=>guest.evaluate(()=>state.online.lastSnapshotSeq)).toBeGreaterThanOrEqual(seq);for(const p of [host,guest])await expect.poll(()=>p.evaluate(()=>battlePresentationBusy())).toBe(false);
  await actor.locator('#playerHand [data-base-id="endless_talker"]').click();await actor.locator('#playerSeatGrid .slot[data-index="2"]').click();
  await expect.poll(()=>host.evaluate(()=>state.players.player.maxWill)).toBe(3);
  for(const p of [host,guest]){
   const side=p===host?actorSide:actorSide==='player'?'opponent':'player';
   await expect.poll(async()=>{
    const rows=await p.evaluate(side=>['player','opponent'].map(owner=>({max:state.players[owner].maxWill,will:state.players[owner].will,deck:state.players[owner].deck.length,trash:state.players[owner].trash.length,hand:state.players[owner].hand.length,refs:listBoardRefs(owner).map(getBoardCardFromRef).map(c=>c.baseId),actor:owner===side})),side);
    return rows.sort((a,b)=>Number(b.actor)-Number(a.actor));
   }).toEqual([
    {max:3,will:0,deck:7,trash:1,hand:1,refs:['endless_talker'],actor:true},
    {max:3,will:3,deck:7,trash:1,hand:1,refs:[],actor:false}
   ]);
  }
  const canonical=await host.evaluate(()=>['player','opponent'].map(side=>state.players[side].deck.map(c=>[c.baseId,c.cost])));
  const remote=await guest.evaluate(()=>['opponent','player'].map(side=>state.players[side].deck.map(c=>[c.baseId,c.cost])));expect(remote).toEqual(canonical);expect(errors).toEqual([]);
 }finally{await Promise.all(contexts.map(c=>c.close()));}
});
