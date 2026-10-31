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

for(const actorSide of ['player','opponent'])test(`実WebSocketで手札融合・出席・選択・素材分解が同期する ${actorSide}`,async({browser})=>{
 test.setTimeout(120000);const contexts=await Promise.all([browser.newContext(),browser.newContext()]);const[host,guest]=await Promise.all(contexts.map(c=>c.newPage()));const errors=[];
 try{
  for(const p of [host,guest]){p.on('pageerror',e=>errors.push(e.message));await p.goto(gameUrl.href);await p.locator('#homeNavBattleButton').click();await p.locator('#onlinePrivateMatchButton').click();}
  await host.locator('#onlineCreateRoomButton').click();await expect.poll(()=>host.evaluate(()=>state.online.role)).toBe('host');await guest.locator('.private-code-entry > summary').click();await guest.locator('#onlineRoomInput').fill(await host.evaluate(()=>state.online.roomCode));await guest.locator('#onlineJoinRoomButton').click();
  for(const p of [host,guest]){await expect.poll(()=>p.evaluate(()=>state.online.connected)).toBe(true);await p.evaluate(()=>{state.deckBuilder.counts.player=createAutoDeckCounts();document.getElementById('onlineDeckSelect').dispatchEvent(new Event('change',{bubbles:true}));});await p.locator('#onlineReadyButton').click();}
  await expect.poll(()=>host.evaluate(()=>state.online.remoteReady)).toBe(true);await host.locator('#onlineStartButton').click();await expect.poll(()=>guest.evaluate(()=>state.online.started)).toBe(true);
  const actor=actorSide==='player'?host:guest;
  for(const scenario of [{id:'private_teacher',materials:2},{id:'chugidesu',materials:2},{id:'chugidesu',materials:3},{id:'rear_queen',materials:2},{id:'tomoyo_mou',materials:1},{id:'shukii',materials:1}]){
   const {id,materials}=scenario;
   const setup=await host.evaluate(({side,id,materials})=>{
    startCardTest(id);state.testMode=false;state.training.skipAnimations=true;state.currentSide=side;state.environment=null;
    for(const owner of ['player','opponent'])Object.assign(state.players[owner],{board:{teacher:null,seats:Array(9).fill(null)},hand:[],deck:[],trash:[],late:[],will:id==='tomoyo_mou'?4:12,maxWill:12,life:10});
    const own=state.players[side];own.hand=[id,...['general_student','ruler','onigiri_draw'].slice(0,materials)].map(id=>createCardFromBase(id,side));own.deck=['dark_yuta','ruler','ruler','general_student'].map(id=>createCardFromBase(id,side));render();return{seq:state.online.lastSnapshotSeq};
   },{side:actorSide,id,materials});
   await expect.poll(()=>guest.evaluate(()=>state.online.lastSnapshotSeq)).toBeGreaterThanOrEqual(setup.seq);for(const p of [host,guest])await expect.poll(()=>p.evaluate(()=>battlePresentationBusy())).toBe(false);
   if(['private_teacher','chugidesu','rear_queen'].includes(id)){
    await actor.evaluate(id=>openAnyHandFusionChoice(state.players.player.hand.find(c=>c.baseId===id)),id);
    await actor.evaluate(()=>{for(const c of state.pendingCardChoice.cards)toggleCardChoiceCard(c.instanceId);confirmCardChoiceSelection();});
    for(const p of [host,guest]){const side=p===host?actorSide:actorSide==='player'?'opponent':'player';await expect.poll(()=>p.evaluate(side=>state.players[side].hand.length,side)).toBe(1);await expect.poll(()=>p.evaluate(()=>battlePresentationBusy())).toBe(false);}
    await actor.evaluate(id=>playCard(state.players.player.hand.find(c=>c.baseId===id).instanceId,id==='private_teacher'?'teacher':'seat','player',id==='private_teacher'?null:4),id);
   }else await actor.evaluate(id=>beginItemUse(state.players.player.hand.find(c=>c.baseId===id)),id);
   if(id==='shukii'){
    await expect.poll(()=>actor.evaluate(()=>!!state.pendingCardChoice)).toBe(true);await actor.evaluate(()=>{toggleCardChoiceCard(state.pendingCardChoice.cards[0].instanceId);confirmCardChoiceSelection();});
   }
   if(id==='chugidesu'&&materials===3){
    await expect.poll(()=>actor.evaluate(()=>!!state.pendingCardChoice)).toBe(true);
    await actor.evaluate(()=>{toggleCardChoiceCard(state.pendingCardChoice.cards.find(c=>c.name==='2人出席させる').instanceId);confirmCardChoiceSelection();});
   }
   if(['rear_queen','chugidesu','tomoyo_mou'].includes(id))for(let i=0;i<(id==='tomoyo_mou'||materials===3?2:1);i++){
    await expect.poll(()=>actor.evaluate(()=>!!state.pendingCopiedCard)).toBe(true);await expect.poll(()=>actor.evaluate(()=>battlePresentationBusy({ignoreFusionTasks:true}))).toBe(false);
    await expect.poll(()=>actor.evaluate(()=>PLAYER_SEAT_ORDER.some(i=>isPendingCopiedCardPlacementLegal('player','seat','player',i)))).toBe(true);
    expect(await actor.evaluate(()=>{const index=PLAYER_SEAT_ORDER.find(i=>isPendingCopiedCardPlacementLegal('player','seat','player',i));return placePendingCopiedCard('seat','player',index);})).toBe(true);
    if(i===0&&id==='tomoyo_mou')await expect.poll(()=>host.evaluate(side=>listBoardRefs(side).length,actorSide)).toBe(1);
   }
   await expect.poll(()=>host.evaluate(()=>fusionTasksBusy())).toBe(false);
   for(const p of [host,guest]){
    const side=p===host?actorSide:actorSide==='player'?'opponent':'player';
    await expect.poll(()=>p.evaluate(({side,id})=>{const own=state.players[side];return[listBoardRefs(side).length,own.hand.length,own.life,own.trash.length];},{side,id})).toEqual(id==='private_teacher'?[1,2,10,0]:id==='chugidesu'?(materials===3?[3,2,12,0]:[2,0,10,0]):id==='rear_queen'?[2,0,10,0]:id==='tomoyo_mou'?[2,0,10,2]:[0,1,10,2]);
   }
   if(id==='private_teacher') for(const p of [host,guest]) {const side=p===host?actorSide:actorSide==='player'?'opponent':'player';expect(await p.evaluate(side=>{const c=state.players[side].board.teacher;return [c.attack,c.currentHp,hasKeyword(c,'陽気'),c.handFusionStored.length];},side)).toEqual([4,4,true,2]);}
  }
  expect(errors).toEqual([]);
 }finally{await Promise.all(contexts.map(c=>c.close()));}
});
