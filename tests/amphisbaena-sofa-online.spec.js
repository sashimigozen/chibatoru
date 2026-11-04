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


for(const actorSide of ['player','opponent'])test(`ソファのホスト・ゲストの選択を実WebSocketで同期 ${actorSide}`,async({browser})=>{
 test.setTimeout(90000);const contexts=await Promise.all([browser.newContext(),browser.newContext()]);const [host,guest]=await Promise.all(contexts.map(c=>c.newPage()));const errors=[];
 try{
  for(const p of [host,guest]){p.on('pageerror',e=>errors.push(e.message));await p.goto(gameUrl.href);await p.locator('#homeNavBattleButton').click();await p.locator('#onlinePrivateMatchButton').click();}
  await host.locator('#onlineCreateRoomButton').click();await expect.poll(()=>host.evaluate(()=>state.online.role)).toBe('host');await guest.locator('.private-code-entry > summary').click();await guest.locator('#onlineRoomInput').fill(await host.evaluate(()=>state.online.roomCode));await guest.locator('#onlineJoinRoomButton').click();
  for(const p of [host,guest]){await expect.poll(()=>p.evaluate(()=>state.online.connected)).toBe(true);await p.evaluate(()=>{state.deckBuilder.counts.player=createAutoDeckCounts();document.getElementById('onlineDeckSelect').dispatchEvent(new Event('change',{bubbles:true}));});await p.locator('#onlineReadyButton').click();}
  await expect.poll(()=>host.evaluate(()=>state.online.remoteReady)).toBe(true);await host.locator('#onlineStartButton').click();await expect.poll(()=>guest.evaluate(()=>state.online.started)).toBe(true);
  const actor=actorSide==='player'?host:guest;
  async function choose(kind,count){await expect.poll(()=>actor.evaluate(()=>state.pendingCardChoice?.context?.kind)).toBe(kind);await actor.evaluate(count=>{for(const c of state.pendingCardChoice.cards.slice(0,count))toggleCardChoiceCard(c.instanceId);confirmCardChoiceSelection();},count);}
  for(const will of [7,8]){
   const seq=await host.evaluate(({side,will})=>{startCardTest('amphisbaena_sofa');state.testMode=false;state.training.skipAnimations=true;state.currentSide=side;state.environment=null;for(const owner of ['player','opponent'])Object.assign(state.players[owner],{board:{teacher:null,seats:Array(9).fill(null)},hand:[],deck:[],trash:[],late:[],will:20,maxWill:20,life:12});const own=state.players[side],enemy=state.players[oppositeSide(side)];own.will=will;own.hand=[createCardFromBase('amphisbaena_sofa',side)];own.deck=['general_student','strong_student','onigiri_draw','classroom'].map(id=>createCardFromBase(id,side));for(const i of [0,4])enemy.board.seats[i]=makeBoardCard(createCardFromBase('strong_student',oppositeSide(side)));render();return state.online.lastSnapshotSeq;},{side:actorSide,will});
   await expect.poll(()=>guest.evaluate(()=>state.online.lastSnapshotSeq)).toBeGreaterThanOrEqual(seq);for(const p of [host,guest])await expect.poll(()=>p.evaluate(()=>battlePresentationBusy())).toBe(false);
   await actor.evaluate(()=>beginItemUse(state.players.player.hand[0]));if(will===7)await choose('sofa_modes',1);await choose('point_destroy',2);if(will===8)await choose('sofa_deck',2);
   await expect.poll(()=>host.evaluate(()=>fusionTasksBusy())).toBe(false);
   for(const p of [host,guest]){const side=p===host?actorSide:actorSide==='player'?'opponent':'player';await expect.poll(()=>p.evaluate(side=>({life:state.players[side].life,will:state.players[side].will,deck:state.players[side].deck.length,enemy:listBoardRefs(oppositeSide(side)).length,trash:state.players[side].trash.length}),side)).toEqual({life:will===8?12:8,will:will===8?0:2,deck:will===8?2:4,enemy:0,trash:will===8?3:1});}
  }
  expect(errors).toEqual([]);
 }finally{await Promise.all(contexts.map(c=>c.close()));}
});
