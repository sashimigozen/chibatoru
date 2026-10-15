const { test, expect } = require('@playwright/test');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const fs = require('node:fs');
const url = pathToFileURL(path.join(__dirname, '..', 'index.html')).href;

test.beforeEach(async ({page}) => {
  await page.setViewportSize({width:1440,height:900}); await page.goto(url);
  await page.evaluate(() => {
    startCardTest('remote_participant_student'); scheduleOpponentAI=()=>{};
    state.training.skipAnimations=true; state.environment=null;
    for(const side of ['player','opponent']) Object.assign(state.players[side], {
      board:{teacher:null,seats:Array(9).fill(null)}, hand:[],deck:[],trash:[],late:[],will:0,life:20
    });
    render();
  });
  await expect.poll(()=>page.evaluate(()=>battlePresentationBusy())).toBe(false);
});

test('素材を異名で複製した後、完成品のコピーを出席させ、元を両方残す', async ({page}) => {
  const originals=await page.evaluate(()=>{
    const p=state.players.player;
    p.deck=['fusion_uma','fusion_uma'].map(id=>createCardFromBase(id,'player'));
    p.hand=['fusion_uma','fusion_bone','umaibo'].map(id=>createCardFromBase(id,'player'));
    const original=[p.deck.map(c=>c.instanceId),p.hand.map(c=>c.instanceId)];
    resolveHorseAttendance('player',createCardFromBase('remote_participant_student','player')); return original;
  });
  const choices=page.locator('#threeGesturesHand button.card');
  await expect(choices).toHaveCount(2);
  expect(await page.evaluate(()=>state.pendingCardChoice.context.kind)).toBe('material_optional');
  await choices.nth(0).click(); await choices.nth(1).click();
  await page.locator('#threeGesturesConfirmButton').click();
  await expect.poll(()=>page.evaluate(()=>state.pendingCardChoice?.context.kind)).toBe('attendance');
  expect(await page.evaluate(()=>state.players.player.hand.slice(3).map(c=>c.baseId))).toEqual(['fusion_uma','fusion_bone']);
  await expect(choices).toHaveCount(1); await choices.click();
  await page.locator('#threeGesturesConfirmButton').click();
  await expect.poll(()=>page.evaluate(()=>Boolean(state.pendingCopiedCard))).toBe(true);
  const selector=await page.evaluate(()=>tutorialRefSelector({owner:'player',zone:'seat',index:4}));
  await page.locator(selector).click();
  await expect.poll(()=>page.evaluate(()=>state.players.player.board.seats[4]?.baseId)).toBe('umaibo');
  expect(await page.evaluate(()=>[state.players.player.deck.map(c=>c.instanceId),state.players.player.hand.slice(0,3).map(c=>c.instanceId)])).toEqual(originals);
  expect(await page.evaluate(()=>[state.players.player.will,state.players.player.trash.length,state.players.player.hand.length])).toEqual([0,0,5]);
  await page.screenshot({path:test.info().outputPath('material-then-attendance.png')});
});

test('素材が1種類でも生成し、満席でも素材の複製は行う。CPUも同じ処理', async ({page}) => {
  const result=await page.evaluate(async()=>{
    isCpuControlledBattleSide=()=>true;
    const p=state.players.opponent;
    p.board.seats=Array.from({length:9},()=>makeBoardCard(createCardFromBase('general_student','opponent')));
    p.deck=['fusion_bone','fusion_bone'].map(id=>createCardFromBase(id,'opponent'));
    p.hand=[createCardFromBase('fusion_bone','opponent'),createCardFromBase('umaibo','opponent')];
    const source=createCardFromBase('remote_participant_student','opponent');
    const score=scoreAiFusionCopyAttendance('opponent',source);
    resolveHorseAttendance('opponent',source); await fusionEffectTail;
    return {score,hand:p.hand.map(c=>c.baseId),deck:p.deck.length,pending:!!state.pendingCopiedCard};
  });
  expect(result).toEqual({score:2,hand:['fusion_bone','umaibo','fusion_bone'],deck:2,pending:false});
});

