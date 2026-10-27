const {test,expect}=require('@playwright/test');
const {pathToFileURL}=require('node:url');
const path=require('node:path');
const game=pathToFileURL(path.join(__dirname,'..','index.html')).href;
test.beforeEach(async({page})=>{await page.goto(game)});
async function start(page,id){
  await page.evaluate(id=>{state.training.skipAnimations=true;startCardTest(id);scheduleOpponentAI=()=>{}},id);
  await idle(page);
}
async function idle(page){await expect.poll(()=>page.evaluate(()=>battlePresentationBusy({ignoreFusionTasks:true})),{timeout:20000}).toBe(false)}
async function play(page,id,zone='seat',index=4){
  await page.evaluate(({id,zone,index})=>{const c=state.players.player.hand.find(c=>c.baseId===id);if(!c)throw Error('手札なし:'+id);playCard(c.instanceId,zone,'player',index)},{id,zone,index});
  await expect.poll(()=>page.evaluate(()=>Boolean(state.pendingCardPlay))).toBe(false);
  await idle(page);
}
async function item(page,id){
  expect(await page.evaluate(id=>{const c=state.players.player.hand.find(c=>c.baseId===id);return castImmediateItem('player',c,true)},id)).not.toBe(false);
  await idle(page);
}

test('最近の21種類はすぐ使用でき、双方のデッキと条件を用意する',async({page})=>{
  const result=await page.evaluate(()=>Object.keys(CARD_TEST_SCENARIOS).map(id=>{
    state.training.skipAnimations=true;startCardTest(id);
    const p=state.players.player,c=p.hand[0];
    const places=c.type==='item'||['seat','teacher','environment'].some(zone=>zone==='seat'
      ?PLAYER_SEAT_ORDER.some(index=>canPlaceCard('player',c,zone,'player',index))
      :canPlaceCard('player',c,zone,'player',null));
    return {id,usable:canUseHandCardNow(c),places,own:p.deck.length,enemy:state.players.opponent.deck.length,
      valid:p.deck.every(c=>!!CARD_BASES[c.baseId]),deckShown:p.originalDeckCounts[id]>0,note:state.log.some(e=>String(e.text||e).includes(CARD_TEST_SCENARIOS[id].note)),
      students:p.deck.filter(c=>c.type==='student').length,trash:p.trash.filter(c=>c.type==='vampire').length,
      life:p.life,front:p.board.seats.slice(0,3).filter(Boolean).length};
  }));
  expect(result).toHaveLength(21);
  for(const r of result){expect(r.usable,r.id).toBe(true);expect(r.places,r.id).toBe(true);expect(r.own,r.id).toBe(45);expect(r.enemy,r.id).toBe(45);expect(r.valid,r.id).toBe(true);expect(r.deckShown,r.id).toBe(true);expect(r.note,r.id).toBe(true)}
  expect(result.find(r=>r.id==='obon_mac').trash).toBeGreaterThanOrEqual(5);
  for(const id of ['trpg_member','two_achievers'])expect(result.find(r=>r.id===id).students).toBeGreaterThanOrEqual(2);
  expect(result.find(r=>r.id==='smiling_lecturer').life).toBe(10);
  expect(result.find(r=>r.id==='hearty_grandma').life).toBe(10);
  expect(result.find(r=>r.id==='kakiage_teacher').life).toBe(12);
  expect(result.find(r=>r.id==='chotto_machii').life).toBe(20);
});

test('カード確認のテストから気力回復と再回復を順に試せる',async({page})=>{
  test.setTimeout(60000);
  await page.locator('#homeNavDeckButton').click();await page.locator('[data-case-view="cards"]').click();
  await page.locator('#cardsCatalogSearch').fill('微笑み講師');await page.locator('[data-catalog-card="smiling_lecturer"]').click();
  await page.locator('#cardTestStartButton').click();await page.evaluate(()=>{state.training.skipAnimations=true;scheduleOpponentAI=()=>{}});await idle(page);
  expect(await page.evaluate(()=>state.players.player.life)).toBe(10);
  await page.screenshot({path:'/tmp/chibatoru-card-test-smiling-ready.png'});
  await play(page,'smiling_lecturer','teacher',null);
  expect(await page.evaluate(()=>state.players.player.life)).toBe(20);
  await item(page,'fire_touch');expect(await page.evaluate(()=>state.players.player.life)).toBe(16);
  await item(page,'onigiri_draw');expect(await page.evaluate(()=>state.players.player.life)).toBe(20);
});

