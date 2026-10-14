const {test,expect}=require('@playwright/test');
const {pathToFileURL}=require('node:url');
const path=require('node:path');
test.beforeEach(async({page})=>{
  await page.setViewportSize({width:1440,height:900});
  await page.goto(pathToFileURL(path.join(__dirname,'..','index.html')).href);
  await page.evaluate(()=>{
    startCardTest('uma_bone');scheduleOpponentAI=()=>{};state.training.skipAnimations=true;state.environment=null;
    for(const side of ['player','opponent'])Object.assign(state.players[side],{board:{teacher:null,seats:Array(9).fill(null)},hand:[],deck:[],trash:[],will:10,life:20});
    state.players.player.board.seats[0]=makeBoardCard(createCardFromBase('uma_bone','player'));
    for(const index of [1,2])state.players.player.board.seats[index]=makeBoardCard(createCardFromBase('general_student','player'));
    render();
  });
  await expect.poll(()=>page.evaluate(()=>battlePresentationBusy())).toBe(false);
});
test('融合の盤面指名は選択数とチェック・赤枠で区別し、解除と0人確定も維持する',async({page})=>{
  await page.evaluate(()=>{void resolveHorseEndTurn('player',state.players.player.board.seats[0]);});
  const confirm=page.locator('#itemTargetConfirmButton');
  await expect(confirm).toHaveText('対象を確定\n0/2');
  const first=page.locator('.board-card[data-owner="player"][data-index="1"]');
  await first.click();await expect(confirm).toHaveText('対象を確定\n1/2');
  await expect(first).toHaveClass(/effect-target-selected/);
  await expect(first).toHaveAttribute('aria-pressed','true');
  await expect(first.locator('.target-selection-mark')).toHaveCount(1);
  await expect(first).toHaveCSS('outline-color','rgb(220, 38, 38)');
  await expect(first.locator('.target-selection-mark')).toHaveCSS('background-color','rgb(220, 38, 38)');
  await page.screenshot({path:test.info().outputPath('board-selection.png')});
  await page.setViewportSize({width:1280,height:800});
  await page.screenshot({path:test.info().outputPath('board-selection-1280.png')});
  await first.click();await expect(confirm).toHaveText('対象を確定\n0/2');
  await expect(first.locator('.target-selection-mark')).toHaveCount(0);
  await expect(first).toHaveAttribute('aria-pressed','false');
  await confirm.click();await expect.poll(()=>page.evaluate(()=>fusionTasksBusy())).toBe(false);
});
test('手札の融合コピー元も同名を個別に強調し確定ボタンへ数を表示する',async({page})=>{
  await page.evaluate(()=>{
    state.players.player.hand=['umaibo','umaibo','maibo_bone'].map(id=>createCardFromBase(id,'player'));
    resolveHorseAttendance('player',createCardFromBase('tiny_rhythm_student','player'));
  });
  const choices=page.locator('#threeGesturesHand button.card'),confirm=page.locator('#threeGesturesConfirmButton');
  await expect(choices).toHaveCount(3);await expect(confirm).toHaveText('確定 0/3');
  await choices.nth(0).click();await choices.nth(1).click();
  await expect(confirm).toHaveText('確定 2/3');
  await expect(page.locator('#threeGesturesHand .effect-target-selected')).toHaveCount(2);
  await expect(page.locator('#threeGesturesHand .target-selection-mark')).toHaveCount(2);
  await page.screenshot({path:test.info().outputPath('hand-selection.png')});
  await choices.nth(0).click();await expect(confirm).toHaveText('確定 1/3');
});
test('通常の対象選択とオンラインゲストの盤面指名も同じ表示になる',async({page})=>{
  await page.evaluate(()=>{const item=createCardFromBase('aggro_eater','player');state.players.player.hand=[item];beginItemUse(item);});
  const first=page.locator('.board-card[data-owner="player"][data-index="1"]');
  await expect(page.locator('#itemTargetConfirmButton')).toHaveText('対象を確定\n0/1');
  await first.click();await expect(page.locator('#itemTargetConfirmButton')).toHaveText('対象を確定\n1/1');
  await expect(first.locator('.target-selection-mark')).toHaveCount(1);
  await page.evaluate(()=>{
    clearSelections();state.online.role='guest';state.online.started=true;state.online.connected=true;state.online.conn={};state.remoteResolutionPending=true;onlineSend=()=>true;
    openCardChoice({mode:'fusion_effect_online_response',title:'ウマの骨',requestId:'selection-test',cards:boardCardsForChoice('player'),min:0,max:2});
  });
  await first.click();await expect(page.locator('#itemTargetConfirmButton')).toHaveText('対象を確定\n1/2');
  await expect(first).toHaveAttribute('aria-pressed','true');
});
test('細いの4枚選択も人数と選択済み表示を揃え、4枚未満では確定できない',async({page})=>{
  await page.evaluate(()=>openCardChoice({mode:'thin_item_keep',title:'細い',cards:Array.from({length:5},()=>createCardFromBase('general_student','player')),min:4,max:4,confirmLabel:'この4枚を残す'}));
  const cards=page.locator('#mulliganHand button.card'),confirm=page.locator('#thinItemKeepConfirmButton');
  await expect(cards).toHaveCount(5);await expect(confirm).toHaveText('この4枚を残す 0/4');
  await cards.first().click();await expect(confirm).toHaveText('この4枚を残す 1/4');
  await expect(cards.first()).toHaveClass(/effect-target-selected/);await expect(confirm).toBeDisabled();
  for(let i=1;i<4;i++)await cards.nth(i).click();
  await expect(confirm).toHaveText('この4枚を残す 4/4');await expect(confirm).toBeEnabled();
});