test('2枚までなので素材を1種類だけ選べ、コピー先なしでも完了する', async ({page}) => {
  await page.evaluate(()=>{
    state.players.player.deck=['fusion_uma','fusion_bone'].map(id=>createCardFromBase(id,'player'));
    resolveHorseAttendance('player',createCardFromBase('remote_participant_student','player'));
  });
  await expect(page.locator('#threeGesturesHand button.card')).toHaveCount(2);
  await page.locator('#threeGesturesHand button.card').first().click();
  await page.locator('#threeGesturesConfirmButton').click();
  await expect.poll(()=>page.evaluate(()=>fusionTasksBusy())).toBe(false);
  expect(await page.evaluate(()=>state.players.player.hand.map(c=>c.baseId))).toEqual(['fusion_uma']);
});

test('オンラインで素材選択→コピー元選択を順番に送り、ホストが選択結果を反映する', async ({page}) => {
  await page.evaluate(()=>{
    Object.assign(state.online,{role:'host',connected:true,started:true,conn:{}});
    window.requests=[];
    onlineSend=message=>{if(message.privateChoiceKind==='fusion_effect_choice') requests.push(message);return true;};
    state.players.opponent.deck=[createCardFromBase('fusion_uma','opponent')];
    state.players.opponent.hand=['fusion_bone','umaibo'].map(id=>createCardFromBase(id,'opponent'));
    resolveHorseAttendance('opponent',createCardFromBase('remote_participant_student','opponent'));
  });
  await expect.poll(()=>page.evaluate(()=>requests.length)).toBe(1);
  expect(await page.evaluate(()=>requests[0].cards.map(c=>c.baseId))).toEqual(['fusion_uma','fusion_bone']);
  await page.evaluate(()=>onlineHandleMessage({type:'thinItemChoiceResponse',protocol:ONLINE_PROTOCOL_VERSION,
    privateChoiceKind:'fusion_effect_choice',requestId:requests[0].requestId,selectedIds:requests[0].cards.map(c=>c.instanceId)}));
  await expect.poll(()=>page.evaluate(()=>requests.length)).toBe(2);
  expect(await page.evaluate(()=>[requests[1].cards.map(c=>c.baseId),state.players.opponent.hand.map(c=>c.baseId)]))
    .toEqual([['umaibo'],['fusion_bone','umaibo','fusion_uma','fusion_bone']]);
  await page.evaluate(()=>onlineHandleMessage({type:'thinItemChoiceResponse',protocol:ONLINE_PROTOCOL_VERSION,
    privateChoiceKind:'fusion_effect_choice',requestId:requests[1].requestId,selectedIds:[requests[1].cards[0].instanceId]}));
  await expect.poll(()=>page.evaluate(()=>fusionTasksBusy())).toBe(false);
  expect(await page.evaluate(()=>state.pendingCopiedCard?.baseId)).toBe('umaibo');
});

test('5/1/2を維持して注目を持たず、表示本文・台帳・今回の更新情報が一致する', async ({page}) => {
  const result=await page.evaluate(()=>{
    const card=createCardFromBase('remote_participant_student','player');
    return {cost:card.cost,attack:card.attack,hp:card.hp,keywords:card.keywords,text:cardRulesText(card),
      attention:hasKeyword(card,'注目'),
      update:UPDATE_HISTORY.find(e=>e.version==='ver.0.25.1').changes.find(c=>c.title===card.name).after};
  });
  expect([result.cost,result.attack,result.hp]).toEqual([5,1,2]); expect(result.attention).toBe(false);
  expect(result.keywords||[]).not.toContain('注目'); expect(result.text).not.toContain('注目');
  expect(result.text).toContain('それぞれを1枚ずつ手札に生成する。その後、');
  expect(result.update).toBe(`学生／学友会・持ち物／戦意5／攻撃力1／体力2\n${result.text}`);
  const ledger=fs.readFileSync(path.join(__dirname,'..','card_rules.txt'),'utf8');
  expect(ledger).toContain('remote_participant_student: "このカードを手札から出席させたとき、自分のデッキと手札にある');
});
