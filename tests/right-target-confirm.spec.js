const {test,expect}=require('@playwright/test');
const {pathToFileURL}=require('node:url');
const path=require('node:path');
test.beforeEach(async({page})=>{
  await page.setViewportSize({width:1440,height:900});
  await page.goto(pathToFileURL(path.join(__dirname,'..','index.html')).href);
  await page.evaluate(()=>{
    startCardTest('ruler');scheduleOpponentAI=()=>{};state.training.skipAnimations=true;state.environment=null;
    for(const side of ['player','opponent'])Object.assign(state.players[side],{board:{teacher:null,seats:Array(9).fill(null)},hand:[],deck:[],trash:[],late:[],will:10,maxWill:10,life:20});
    state.players.player.board.seats[0]=makeBoardCard(createCardFromBase('general_student','player'));
    state.players.opponent.board.seats[0]=makeBoardCard(createCardFromBase('general_student','opponent'));render();
  });
  await expect.poll(()=>page.evaluate(()=>battlePresentationBusy())).toBe(false);
});
test('定規の盤面対象も選択・解除し、右側で確定するまで発動しない',async({page})=>{
  await page.evaluate(()=>{const item=createCardFromBase('ruler','player');state.players.player.hand=[item];beginItemUse(item);});
  const enemy=page.locator('.board-card[data-owner="opponent"][data-index="0"]');
  await enemy.click();
  expect(await page.evaluate(()=>state.players.opponent.board.seats[0].currentHp)).toBe(2);
  await expect(page.locator('#itemTargetConfirmButton')).toBeEnabled();
  await enemy.click();await expect(page.locator('#itemTargetConfirmButton')).toBeDisabled();
  await enemy.click();await page.locator('#itemTargetConfirmButton').click();
  await expect.poll(()=>page.evaluate(()=>state.players.opponent.board.seats[0].currentHp)).toBe(1);
});
test('パンパンは自分・相手を順に選び、右側で確定してから破壊する',async({page})=>{
  await page.evaluate(()=>{const item=createCardFromBase('panpan','player');state.players.player.hand=[item];beginItemUse(item);});
  await page.locator('.board-card[data-owner="player"][data-index="0"]').click();
  expect(await page.evaluate(()=>state.players.player.board.seats[0]?.baseId)).toBe('general_student');
  await page.locator('#itemTargetConfirmButton').click();
  await page.locator('.board-card[data-owner="opponent"][data-index="0"]').click();
  await expect(page.locator('#itemTargetConfirmButton')).toHaveText('破壊する');
  await expect(page.locator('#threeGesturesStage')).toHaveClass(/hidden/);
  await page.screenshot({path:test.info().outputPath('panpan-right-confirm.png')});
  await page.locator('#itemTargetConfirmButton').click();
  await expect.poll(()=>page.evaluate(()=>['player','opponent'].every(side=>state.players[side].board.seats[0]===null))).toBe(true);
});
test('自分への持ち物も講義室上の候補を拡大し、選択・解除してから右側で確定する',async({page})=>{
  await page.evaluate(()=>{const item=createCardFromBase('aggro_eater','player');state.players.player.board.seats[0].currentHp=1;state.players.player.life=19;state.players.player.hand=[item];beginItemUse(item);});
  const own=page.locator('.board-card[data-owner="player"][data-index="0"]');
  const enemy=page.locator('.board-card[data-owner="opponent"][data-index="0"]');
  await expect(own).toHaveClass(/effect-target-candidate/);
  await expect(own).toHaveCSS('scale','1.08');
  await expect(enemy).not.toHaveClass(/effect-target-candidate/);
  await page.screenshot({path:test.info().outputPath('friendly-board-target.png')});
  await own.click();
  await expect(own).toHaveClass(/selected/);
  expect(await page.evaluate(()=>state.players.player.board.seats[0].currentHp)).toBe(1);
  await own.click();await expect(page.locator('#itemTargetConfirmButton')).toBeDisabled();
  await own.click();await page.locator('#itemTargetConfirmButton').click();
  await expect.poll(()=>page.evaluate(()=>state.players.player.board.seats[0].currentHp)).toBe(2);
});
test('どんぐりの進化対象も右側の確定前には進化しない',async({page})=>{
  await page.evaluate(()=>{
    const card=makeBoardCard(createCardFromBase('bird_a','player'));card.playedOnTurn=0;state.players.player.board.teacher=card;
    state.players.player.hand=['donguri','donguri','demon_a_plus'].map(id=>createCardFromBase(id,'player'));beginItemUse(state.players.player.hand[0]);
  });
  await page.locator('.board-card[data-owner="player"][data-zone="teacher"]').click();
  expect(await page.evaluate(()=>state.players.player.board.teacher.baseId)).toBe('bird_a');
  await page.locator('#itemTargetConfirmButton').click();
  await expect.poll(()=>page.evaluate(()=>state.players.player.board.teacher?.baseId)).toBe('demon_a_plus');
});
test('うれしい体験は右側で対象を確定した後だけ進化先の手札選択を出す',async({page})=>{
  await page.evaluate(()=>{
    const card=makeBoardCard(createCardFromBase('bird_a','player'));card.playedOnTurn=0;state.players.player.board.teacher=card;
    state.players.player.hand=['happy_experience','demon_a_plus'].map(id=>createCardFromBase(id,'player'));beginItemUse(state.players.player.hand[0]);
  });
  await page.locator('.board-card[data-owner="player"][data-zone="teacher"]').click();
  await expect(page.locator('#threeGesturesStage')).toHaveClass(/hidden/);
  await page.locator('#itemTargetConfirmButton').click();
  await expect(page.locator('#threeGesturesHand button.card')).toHaveCount(1);
  expect(await page.evaluate(()=>state.pendingCardChoice.mode)).toBe('happy_experience');
  await expect(page.locator('#itemTargetConfirmButton')).toHaveClass(/hidden/);
});
