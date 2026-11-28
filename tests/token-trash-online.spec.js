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


for(const actorSide of ['player','opponent'])test(`トークンを含む2枚の校外送りを双方と観戦者へ同期 ${actorSide}`,async({browser})=>{
 test.setTimeout(90000);
 const contexts=await Promise.all(Array.from({length:3},()=>browser.newContext()));
 const [host,guest,spectator]=await Promise.all(contexts.map(c=>c.newPage()));const errors=[];
 try{
  for(const p of [host,guest,spectator]){p.on('pageerror',e=>errors.push(e.message));await p.goto(gameUrl.href);await p.locator('#homeNavBattleButton').click();}
  for(const p of [host,guest])await p.locator('#onlinePrivateMatchButton').click();
  await host.locator('#onlineCreateRoomButton').click();await expect.poll(()=>host.evaluate(()=>state.online.role)).toBe('host');
  const code=await host.evaluate(()=>state.online.roomCode);
  await guest.locator('.private-code-entry > summary').click();await guest.locator('#onlineRoomInput').fill(code);await guest.locator('#onlineJoinRoomButton').click();
  for(const p of [host,guest]){await expect.poll(()=>p.evaluate(()=>state.online.connected)).toBe(true);await p.evaluate(()=>{state.deckBuilder.counts.player=createAutoDeckCounts();document.getElementById('onlineDeckSelect').dispatchEvent(new Event('change',{bubbles:true}));});await p.locator('#onlineReadyButton').click();}
  await expect.poll(()=>host.evaluate(()=>state.online.remoteReady)).toBe(true);await host.locator('#onlineStartButton').click();await expect.poll(()=>guest.evaluate(()=>state.online.started)).toBe(true);
  await host.evaluate(side=>{
   startCardTest('failure_student');state.testMode=false;state.training.skipAnimations=true;state.currentSide=side;state.environment=null;state.log=[];state.trashDetailEvents=[];
   for(const owner of ['player','opponent'])Object.assign(state.players[owner],{board:{teacher:null,seats:Array(9).fill(null)},hand:[],deck:[],trash:[],late:[],life:20,will:10,maxWill:10});
   state.players[side].hand=['failure_student','exploding_student','ruler'].map(id=>createCardFromBase(id,side));render();onlineBroadcastState(true);
  },actorSide);
  await spectator.locator('#onlineSpectateButton').click();await spectator.locator('#onlineSpectateRoomInput').fill(code);await spectator.locator('#onlineSpectateSearchButton').click();
  await expect.poll(()=>spectator.evaluate(()=>state.online.started)).toBe(true);
  for(const p of [host,guest,spectator])await expect.poll(()=>p.evaluate(()=>battlePresentationBusy())).toBe(false);
  const actor=actorSide==='player'?host:guest;
  await actor.locator('#playerHand [data-base-id="failure_student"]').click();await actor.locator('#playerSeatGrid .slot[data-index="4"]').click();
  await expect.poll(()=>actor.evaluate(()=>state.pendingCardChoice?.mode)).toBe(actorSide==='player'?'bad_student_discard':'bad_student_online_play');
  await expect.poll(()=>actor.evaluate(()=>battlePresentationBusy())).toBe(false);
  await actor.locator('#threeGesturesHand .card').nth(0).click();await actor.locator('#threeGesturesHand .card').nth(1).click();await actor.locator('#threeGesturesConfirmButton').click();
  for(const p of [host,guest,spectator]){
   const side=p===guest?(actorSide==='player'?'opponent':'player'):actorSide;
   await expect.poll(()=>p.evaluate(side=>state.players[side].trash.map(c=>c.baseId),side)).toEqual(['exploding_student','ruler']);
   expect(await p.evaluate(side=>({hand:state.players[side].hand.length,vanished:state.players[side].trash.some(c=>c.tokenVanished)}),side)).toEqual({hand:0,vanished:false});
   await expect.poll(()=>p.evaluate(()=>state.trashDetailEvents.find(e=>e.cards.length===2)?.cards.map(c=>c.baseId))).toEqual(['exploding_student','ruler']);
   await p.locator('#battleLogButton').click();await expect(p.locator('#log .log-trash-count-button')).toHaveText('2枚');
  }
  expect(errors).toEqual([]);
 }finally{await Promise.all(contexts.map(c=>c.close()));}
});
