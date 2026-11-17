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

test('遠くからの出席から実際のクリックで素材2枚を選び、確定して生成できる',async({page})=>{
  await page.evaluate(()=>{
    const card=createCardFromBase('remote_participant_student','player');state.players.player.hand=[card];
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
  await expect(page.locator('.board-card.selection-candidate')).toHaveCount(1);
  await expect(page.locator('.board-card.selection-candidate')).toHaveCSS('scale','1.08');
  await expect(page.locator('#threeGesturesStage')).toHaveClass(/hidden/);
  await page.locator('.board-card.selection-candidate').click();
  await expect.poll(()=>page.evaluate(()=>state.pendingCardChoice?.selectedIds.length)).toBe(1);
  expect(await page.evaluate(()=>[state.currentSide,state.lectureRoomCheck,battleActionInputAllowed(elements.endTurnButton)])).toEqual(['player',true,false]);
  await page.locator('#itemTargetConfirmButton').click();
  await expect.poll(()=>page.evaluate(()=>state.currentSide)).toBe('opponent');
});

test('選択待ちだけを除外し、実際のカード演出中は選択クリックも待機する',async({page})=>{
  await page.evaluate(()=>{
    state.players.player.deck=HORSE_MATERIAL_IDS.map(id=>createCardFromBase(id,'player'));
    resolveHorseAttendance('player',createCardFromBase('remote_participant_student','player'));
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
    openCardChoice({mode:'fusion_effect_online_response',title:'遠くから参加する学生',requestId:'fusion-input-test',
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

test('相手の手番と攻撃処理中は全種類の手札融合を開けず、自分の手番には操作できる', async ({ page }) => {
  const cases = [
    { hand: ['private_teacher', 'general_student'], button: '[data-preview-any-hand-fusion]', open: 'openAnyHandFusionChoice' },
    { hand: ['fusion_uma', 'fusion_maibo'], button: '[data-preview-horse-fusion]', open: 'openHorseFusionChoice' },
    { hand: ['ruler', 'ruler'], button: '[data-preview-ruler-fuse]', open: 'openRulerFusionChoice' },
    { hand: ['tsurai_nara', 'yuta'], button: '[data-preview-uta-fusion]', open: 'openUtaFusionChoice' }
  ];
  for (const { hand, button, open } of cases) {
    await page.evaluate(ids => {
      state.currentSide = 'opponent';
      state.players.player.hand = ids.map(id => createCardFromBase(id, 'player'));
      render();
      showBattleCardPreview(state.players.player.hand[0]);
    }, hand);
    const previewButton = page.locator(button);
    await expect(page.locator('#battleCardPreview')).toBeVisible();
    await expect(previewButton).toBeDisabled();
    expect(await page.evaluate(name => {
      const [source, target] = state.players.player.hand;
      return [window[name](source), performHandFusionDrop(source.instanceId, target.instanceId), state.pendingCardChoice];
    }, open)).toEqual([false, false, null]);

    await page.evaluate(() => {
      state.currentSide = 'player';
      state.attackInProgress = true;
      render();
    });
    await expect(previewButton).toBeDisabled();
    expect(await page.evaluate(name => window[name](state.players.player.hand[0]), open)).toBe(false);

    await page.evaluate(() => {
      state.attackInProgress = false;
      render();
    });
    await expect(previewButton).toBeEnabled();
    await previewButton.click();
    await expect(page.locator('#threeGesturesStage')).toBeVisible();
    await page.locator('#threeGesturesHand button.card').first().click();
    await page.locator('#threeGesturesConfirmButton').click();
    await expect.poll(() => page.evaluate(() => state.players.player.hand.length)).toBe(1);
    await expect(page.locator('#threeGesturesStage')).toBeHidden();
  }
});

test('手番切り替え直後の古い定規融合の確定は取り消し、相手の手番を進められる', async ({ page }) => {
  const result = await page.evaluate(async () => {
    state.players.player.hand = Array.from({ length: 2 }, () => createCardFromBase('ruler', 'player'));
    state.players.player.deck = [createCardFromBase('general_student', 'player')];
    openRulerFusionChoice(state.players.player.hand[0]);
    toggleCardChoiceCard(state.players.player.hand[1].instanceId);
    state.currentSide = 'opponent';
    confirmCardChoiceSelection();
    const remaining = state.players.player.hand.map(card => card.baseId);
    await finishEndTurn('opponent');
    return { remaining, choice: state.pendingCardChoice, nextSide: state.currentSide };
  });
  expect(result).toEqual({ remaining: ['ruler', 'ruler'], choice: null, nextSide: 'player' });
  await expect(page.locator('#threeGesturesStage')).toBeHidden();
});