test('かき揚げ教師を教卓へ出し、ターン終了時の回復を試せる',async({page})=>{
  await start(page,'kakiage_teacher');await play(page,'kakiage_teacher','teacher',null);
  await page.evaluate(()=>resolveTeacherEndTurnEffects('player'));
  expect(await page.evaluate(()=>state.players.player.life)).toBe(13);
});

for(const cafeteria of [false,true]){
  test(`窓辺イーターは用意された手札で${cafeteria?'2':'1'}列を選べる`,async({page})=>{
    await start(page,'window_eater');if(cafeteria)await play(page,'cafeteria','environment',null);
    await play(page,'window_eater');
    await expect(page.locator('.column-choice-button')).toHaveCount(3);
    await page.locator('.column-choice-button[data-column="0"]').click();
    if(cafeteria)await page.locator('.column-choice-button[data-column="1"]').click();
    await page.locator('#itemTargetConfirmButton').click();await expect.poll(()=>page.evaluate(()=>fusionTasksBusy())).toBe(false);
    expect(await page.evaluate(()=>[state.players.opponent.board.seats.filter(Boolean).length,!!state.players.opponent.board.teacher])).toEqual([cafeteria?2:4,true]);
  });
  test(`ジョブズウッディは用意された空席へ${cafeteria?'2':'1'}人出せる`,async({page})=>{
    await start(page,'jobs_woody');if(cafeteria)await play(page,'cafeteria','environment',null);
    await play(page,'jobs_woody','teacher',null);
    for(const index of cafeteria?[4,8]:[4]){
      await expect.poll(()=>page.evaluate(()=>state.pendingCopiedCard?.baseId)).toBe('apprentice_vampire');await idle(page);
      await page.locator(`.slot[data-owner="player"][data-zone="seat"][data-index="${index}"]`).click();
      await expect.poll(()=>page.evaluate(index=>state.players.player.board.seats[index]?.baseId,index)).toBe('apprentice_vampire');
    }
    await expect.poll(()=>page.evaluate(()=>fusionTasksBusy())).toBe(false);
    expect(await page.evaluate(()=>state.players.player.board.seats.filter(c=>c?.baseId==='apprentice_vampire').length)).toBe(cafeteria?2:1);
  });
}

for(const choice of ['draw','load'])test(`2人で成し遂げた学生たちは開始状態のまま${choice}を試せる`,async({page})=>{
  await start(page,'two_achievers');const before=await page.evaluate(()=>state.players.player.hand.length);
  await play(page,'two_achievers','seat',0);
  await expect.poll(()=>page.evaluate(()=>state.pendingCardChoice?.context?.kind)).toBe('two_achievers');
  await page.evaluate(choice=>{state.pendingCardChoice.selectedIds=[`two-achievers-${choice}`];confirmCardChoiceSelection()},choice);
  await expect.poll(()=>page.evaluate(()=>fusionTasksBusy())).toBe(false);
  if(choice==='draw')expect(await page.evaluate(()=>state.players.player.hand.length)).toBe(before+1);
  else expect(await page.evaluate(()=>state.players.opponent.hand.filter(c=>c.handLoadLevel).length)).toBe(2);
});

test('グラサンTAは初期配置のプロ言の長を条件に学生だけへダメージを与える',async({page})=>{
  await start(page,'sunglasses_ta');await play(page,'sunglasses_ta','seat',1);
  expect(await page.evaluate(()=>[state.players.opponent.board.seats[0]?.currentHp,state.players.opponent.board.seats[4]?.currentHp,state.players.opponent.board.seats[8]?.currentHp,state.players.player.board.seats[1]?.maxHp])).toEqual([1,2,6,2]);
});

