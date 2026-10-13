const {test,expect}=require('@playwright/test');
const {pathToFileURL}=require('node:url');
const path=require('node:path');
test.beforeEach(async({page})=>{
  await page.setViewportSize({width:1440,height:900});
  await page.goto(pathToFileURL(path.join(__dirname,'..','index.html')).href);
  await page.evaluate(()=>{
    startCardTest('maibo_bone');scheduleOpponentAI=()=>{};state.environment=null;state.training.skipAnimations=true;
    for(const side of ['player','opponent'])Object.assign(state.players[side],{board:{teacher:null,seats:Array(9).fill(null)},hand:[],deck:[],trash:[],will:10,life:20});
    state.players.player.board.seats[0]=makeBoardCard(createCardFromBase('maibo_bone','player'));
    for(let i=0;i<3;i++)state.players.opponent.board.seats[i]=makeBoardCard(createCardFromBase('general_student','opponent'));
    render();
  });
  await expect.poll(()=>page.evaluate(()=>battlePresentationBusy())).toBe(false);
});
test('終了時の指名を相手の盤面から直接選び、確定してダメージを与える',async({page})=>{
  await page.evaluate(()=>{resolveHorseEndTurn('player',state.players.player.board.seats[0]);render();});
  const candidates=page.locator('.board-card.enemy-effect-candidate');
  await expect(candidates).toHaveCount(3);
  await expect(page.locator('#threeGesturesStage')).toHaveClass(/hidden/);
  await expect(page.locator('#threeGesturesHand button')).toHaveCount(0);
  expect(await candidates.first().evaluate(el=>getComputedStyle(el).scale)).toBe('1.08');
  await page.locator('.enemy-effect-candidate[data-index="0"]').click();await page.locator('.enemy-effect-candidate[data-index="1"]').click();
  await expect.poll(()=>page.evaluate(()=>state.pendingCardChoice.selectedIds.length)).toBe(2);
  await page.locator('.enemy-effect-candidate[data-index="2"]').click();
  expect(await page.evaluate(()=>state.pendingCardChoice.selectedIds.length)).toBe(2);
  await page.screenshot({path:test.info().outputPath('opponent-board-choice.png')});
  await page.locator('#itemTargetConfirmButton').click();
  await expect.poll(()=>page.evaluate(()=>fusionTasksBusy())).toBe(false);
  expect(await page.evaluate(()=>state.players.opponent.board.seats.slice(0,3).map(card=>card?.currentHp??null))).toEqual([null,null,2]);
  await expect(page.locator('.enemy-effect-candidate')).toHaveCount(0);
});
test('対象外の相手と自分のカードは選べず、手札の選択は従来の一覧のまま',async({page})=>{
  await page.evaluate(()=>openCardChoice({mode:'fusion_effect_choice',cards:[state.players.opponent.board.seats[0]],min:0,max:1}));
  await page.locator('.board-card[data-owner="opponent"][data-index="1"]').click();
  await page.locator('.board-card[data-owner="player"]').click();
  expect(await page.evaluate(()=>state.pendingCardChoice.selectedIds)).toEqual([]);
  await page.evaluate(()=>openCardChoice({mode:'fusion_effect_choice',cards:[createCardFromBase('fusion_uma','player')],min:1,max:1}));
  await expect(page.locator('#threeGesturesStage')).not.toHaveClass(/board-target-choice/);
  await expect(page.locator('#threeGesturesHand button.card')).toHaveCount(1);
});
test('オンラインのゲストも相手の盤面から指名して応答できる',async({page})=>{
  await page.evaluate(()=>{
    state.online.role='guest';state.online.started=true;state.online.connected=true;state.online.conn={};state.remoteResolutionPending=true;
    onlineSend=message=>{window.boardResponse=message;return true;};
    openCardChoice({mode:'fusion_effect_online_response',requestId:'board-test',cards:[cardRevealPayload(state.players.opponent.board.seats[0])],min:1,max:1});
  });
  await page.locator('.enemy-effect-candidate').click();
  await page.locator('#itemTargetConfirmButton').click();
  expect(await page.evaluate(()=>window.boardResponse.selectedIds.length)).toBe(1);
});
test('演出中の指名は待機し、終了後に直接選べる',async({page})=>{
  await page.evaluate(()=>{
    openCardChoice({mode:'fusion_effect_choice',cards:[state.players.opponent.board.seats[0]],min:0,max:1});
    showCardPlayAnimation(createCardFromBase('general_student','player'),'board');
  });
  await page.locator('.enemy-effect-candidate').click();
  expect(await page.evaluate(()=>state.pendingCardChoice.selectedIds)).toEqual([]);
  await expect(page.locator('#playRevealOverlay')).toHaveClass(/hidden/);
  await page.locator('.enemy-effect-candidate').click();
  await expect.poll(()=>page.evaluate(()=>state.pendingCardChoice.selectedIds.length)).toBe(1);
});
test('既存の出席時指名でも選べる相手だけ拡大する',async({page})=>{
  await page.evaluate(()=>{
    state.players.player.board.seats[0]=makeBoardCard(createCardFromBase('small_omata','player'));
    state.pendingAttendTarget={owner:'player',targetOwner:'opponent',sourceCardInstanceId:state.players.player.board.seats[0].instanceId,sourceCardName:'スモール小俣',effect:'small_omata'};
    render();
  });
  await expect(page.locator('.enemy-effect-candidate')).toHaveCount(3);
  expect(await page.locator('.enemy-effect-candidate').first().evaluate(el=>getComputedStyle(el).scale)).toBe('1.08');
  await page.locator('.enemy-effect-candidate[data-index="0"]').click();
  await page.locator('#itemTargetConfirmButton').click();
  await expect.poll(()=>page.evaluate(()=>Boolean(state.pendingAttendTarget))).toBe(false);
});
