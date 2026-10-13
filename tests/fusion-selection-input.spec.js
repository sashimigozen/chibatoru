const {test,expect}=require('@playwright/test');
const {pathToFileURL}=require('node:url');
const path=require('node:path');
const url=pathToFileURL(path.join(__dirname,'..','index.html')).href;

test.beforeEach(async({page})=>{
  await page.setViewportSize({width:1440,height:900});
  await page.goto(url);
  await page.evaluate(()=>{
    startCardTest('corridor_student');scheduleOpponentAI=()=>{};state.environment=null;state.training.skipAnimations=true;
    for(const side of ['player','opponent'])Object.assign(state.players[side],{board:{teacher:null,seats:Array(9).fill(null)},hand:[],deck:[],trash:[],will:10,life:20});
    render();
  });
  await expect.poll(()=>page.evaluate(()=>battlePresentationBusy())).toBe(false);
});

test('通路の出席から実際のクリックで素材2枚を選び、確定して生成できる',async({page})=>{
  await page.evaluate(()=>{
    const card=createCardFromBase('corridor_student','player');state.players.player.hand=[card];
    state.players.player.deck=HORSE_MATERIAL_IDS.map(id=>createCardFromBase(id,'player'));
    placeCardFromHand('player',card.instanceId,'seat','player',0,true);
  });
  const cards=page.locator('#threeGesturesHand button.card');
  await expect(cards).toHaveCount(4);
  await expect.poll(()=>page.evaluate(()=>battlePresentationBusy({ignoreFusionTasks:true}))).toBe(false);
  await cards.nth(0).click();await cards.nth(1).click();
  await expect.poll(()=>page.evaluate(()=>state.pendingCardChoice?.selectedIds.length),{timeout:1500}).toBe(2);
  await page.screenshot({path:test.info().outputPath('fusion-choice-clicked.png')});
  await page.locator('#threeGesturesConfirmButton').click();
  await expect.poll(()=>page.evaluate(()=>fusionTasksBusy())).toBe(false);
  expect(await page.evaluate(()=>[state.players.player.hand.map(card=>card.baseId),state.players.player.deck.length])).toEqual([['fusion_uma','fusion_maibo'],4]);
});

test('遠くからの選択もクリックで確定し、元を手札に残してコピーを置ける',async({page})=>{
  await page.evaluate(()=>{
    state.players.player.hand=[createCardFromBase('umaibo','player')];
    resolveHorseAttendance('player',createCardFromBase('remote_participant_student','player'));
  });
  await expect(page.locator('#threeGesturesHand button.card')).toHaveCount(1);
  await page.locator('#threeGesturesHand button.card').click();
  await expect(page.locator('#threeGesturesConfirmButton')).toBeEnabled();
  await page.locator('#threeGesturesConfirmButton').click();
  await expect.poll(()=>page.evaluate(()=>Boolean(state.pendingCopiedCard))).toBe(true);
  const selector=await page.evaluate(()=>tutorialRefSelector({owner:'player',zone:'seat',index:4}));
  await page.locator(selector).click();
  await expect.poll(()=>page.evaluate(()=>state.players.player.board.seats[4]?.baseId)).toBe('umaibo');
  expect(await page.evaluate(()=>state.players.player.hand.length)).toBe(1);
});

test('講義室チェック中の指名もクリックでき、他のゲーム操作はロックしたまま',async({page})=>{
  await page.evaluate(()=>{
    state.players.player.board.seats[0]=makeBoardCard(createCardFromBase('uma_bone','player'));
    state.players.player.board.seats[1]=makeBoardCard(createCardFromBase('general_student','player'));
    state.players.opponent.deck=[createCardFromBase('general_student','opponent')];void finishEndTurn('player');
  });
  await expect(page.locator('#threeGesturesHand button.card')).toHaveCount(1);
  await page.locator('#threeGesturesHand button.card').click();
  await expect.poll(()=>page.evaluate(()=>state.pendingCardChoice?.selectedIds.length)).toBe(1);
  expect(await page.evaluate(()=>[state.currentSide,state.lectureRoomCheck,battleActionInputAllowed(elements.endTurnButton)])).toEqual(['player',true,false]);
  await page.locator('#threeGesturesConfirmButton').click();
  await expect.poll(()=>page.evaluate(()=>state.currentSide)).toBe('opponent');
});

test('選択待ちだけを除外し、実際のカード演出中は選択クリックも待機する',async({page})=>{
  await page.evaluate(()=>{
    state.players.player.deck=HORSE_MATERIAL_IDS.map(id=>createCardFromBase(id,'player'));
    resolveHorseAttendance('player',createCardFromBase('corridor_student','player'));
  });
  await expect(page.locator('#threeGesturesHand button.card')).toHaveCount(4);
  await page.evaluate(()=>showCardPlayAnimation(createCardFromBase('general_student','player'),'board'));
  await page.locator('#threeGesturesHand button.card').first().click();
  expect(await page.evaluate(()=>state.pendingCardChoice.selectedIds)).toEqual([]);
  await expect(page.locator('#playRevealOverlay')).toHaveClass(/hidden/);
  await page.locator('#threeGesturesHand button.card').first().click();
  await expect.poll(()=>page.evaluate(()=>state.pendingCardChoice.selectedIds.length)).toBe(1);
});

test('オンラインのゲストも選択待ち中にクリックして応答でき、通常操作はロックする',async({page})=>{
  await page.evaluate(()=>{
    state.online.role='guest';state.online.started=true;state.online.connected=true;state.online.conn={};state.remoteResolutionPending=true;
    onlineSend=message=>{window.fusionSelectionResponse=message;return true;};
    openCardChoice({mode:'fusion_effect_online_response',title:'通路で粘る学生',requestId:'fusion-input-test',
      cards:HORSE_MATERIAL_IDS.slice(0,2).map(id=>createCardFromBase(id,'player')),min:2,max:2});
  });
  const cards=page.locator('#threeGesturesHand button.card');
  await cards.nth(0).click();await cards.nth(1).click();
  await expect.poll(()=>page.evaluate(()=>state.pendingCardChoice?.selectedIds.length)).toBe(2);
  expect(await page.evaluate(()=>battleActionInputAllowed(elements.endTurnButton))).toBe(false);
  await page.locator('#threeGesturesConfirmButton').click();
  expect(await page.evaluate(()=>({kind:window.fusionSelectionResponse.privateChoiceKind,count:window.fusionSelectionResponse.selectedIds.length})))
    .toEqual({kind:'fusion_effect_choice',count:2});
});