test('お盆macは最初から使用でき、手札のヴァンパイアだけ戦意が下がる',async({page})=>{
  await start(page,'obon_mac');const before=await page.evaluate(()=>state.players.player.hand.map(c=>[c.baseId,effectiveCardCost(c)]));
  await item(page,'obon_mac');
  const after=await page.evaluate(()=>state.players.player.hand.map(c=>[c.baseId,effectiveCardCost(c)]));
  for(const [id,cost] of after){const old=before.find(c=>c[0]===id)[1];const vampire=await page.evaluate(id=>CARD_BASES[id].type==='vampire',id);expect(cost).toBe(vampire?Math.max(0,old-2):old)}
});

test('ティッシュ配りは食堂・重複・環境を戻した場合を続けて比較できる',async({page})=>{
  await start(page,'tissue_distributor');await play(page,'tissue_distributor','seat',1);
  const normal=await page.evaluate(()=>state.players.player.board.seats[0].maxHp);
  await play(page,'tissue_distributor','seat',2);expect(await page.evaluate(()=>state.players.player.board.seats[0].maxHp)).toBe(normal);
  await play(page,'cafeteria','environment',null);expect(await page.evaluate(()=>state.players.player.board.seats[0].maxHp)).toBe(normal+1);
  await play(page,'classroom','environment',null);expect(await page.evaluate(()=>state.players.player.board.seats[0].maxHp)).toBe(normal);
});

test('一旦は双方の出席者を破壊し、残った手札で再出席できる',async({page})=>{
  await start(page,'ittan');await item(page,'ittan');
  expect(await page.evaluate(()=>[listBoardRefs('player').length,listBoardRefs('opponent').length,state.environment.baseId])).toEqual([0,0,'cafeteria']);
  await play(page,'general_student');expect(await page.evaluate(()=>state.players.player.board.seats[4]?.baseId)).toBe('general_student');
});

test('子曰くで用意された学生3枚をすべて手札に加えられる',async({page})=>{
  await start(page,'confucius_says');await item(page,'confucius_says');
  expect(await page.evaluate(()=>state.players.player.hand.filter(c=>c.type==='student').length)).toBe(3);
});

test('ちょっと待ちぃの後も回復と自分の次の手番を試せる',async({page})=>{
  await start(page,'chotto_machii');await item(page,'chotto_machii');
  expect(await page.evaluate(()=>[state.players.player.life,state.players.opponent.skipAllTurns])).toEqual([1,true]);
  await item(page,'fluid_pasta');expect(await page.evaluate(()=>state.players.player.life)).toBeGreaterThan(1);
  await page.evaluate(()=>finishEndTurn('player'));
  expect(await page.evaluate(()=>state.currentSide)).toBe('player');
});

test('大盛りおばあちゃんは食堂を置いてすぐ攻撃し、減った気力を回復できる',async({page})=>{
  await start(page,'hearty_grandma');await play(page,'cafeteria','environment',null);await play(page,'hearty_grandma','seat',1);
  await page.evaluate(async()=>{selectAttacker('player','seat',1);await attackCard('opponent','seat',4)});
  expect(await page.evaluate(()=>state.players.player.life)).toBe(12);
});

test('アクティングアウトマンは準備済みの仲間で直ちに学生へ2回攻撃できる',async({page})=>{
  await start(page,'acting_out_man');await play(page,'acting_out_man','seat',1);
  expect(await page.evaluate(()=>[state.players.player.board.seats[4].currentHp,state.players.opponent.board.seats[6].currentHp,state.players.opponent.board.seats[7].currentHp,canAttackSilently(state.players.player.board.seats[1])])).toEqual([1,1,2,true]);
  for(let i=0;i<2;i++){await page.evaluate(async()=>{selectAttacker('player','seat',1);await attackCard('opponent','seat',0)});await idle(page)}
  expect(await page.evaluate(()=>[state.players.opponent.board.seats[0],state.players.player.board.seats[1].currentHp])).toEqual([null,3]);
});

test('全ロック後に攻撃で空いた席と元からの空席を比較できる',async({page})=>{
  await start(page,'full_lock');await play(page,'full_lock','environment',null);
  await page.evaluate(async()=>{selectAttacker('player','seat',0);await attackCard('opponent','seat',0)});await idle(page);
  expect(await page.evaluate(()=>{const c=state.players.player.hand.find(c=>c.baseId==='general_student');return [canPlaceCard('player',c,'seat','player',0),canPlaceCard('player',c,'seat','player',1)]})).toEqual([true,false]);
});
