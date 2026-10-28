const {test,expect}=require('@playwright/test');
const {pathToFileURL}=require('node:url');
const path=require('node:path');
const fs=require('node:fs');
const series=['wonton_greeting','wonton_stall','wonton_fever','wonton_rebellion','wonton_final_battle','wonton_graduation'];
const ids=['wonton_ki','female_highball','male_highball',...series];
const url=pathToFileURL(path.join(__dirname,'../index.html')).href;
async function settle(page){await expect.poll(()=>page.evaluate(()=>fusionTasksBusy()),{timeout:15000}).toBe(false);}
async function choose(page,predicate=''){
  await expect.poll(()=>page.evaluate(()=>state.pendingCardChoice?.mode)).toMatch(/^fusion_effect_(choice|online_response)$/);
  await page.evaluate(baseId=>{const c=state.pendingCardChoice.cards.find(c=>!baseId||c.baseId===baseId);toggleCardChoiceCard(c.instanceId);confirmCardChoiceSelection();},predicate);
}
test.beforeEach(async({page})=>{
  await page.goto(url);
  await page.evaluate(()=>{
    startCardTest('wonton_greeting');scheduleOpponentAI=()=>{};state.training.skipAnimations=true;
    state.phase='battle';state.currentSide='player';state.actionTurn=8;state.environment=null;
    for(const side of ['player','opponent']) Object.assign(state.players[side],{board:{teacher:null,seats:Array(9).fill(null)},hand:[],deck:[],trash:[],late:[],life:10,will:20,maxWill:20,submissionCounters:{},effectUseLockTurnsRemaining:0});
  });
});
test('9枚の能力値・本文・生成専用登録と管理ログ表示情報を同期',async({page})=>{
  const catalog=require('../server/card-catalog.json');
  const ledger=JSON.parse(fs.readFileSync(path.join(__dirname,'../カード管理台帳.html'),'utf8').match(/const CARDS = (\[[^\r\n]*\]);/)[1]);
  expect(await page.evaluate(() => Object.entries(CARD_BASES).filter(([,card])=>card.submission).map(([id])=>id))).toEqual(series);
  const data=await page.evaluate(ids=>ids.map(id=>{const c=CARD_BASES[id];return {id,name:c.name,stats:[c.cost,c.attack,c.hp],text:cardRulesText(createCardFromBase(id,'player')),direct:DIRECT_DECK_CARD_IDS.has(id),generated:!!c.generated};}),ids);
  for(const [i,c]of data.entries()){
    expect(c.stats).toEqual([i===0?4:i<3?3:8,0,0]);expect(c.direct).toBe(i<3);expect(c.generated).toBe(i>=3);
    expect(catalog.names[c.id]).toBe(c.name);expect(catalog.display[c.id].cost).toBe(c.stats[0]);
    const raw=JSON.parse(fs.readFileSync(path.join(__dirname,'../card_rules.txt'),'utf8').split('\n').find(line=>line.trimStart().startsWith(c.id+':')).trim().replace(/^[^:]+: /,'').replace(/,$/,''));
    expect(c.text.replaceAll('\n','')).toBe(raw.replace('提出したとき','[提出]したとき').replaceAll('\n',''));
    expect(ledger.find(card=>card.id===c.id).effect).toBe(raw);
    if(i>=3){expect(c.text).toMatch(/^\[提出\]\n自分の万豚記カウントを1増やす。その後、/);}
  }
});
test('提出を持たない通常カードでは出席・使用・手札捨て・装備をしても提出しない', async ({ page }) => {
  await page.evaluate(() => {
    window.unexpectedSubmissions = [];
    for (const id of ['general_student', 'general_teacher', 'vampire', 'peaceful_mind', 'earphones']) {
      if (CARD_BASES[id].submission) throw new Error('通常カードに提出が付いている: ' + id);
      SUBMISSION_EFFECT_HANDLERS[id] = () => unexpectedSubmissions.push(id);
    }
    state.players.player.submissionCounters = { '万豚記カウント': 4 };
    for (const [id, zone, index] of [['general_student', 'seat', 0], ['general_teacher', 'teacher', null], ['vampire', 'seat', 1]]) {
      attendCard('player', makeBoardCard(createCardFromBase(id, 'player')), zone, index, { attendanceSource: ATTENDANCE_SOURCE.GENERATED });
    }
    const discarded = createCardFromBase('general_student', 'player');
    const item = createCardFromBase('peaceful_mind', 'player');
    const equipment = createCardFromBase('earphones', 'player');
    state.players.player.hand = [discarded, item, equipment];
    moveHandCardToTrash('player', discarded, { effectDiscard: true });
    castImmediateItem('player', item, false);
    castItemOnCard('player', equipment, 'player', 'seat', 0, false);
  });
  await settle(page);
  expect(await page.evaluate(() => [unexpectedSubmissions, state.players.player.submissionCounters]))
    .toEqual([[], { '万豚記カウント': 4 }]);
});
test('用語台帳では提出の共通条件と万豚記固有のカウントを別項目にする', () => {
  const rules=JSON.parse(fs.readFileSync(path.join(__dirname,'../ルール・用語管理台帳.html'),'utf8').match(/const RULES = (\[[^\r\n]*\]);/)[1]);
  const submission=rules.find(rule=>rule.id==='submission');
  expect(submission.body).toContain('同じプレイで複数の条件を満たしても、発動は1回だけ');
  expect(submission.body).not.toContain('カウント');
  expect(rules.find(rule=>rule.id==='wonton_counter').body).toContain('万豚記シリーズのカード本文に従って増加・参照・リセットする');
});
for (const [baseId, zone] of [['general_student', 'seat'], ['general_teacher', 'teacher'], ['vampire', 'seat']]) {
  test(`テストで提出を付けた${baseId}はカウントなしで出席時効果を発動できる`, async ({ page }) => {
    await page.evaluate(({ baseId, zone }) => {
      CARD_BASES[baseId].submission = true;
      window.submissionCalls = [];
      SUBMISSION_EFFECT_HANDLERS[baseId] = (side, source, cause) => {
        submissionCalls.push([source.baseId, cause]);
        healPlayer(side, 1);
      };
      state.players.player.submissionCounters = { '別のカウント': 7 };
      const card = makeBoardCard(createCardFromBase(baseId, 'player'));
      attendCard('player', card, zone, zone === 'seat' ? 0 : null, { attendanceSource: ATTENDANCE_SOURCE.GENERATED });
    }, { baseId, zone });
    await settle(page);
    expect(await page.evaluate(() => ({
      calls: submissionCalls,
      counters: state.players.player.submissionCounters,
      life: state.players.player.life
    }))).toEqual({ calls: [[baseId, 'field']], counters: { '別のカウント': 7 }, life: 11 });
  });
}
test('万豚記以外の提出は効果による手札捨てでも発動し、カウントを増やさない', async ({ page }) => {
  await page.evaluate(() => {
    CARD_BASES.general_student.submission = true;
    window.submissionCalls = [];
    SUBMISSION_EFFECT_HANDLERS.general_student = (side, source, cause) => {
      submissionCalls.push(cause);
      healPlayer(side, 1);
    };
    state.players.player.submissionCounters = { '万豚記カウント': 4 };
    const card = createCardFromBase('general_student', 'player');
    state.players.player.hand = [card];
    moveHandCardToTrash('player', card, { effectDiscard: true });
  });
  await settle(page);
  expect(await page.evaluate(() => [submissionCalls, state.players.player.submissionCounters, state.players.player.life]))
    .toEqual([['discard'], { '万豚記カウント': 4 }, 11]);
});
test('提出を持つ持ち物は使用で1回だけ発動し、手札に残って再使用した場合はもう1回発動する', async ({ page }) => {
  await page.evaluate(() => {
    CARD_BASES.peaceful_mind.submission = true;
    window.submissionCalls = [];
    SUBMISSION_EFFECT_HANDLERS.peaceful_mind = (side, source, cause) => submissionCalls.push(cause);
    state.players.player.retainNextUsedItem = true;
    const card = createCardFromBase('peaceful_mind', 'player');
    state.players.player.hand = [card];
    castImmediateItem('player', card, false);
  });
  await settle(page);
  expect(await page.evaluate(() => [submissionCalls, state.players.player.hand.map(card => card.baseId)]))
    .toEqual([['use'], ['peaceful_mind']]);
  await page.evaluate(() => castImmediateItem('player', state.players.player.hand[0], false));
  await settle(page);
  expect(await page.evaluate(() => [submissionCalls, state.players.player.hand.length, state.players.player.submissionCounters]))
    .toEqual([['use', 'use'], 0, {}]);
});
test('提出を持つ装備は使用から装備までの1プレイで1回だけ発動する', async ({ page }) => {
  await page.evaluate(() => {
    CARD_BASES.earphones.submission = true;
    window.submissionCalls = [];
    SUBMISSION_EFFECT_HANDLERS.earphones = (side, source, cause) => submissionCalls.push(cause);
    state.players.player.board.seats[0] = makeBoardCard(createCardFromBase('general_student', 'player'));
    const card = createCardFromBase('earphones', 'player');
    state.players.player.hand = [card];
    castItemOnCard('player', card, 'player', 'seat', 0, false);
  });
  await settle(page);
  expect(await page.evaluate(() => [submissionCalls, isEarphoneEquipped(state.players.player.board.seats[0]), state.players.player.submissionCounters]))
    .toEqual([['use'], true, {}]);
});
for(const id of series)test(`提出の各効果・カウント先行・生成 ${id}`,async({page})=>{
  await page.evaluate(id=>{
    state.players.player.submissionCounters={'万豚記カウント':4};
    state.players.player.deck=[createCardFromBase('general_student','player')];
    state.players.opponent.board.seats[0]=makeBoardCard(createCardFromBase('strong_student','opponent'));
    state.players.player.board.seats[4]=makeBoardCard(createCardFromBase('general_student','player'));
    const c=createCardFromBase(id,'player');state.players.player.hand=[c];moveHandCardToTrash('player',c,{effectDiscard:true});
  },id);
  if(id==='wonton_final_battle') await choose(page);
  await settle(page);
  const r=await page.evaluate(()=>({count:state.players.player.submissionCounters['万豚記カウント'],other:state.players.opponent.submissionCounters,hand:state.players.player.hand.map(c=>c.baseId),life:state.players.player.life,enemyLife:state.players.opponent.life,enemyHp:state.players.opponent.board.seats[0]?.currentHp,own:[state.players.player.board.seats[4].attack,state.players.player.board.seats[4].maxHp]}));
  const i=series.indexOf(id);expect(r.count).toBe(i===5?0:5);expect(r.other).toEqual({});
  if(i<5)expect(r.hand).toContain(series[i+1]);
  if(i===0)expect(r.hand).toContain('general_student');
  if(i===1)expect(r.life).toBe(12);
  if(i===2)expect(r.enemyHp).toBe(4);
  if(i===3)expect(r.enemyHp).toBe(6);
  if(i===4)expect(r.own).toEqual([4,4]);
  if(i===5)expect(r.enemyLife).toBe(0);
});
for(const n of [0,1,8])test(`卒業は増加後に計算し最大10、初期${n}`,async({page})=>{
  await page.evaluate(n=>{state.players.opponent.life=20;state.players.player.submissionCounters={'万豚記カウント':n};const c=createCardFromBase('wonton_graduation','player');state.players.player.hand=[c];moveHandCardToTrash('player',c,{effectDiscard:true});},n);
  await settle(page);expect(await page.evaluate(()=>[state.players.opponent.life,state.players.player.submissionCounters['万豚記カウント']])).toEqual([20-Math.min(10,(n+1)*2),0]);
});
test('直接配置と効果配置、環境の置き換えで二重発動・カウント消失しない',async({page})=>{
  await page.evaluate(()=>{const c=createCardFromBase('wonton_greeting','player');state.players.player.hand=[c];state.players.player.deck=[createCardFromBase('general_student','player')];state.players.player.hand=[];attendCard('player',makeBoardCard(c),'environment',null,{attendanceSource:ATTENDANCE_SOURCE.HAND});});
  await settle(page);expect(await page.evaluate(()=>state.players.player.submissionCounters['万豚記カウント'])).toBe(1);
  await page.evaluate(()=>attendCard('player',makeBoardCard(createCardFromBase('wonton_stall','player')),'environment',null,{attendanceSource:ATTENDANCE_SOURCE.GENERATED}));
  await settle(page);expect(await page.evaluate(()=>[state.players.player.submissionCounters['万豚記カウント'],state.players.player.life])).toEqual([2,12]);
});
test('使用後の校外・山札から校外・場から校外・高負荷は提出しない',async({page})=>{
  await page.evaluate(()=>{
    let c=createCardFromBase('wonton_greeting','player');state.players.player.hand=[c];moveHandCardToTrash('player',c);
    moveToTrash('player',createCardFromBase('wonton_greeting','player'),{sourceZone:'deck'});
    moveToTrash('player',makeBoardCard(createCardFromBase('wonton_greeting','player')),{sourceZone:'environment'});
    c=createCardFromBase('wonton_greeting','player');c.handLoadLevel=2;state.players.player.hand=[c];
    if(moveHandCardToTrash('player',c,{effectDiscard:true}))throw new Error('高負荷を校外へ送れた');
  });
  await settle(page);expect(await page.evaluate(()=>state.players.player.submissionCounters)).toEqual({});
});
test('公開済み手札を校外へ送っても提出する／相手側のカウント',async({page})=>{
  await page.evaluate(()=>{const c=createCardFromBase('wonton_stall','opponent');state.players.opponent.hand=[c];state.players.opponent.hand=[];moveToTrash('opponent',c,{sourceZone:'hand',handRevealShown:true});});
  await settle(page);expect(await page.evaluate(()=>[state.players.opponent.submissionCounters['万豚記カウント'],state.players.opponent.life,state.players.player.submissionCounters])).toEqual([1,12,{}]);
});
test('対象がいなくても次の生成とカウントは進む',async({page})=>{
  for(const id of ['wonton_fever','wonton_final_battle']){
    await page.evaluate(id=>{const c=createCardFromBase(id,'player');state.players.player.hand=[c];moveHandCardToTrash('player',c,{effectDiscard:true});},id);await settle(page);
  }
  expect(await page.evaluate(()=>[state.players.player.submissionCounters['万豚記カウント'],state.players.player.hand.map(c=>c.baseId)])).toEqual([2,['wonton_graduation']]);
});
test('ハイボールの使用条件・本人を除く選択・女はドローと回復',async({page})=>{
  expect(await page.evaluate(()=>{const f=createCardFromBase('female_highball','player'),m=createCardFromBase('male_highball','player');state.players.player.hand=[f];const alone=canUseHighball('player',f);state.players.player.hand=[f,m];return [alone,canUseHighball('player',f),canUseHighball('player',m),highballDiscardCandidates('player',f).map(c=>c.baseId)];})).toEqual([false,true,false,['male_highball']]);
  await page.evaluate(()=>{state.players.player.deck=[createCardFromBase('general_student','player')];castHighball('player',state.players.player.hand[0],false);});
  await choose(page,'male_highball');await settle(page);
  expect(await page.evaluate(()=>[state.players.player.life,state.players.player.will,state.players.player.hand.map(c=>c.baseId),state.players.player.trash.map(c=>c.baseId)])).toEqual([12,17,['general_student'],['female_highball','male_highball']]);
});
for(const id of ids)test(`実際のカードテスト開始状態で使える ${id}`,async({page})=>{
  await page.evaluate(id=>{startCardTest(id);scheduleOpponentAI=()=>{};state.training.skipAnimations=true;},id);
  await expect.poll(()=>page.evaluate(()=>battlePresentationBusy())).toBe(false);
  const before=await page.evaluate(id=>({hand:state.players.player.hand.map(c=>c.baseId),life:state.players.player.life,deck:state.players.player.deck.map(c=>c.baseId),own:listBoardRefs('player').length,enemy:listBoardRefs('opponent').length}),id);
  expect(before.hand).toContain(id);expect(before.hand).toContain('wonton_greeting');expect(before.life).toBe(10);expect(before.own).toBeGreaterThan(0);expect(before.enemy).toBeGreaterThan(0);
  await page.evaluate(id=>{const c=state.players.player.hand.find(c=>c.baseId===id);if(c.type==='item')castImmediateItem('player',c,false);else playCard(c.instanceId,'environment','player');},id);
  if(id.includes('highball')){await choose(page,'wonton_greeting');if(id==='male_highball')await choose(page);}
  if(id==='wonton_final_battle')await choose(page);
  await settle(page);
  if(id==='wonton_ki')expect(await page.evaluate(()=>state.players.player.hand.filter(c=>c.baseId==='wonton_greeting').length)).toBe(2);
  else expect(await page.evaluate(()=>state.players.player.submissionCounters['万豚記カウント'])).toBe(id==='wonton_graduation'?0:1);
});

