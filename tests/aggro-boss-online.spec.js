const { test, expect } = require("@playwright/test");
const { spawn } = require("node:child_process");
const net = require("node:net");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const loDeck = require("./fixtures/lo-final-lecture-deck.json");
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


for (const actorSide of ['player','opponent']) test(`アグロボスをデッキに入れて開始し、出席・本体攻撃・解除を双方で同期 ${actorSide}`,async({browser})=>{
 test.setTimeout(90000);
 const contexts=await Promise.all([browser.newContext(),browser.newContext(),browser.newContext()]);
 const [host,guest,spectator]=await Promise.all(contexts.map(c=>c.newPage()));const errors=[];
 try {
  for(const p of [host,guest]) {
   p.on('pageerror',e=>errors.push(e.message));await p.goto(gameUrl.href);
   await p.locator('#homeNavBattleButton').click();await p.locator('#onlinePrivateMatchButton').click();
  }
  await host.locator('#onlineCreateRoomButton').click();
  await expect.poll(()=>host.evaluate(()=>state.online.role)).toBe('host');
  await guest.locator('.private-code-entry > summary').click();
  await guest.locator('#onlineRoomInput').fill(await host.evaluate(()=>state.online.roomCode));
  await guest.locator('#onlineJoinRoomButton').click();
  const deck=JSON.parse(JSON.stringify(loDeck));const first=Object.keys(deck.counts).find(id=>deck.counts[id]>0);
  deck.counts[first]--;deck.counts.aggro_boss=1;
  for(const p of [host,guest]) {
   await expect.poll(()=>p.evaluate(()=>state.online.connected)).toBe(true);
   await p.evaluate(deck=>{state.deckBuilder.counts.player=deck.counts;
    document.getElementById('onlineDeckSelect').dispatchEvent(new Event('change',{bubbles:true}));},deck);
   await p.locator('#onlineReadyButton').click();
  }
  await expect.poll(()=>host.evaluate(()=>state.online.remoteReady)).toBe(true);
  await host.locator('#onlineStartButton').click();
  await expect.poll(()=>guest.evaluate(()=>state.online.started)).toBe(true);
  await spectator.goto(gameUrl.href);await spectator.locator('#homeNavBattleButton').click();
  await spectator.locator('#onlineSpectateButton').click();
  await spectator.locator('#onlineSpectateRoomInput').fill(await host.evaluate(()=>state.online.roomCode));
  await spectator.locator('#onlineSpectateSearchButton').click();
  await expect.poll(()=>spectator.evaluate(()=>state.online.started)).toBe(true);
  const seq=await host.evaluate(side=>{
   startCardTest('aggro_boss');state.testMode=false;state.training.skipAnimations=true;
   state.phase='battle';state.currentSide=side;
   for(const owner of ['player','opponent']) Object.assign(state.players[owner],{
    board:{teacher:null,seats:Array(9).fill(null)},hand:[],trash:[],late:[],life:20,will:10,maxWill:10
   });
   const own=state.players[side];own.hand=[createCardFromBase('aggro_boss',side)];
   own.board.seats[0]=makeBoardCard(createCardFromBase('aggro_king',side));own.board.seats[0].playedOnTurn=0;
   own.board.seats[2]=makeBoardCard(createCardFromBase('aggro_boss',side));own.board.seats[2].playedOnTurn=0;
   render();onlineBroadcastState();return state.online.lastSnapshotSeq;
  },actorSide);
  await expect.poll(()=>guest.evaluate(()=>state.online.lastSnapshotSeq)).toBeGreaterThanOrEqual(seq);
  for(const p of [host,guest])await expect.poll(()=>p.evaluate(()=>battlePresentationBusy())).toBe(false);
  const actor=actorSide==='player'?host:guest;
  await actor.evaluate(()=>playCard(state.players.player.hand[0].instanceId,'seat','player',1));
  async function check(expected) {
   for(const p of [host,guest,spectator]) {
    const side=p===guest?(actorSide==='player'?'opponent':'player'):actorSide;
    await expect.poll(()=>p.evaluate(side=>({
     attacks:[1,2].map(i=>state.players[side].board.seats[i]?.attack),
     life:state.players[oppositeSide(side)].life,will:state.players[side].will
    }),side)).toEqual(expected);
   }
  }
  await check({attacks:[0,0],life:20,will:7});
  for(const index of [0,1,2]) {
   for(const p of [host,guest])await expect.poll(()=>p.evaluate(()=>battlePresentationBusy())).toBe(false);
   await actor.evaluate(index=>{
    state.selectedAttacker={owner:'player',zone:'seat',index};attackLife('opponent');
   },index);
   const expected=index===0?{attacks:[1,1],life:19,will:7}
    :index===1?{attacks:[2,2],life:17,will:7}:{attacks:[3,3],life:14,will:7};
   await check(expected);
  }
  const endSeq=await host.evaluate(side=>{
   resolveEndTurnEffects(side);applyBoardAuras();render();onlineBroadcastState();return state.online.lastSnapshotSeq;
  },actorSide);
  await expect.poll(()=>guest.evaluate(()=>state.online.lastSnapshotSeq)).toBeGreaterThanOrEqual(endSeq);
  await check({attacks:[0,0],life:14,will:7});expect(errors).toEqual([]);
 }finally{await Promise.all(contexts.map(c=>c.close()));}
});
