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


for (const endingSide of ['player','opponent']) for (const effect of ['debuff','infection']) {
 test(`病の${effect}を双方で同じ結果へ同期 ${endingSide}`, async ({browser}) => {
  test.setTimeout(90000);
  const contexts = await Promise.all([browser.newContext(),browser.newContext()]);
  const [host,guest] = await Promise.all(contexts.map(c=>c.newPage()));
  const errors=[];
  try {
   for (const p of [host,guest]) {
    p.on('pageerror',e=>errors.push(e.message));
    await p.goto(gameUrl.href);
    await p.locator('#homeNavBattleButton').click();
    await p.locator('#onlinePrivateMatchButton').click();
   }
   await host.locator('#onlineCreateRoomButton').click();
   await expect.poll(()=>host.evaluate(()=>state.online.role)).toBe('host');
   await guest.locator('.private-code-entry > summary').click();
   await guest.locator('#onlineRoomInput').fill(await host.evaluate(()=>state.online.roomCode));
   await guest.locator('#onlineJoinRoomButton').click();
   for (const p of [host,guest]) {
    await expect.poll(()=>p.evaluate(()=>state.online.connected)).toBe(true);
    await p.evaluate(deck=>{
     state.deckBuilder.counts.player=deck.counts;
     document.getElementById('onlineDeckSelect').dispatchEvent(new Event('change',{bubbles:true}));
    },loDeck);
    await p.locator('#onlineReadyButton').click();
   }
   await expect.poll(()=>host.evaluate(()=>state.online.remoteReady)).toBe(true);
   await host.locator('#onlineStartButton').click();
   await expect.poll(()=>guest.evaluate(()=>state.online.started)).toBe(true);
   const seq = await host.evaluate(({endingSide,effect})=>{
    startCardTest('illness'); state.testMode=false; state.training.skipAnimations=true;
    state.phase='battle'; state.currentSide=endingSide;
    for (const owner of ['player','opponent']) {
     const p=state.players[owner];
     p.board={teacher:null,seats:Array(9).fill(null)};
     for (const i of [0,1,2]) {
      p.board.seats[i]=makeBoardCard(createCardFromBase('strong_student',owner));
      p.board.seats[i].playedOnTurn=0;
     }
     equipIllness(owner,p.board.seats[0],createCardFromBase('illness',oppositeSide(owner)));
    }
    battleRandom=()=>effect==='debuff'?0:0.75;
    resolveEndTurnEffects(endingSide);
    render(); onlineBroadcastState();
    return state.online.lastSnapshotSeq;
   },{endingSide,effect});
   await expect.poll(()=>guest.evaluate(()=>state.online.lastSnapshotSeq)).toBeGreaterThanOrEqual(seq);
   const expected=['player','opponent'].map(owner=>({
    attacks: owner===endingSide ? (effect==='debuff'?[5,7,7]:[6,7,6]):[6,7,7],
    infected: owner===endingSide && effect==='infection'?2:1
   }));
   for (const p of [host,guest]) {
    await expect.poll(()=>p.evaluate(isHost=>(isHost?['player','opponent']:['opponent','player']).map(owner=>({
     attacks:state.players[owner].board.seats.slice(0,3).map(c=>c.attack),
     infected:state.players[owner].board.seats.filter(isIllnessInfected).length
    })),p===host)).toEqual(expected);
   }
   expect(errors).toEqual([]);
  } finally { await Promise.all(contexts.map(c=>c.close())); }
 });
}