test('万豚記は双方のターン終了時に各自の手札を1枚だけ提出する',async({page})=>{
  for(const side of ['player','opponent']){
    await page.evaluate(side=>{state.environment=createCardFromBase('wonton_ki','player');const c=createCardFromBase('wonton_stall',side);state.players[side].hand=[c];resolveEnvironmentEndTurnEffects(side,{meguroDiscardId:c.instanceId});},side);await settle(page);
  }
  expect(await page.evaluate(()=>['player','opponent'].map(s=>[state.players[s].submissionCounters['万豚記カウント'],state.players[s].hand.map(c=>c.baseId)]))).toEqual([[1,['wonton_fever']],[1,['wonton_fever']]]);
  expect(await page.evaluate(()=>{state.kashikashiActionTurn=state.actionTurn;return needsMeguroHandChoice('player');})).toBe(false);
});
test('無能力コピー・出席時効果禁止では配置による提出をしない',async({page})=>{
  await page.evaluate(()=>{const c=createCardFromBase('wonton_stall','player');c.generatedWithoutEffects=true;state.players.player.hand=[c];moveHandCardToTrash('player',c,{effectDiscard:true});state.players.player.effectUseLockTurnsRemaining=1;attendCard('player',makeBoardCard(createCardFromBase('wonton_greeting','player')),'environment',null,{attendanceSource:ATTENDANCE_SOURCE.HAND});});
  await settle(page);expect(await page.evaluate(()=>state.players.player.submissionCounters)).toEqual({});
});
test('ゲストのハイボールの手札・盤面選択と提出後の状態が同期する',async({page:host,browser})=>{
  const guest=await browser.newPage();
  async function relay(from,to){for(const message of await from.evaluate(()=>outbox.splice(0)))await to.evaluate(message=>onlineHandleMessage({...message,type:message.command?'command':message.type,protocol:ONLINE_PROTOCOL_VERSION}),message);}
  try{
    await guest.goto(url);
    for(const [p,role]of[[host,'host'],[guest,'guest']]){
      await p.evaluate(role=>{Object.assign(state.online,{role,started:true,connected:true,conn:{}});window.outbox=[];onlineSend=message=>{outbox.push(JSON.parse(JSON.stringify(message)));return true;};},role);
    }
    await expect.poll(()=>host.evaluate(()=>battlePresentationBusy())).toBe(false);
    const snapshot=await host.evaluate(()=>{
      state.currentSide='opponent';state.players.player.board.seats[0]=makeBoardCard(createCardFromBase('strong_student','player'));
      state.players.opponent.hand=[createCardFromBase('male_highball','opponent'),createCardFromBase('wonton_stall','opponent')];return onlineCreateSnapshot();
    });
    await guest.evaluate(snapshot=>onlineHandleMessage({type:'gameState',protocol:ONLINE_PROTOCOL_VERSION,snapshot}),snapshot);
    await expect.poll(()=>guest.evaluate(()=>battlePresentationBusy())).toBe(false);
    await guest.evaluate(()=>beginItemUse(state.players.player.hand[0]));await relay(guest,host);
    await expect.poll(()=>host.evaluate(()=>state.pendingRemoteHandTrim?.mode)).toBe('fusion_effect_choice');
    await relay(host,guest);await choose(guest,'wonton_stall');await relay(guest,host);
    await expect.poll(()=>host.evaluate(()=>state.pendingRemoteHandTrim?.mode)).toBe('fusion_effect_choice');
    await relay(host,guest);await choose(guest);await relay(guest,host);await settle(host);await relay(host,guest);
    expect(await host.evaluate(()=>[state.players.opponent.life,state.players.opponent.submissionCounters['万豚記カウント'],state.players.player.board.seats[0].currentHp])).toEqual([12,1,3]);
    expect(await guest.evaluate(()=>[state.players.player.life,state.players.player.submissionCounters['万豚記カウント'],listBoardRefs("opponent").map(getBoardCardFromRef)[0].currentHp])).toEqual([12,1,3]);
  }finally{await guest.close();}
});

test('カード一覧から関連シリーズをたどり、詳細のテストボタンで開始できる',async({page})=>{
  await page.goto(url);await page.locator('#homeNavDeckButton').click();await page.locator('[data-case-view="cards"]').click();
  await page.locator('#cardsCatalogSearch').fill('万豚記');await page.locator('[data-catalog-card="wonton_ki"]').click();
  for(const id of series){await page.locator(`#cardTestModal .tooltip-effect [data-related-card="${id}"]`).first().click();expect(await page.evaluate(()=>state.pendingTestCardId)).toBe(id);}
  await page.locator('#cardTestStartButton').click();await page.evaluate(()=>{scheduleOpponentAI=()=>{};state.training.skipAnimations=true;});
  await expect.poll(()=>page.evaluate(()=>battlePresentationBusy())).toBe(false);
  expect(await page.evaluate(()=>[state.testMode,state.players.player.hand[0].baseId,state.players.player.submissionCounters['万豚記カウント']])).toEqual([true,'wonton_graduation',4]);
  await page.screenshot({path:test.info().outputPath('wonton-card-test-desktop.png')});
});

test('CPUもハイボールで提出カードを選び、通常の対象処理で解決する',async({page})=>{
  await page.evaluate(()=>{state.currentSide='opponent';const item=createCardFromBase('female_highball','opponent');state.players.opponent.hand=[item,createCardFromBase('general_student','opponent'),createCardFromBase('wonton_stall','opponent')];castImmediateItem('opponent',item,false);});
  await settle(page);expect(await page.evaluate(()=>[state.players.opponent.life,state.players.opponent.submissionCounters['万豚記カウント'],state.players.opponent.hand.map(c=>c.baseId)])).toEqual([14,1,['general_student','wonton_fever']]);
});
test('カウント表示は環境を上書き・継続効果無効でも保持し、提出のみの環境を継続効果と誤表示しない',async({page})=>{
  expect(await page.evaluate(()=>{state.players.player.submissionCounters={'万豚記カウント':3};state.environment=createCardFromBase('wonton_ki','player');const count=playerActiveEffectLines('player').filter(x=>x.startsWith('万豚記：')).length;state.environment=createCardFromBase('wonton_greeting','player');const instant=environmentActiveEffectLines('player');state.kashikashiActionTurn=state.actionTurn;return [count,instant,playerActiveEffectLines('player')];})).toEqual([1,[],['万豚記カウント：3']]);
});

test('ハイボールは既存の使用演出後に手札選択を開き、提出の演出も表示する',async({page})=>{
  await expect.poll(()=>page.evaluate(()=>battlePresentationBusy())).toBe(false);
  await page.evaluate(()=>{state.training.skipAnimations=false;const item=createCardFromBase('female_highball','player');state.players.player.hand=[item,createCardFromBase('wonton_stall','player')];render();});
  await expect.poll(()=>page.evaluate(()=>battlePresentationBusy())).toBe(false);
  await page.evaluate(()=>beginItemUse(state.players.player.hand[0]));
  await expect(page.locator('#playRevealCard')).toContainText('女のハイボール');
  expect(await page.evaluate(()=>state.pendingCardChoice)).toBeNull();
  await choose(page,'wonton_stall');await settle(page);
  expect(await page.evaluate(()=>[state.players.player.submissionCounters['万豚記カウント'],state.players.player.life])).toEqual([1,14]);
});
