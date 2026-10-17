const {test, expect} = require('@playwright/test');
const {pathToFileURL} = require('node:url');
const path = require('node:path');
test.beforeEach(async ({page}) => {
  await page.goto(pathToFileURL(path.join(__dirname,'..','index.html')).href);
  await page.evaluate(() => {
    startCardTest('acting_out_man'); scheduleOpponentAI=()=>{};
    state.phase='battle'; state.currentSide='player'; state.actionTurn=8; state.environment=null;
    state.training.skipAnimations=false;
    for(const side of ['player','opponent']) Object.assign(state.players[side],{
      board:{teacher:null,seats:Array(9).fill(null)},hand:[],deck:[],trash:[],life:20});
  });
  await page.evaluate(() => waitForBattlePresentation());
});
for(const side of ['player','opponent']) test(`バフ→攻撃→表示復元、再描画でも維持 ${side}`,async({page})=>{
  const id=await page.evaluate(side=>{
    const other=oppositeSide(side);
    const c=makeBoardCard(createCardFromBase('acting_out_man',side));c.playedOnTurn=0;
    state.players[side].board.seats[0]=c;
    state.players[side].board.seats[1]=makeBoardCard(createCardFromBase('acting_out_man_2',side));
    state.players[other].board.seats[0]=makeBoardCard(createCardFromBase('general_student',other));
    render();
    window.focusNumbers=[];
    const originalFocus=showAttackFocus;
    showAttackFocus=(ref,role,delay)=>{focusNumbers.push([role,displayedBoardAttack(c)]);originalFocus(ref,role,delay);};
    window.visualDone=waitForAttackResolution({owner:side,zone:'seat',index:0},{owner:other,zone:'seat',index:0});
    return c.instanceId;
  },side);
  const card=page.locator(`[data-card-id="${id}"]`);
  await expect(card.locator('.board-change-feedback')).toHaveAttribute('aria-label','攻撃力+1');
  await expect(card.locator('.field-stat.attack')).toHaveText('4');
  await expect(page.locator('.floating-pop.buff')).toHaveText('攻撃力+1');
  await expect(page.locator('.attack-focus-overlay')).toHaveCount(0);
  await page.screenshot({path:test.info().outputPath('before-attack-buff.png')});
  await page.evaluate(()=>renderBoards());
  await expect(card.locator('.field-stat.attack')).toHaveText('4');
  expect(await page.evaluate(()=>visualDone)).toBe(true);
  expect(await page.evaluate(()=>focusNumbers)).toEqual([['attacker',4],['target',4]]);
  await expect(card.locator('.field-stat.attack')).toHaveText('3');
  expect(await page.evaluate(side=>state.players[side].board.seats[0].attack,side)).toBe(3);
});
test('実際のクリックでバフの光と文字が攻撃前に見える',async({page})=>{
  const ids=await page.evaluate(()=>{
    const c=makeBoardCard(createCardFromBase('acting_out_man','player'));c.playedOnTurn=0;
    const t=makeBoardCard(createCardFromBase('general_student','opponent'));
    t.baseMaxHp=t.maxHp=t.currentHp=20;
    state.players.player.board.seats[0]=c;
    state.players.player.board.seats[1]=makeBoardCard(createCardFromBase('acting_out_man_2','player'));
    state.players.opponent.board.seats[0]=t;render();
    return {attacker:c.instanceId,target:t.instanceId};
  });
  const attacker=page.locator(`[data-card-id="${ids.attacker}"]`);
  await attacker.click();
  await page.locator(`[data-card-id="${ids.target}"]`).click();
  await expect(page.locator('.floating-pop.buff')).toHaveText('攻撃力+1');
  await expect(attacker.locator('.field-stat.attack')).toHaveText('4');
  const energy=attacker.locator('.board-change-effect.buff .board-change-energy-image');
  await expect.poll(()=>energy.evaluate(e=>Number(getComputedStyle(e).opacity))).toBeGreaterThan(.2);
  await expect(page.locator('.attack-focus-overlay')).toHaveCount(0);
  await page.screenshot({path:test.info().outputPath('click-buff-visible.png')});
  await expect(page.locator(`[data-card-id="${ids.target}"] .field-stat.hp`)).toHaveText('16');
  await expect(attacker.locator('.field-stat.attack')).toHaveText('3');
});
test('実際の攻撃は4ダメージだけ与え、反撃を受けず元の数値を維持',async({page})=>{
  const r=await page.evaluate(async()=>{
    const c=makeBoardCard(createCardFromBase('acting_out_man','player'));c.playedOnTurn=0;
    state.players.player.board.seats[0]=c;
    state.players.player.board.seats[1]=makeBoardCard(createCardFromBase('acting_out_man_2','player'));
    const t=makeBoardCard(createCardFromBase('general_student','opponent'));
    t.baseMaxHp=t.maxHp=t.currentHp=20;t.attack=8;state.players.opponent.board.seats[0]=t;
    state.selectedAttacker={owner:'player',zone:'seat',index:0};render();
    await attackCard('opponent','seat',0);
    return {attack:c.attack,hp:c.currentHp,target:t.currentHp,visual:attackVisualBonuses.size};
  });
  expect(r).toEqual({attack:3,hp:3,target:16,visual:0});
});
for (const reducedMotion of ['no-preference','reduce']) test(`AIバトルでも赤い強化表示が透明にならない ${reducedMotion}`,async({page})=>{
  await page.emulateMedia({reducedMotion});
  const id=await page.evaluate(()=>{
    state.training.active=false;state.aiBattle.active=true;
    const c=makeBoardCard(createCardFromBase('acting_out_man','player'));c.playedOnTurn=0;
    const target=makeBoardCard(createCardFromBase('general_student','opponent'));
    target.baseMaxHp=target.maxHp=target.currentHp=20;
    state.players.player.board.seats[0]=c;
    state.players.player.board.seats[1]=makeBoardCard(createCardFromBase('acting_out_man_2','player'));
    state.players.opponent.board.seats[0]=target;render();return c.instanceId;
  });
  const attacker=page.locator(`[data-card-id="${id}"]`);
  await attacker.click();
  await page.locator('[data-owner="opponent"][data-zone="seat"][data-index="0"] .board-card').click();
  await expect(attacker.locator('.field-stat.attack')).toHaveText('4');
  const energy=attacker.locator('.attack-buff-feedback .board-change-energy-image');
  await expect.poll(()=>energy.evaluate(e=>Number(getComputedStyle(e).opacity))).toBeGreaterThan(.2);
  await page.evaluate(()=>render());
  await expect.poll(()=>energy.evaluate(e=>Number(getComputedStyle(e).opacity))).toBeGreaterThan(.2);
  await expect(page.locator('.attack-focus-overlay')).toHaveCount(0);
  await page.screenshot({path:test.info().outputPath('ai-buff.png')});
  await expect(attacker.locator('.field-stat.attack')).toHaveText('3');
});
test('教師への攻撃と条件未成立ではバフせず、中断でも表示を戻す',async({page})=>{
  const r=await page.evaluate(async()=>{
    const c=makeBoardCard(createCardFromBase('acting_out_man','player'));state.players.player.board.seats[0]=c;
    const t=makeBoardCard(createCardFromBase('general_teacher','opponent'));state.players.opponent.board.teacher=t;
    state.players.player.board.seats[1]=makeBoardCard(createCardFromBase('acting_out_man_2','player'));render();
    const ref={owner:'player',zone:'seat',index:0};
    const teacherPromise=waitForAttackResolution(ref,{owner:'opponent',zone:'teacher',index:null});
    const teacher=displayedBoardAttack(c);await teacherPromise;
    const student=makeBoardCard(createCardFromBase('general_student','opponent'));state.players.opponent.board.seats[0]=student;
    state.players.player.board.seats[1]=null;
    const alonePromise=waitForAttackResolution(ref,{owner:'opponent',zone:'seat',index:0});
    const alone=displayedBoardAttack(c);await alonePromise;
    state.players.player.board.seats[1]=makeBoardCard(createCardFromBase('acting_out_man_2','player'));
    const canceled=waitForAttackResolution(ref,{owner:'opponent',zone:'seat',index:0});
    state.attackDelayToken+=1;const valid=await canceled;
    return {teacher,alone,valid,attack:displayedBoardAttack(c),visual:attackVisualBonuses.size};
  });
  expect(r).toEqual({teacher:3,alone:3,valid:false,attack:3,visual:0});
});

test('オンライン受信イベントでもバフを先に表示する',async({page})=>{
  const id=await page.evaluate(()=>{
    const c=makeBoardCard(createCardFromBase('acting_out_man','opponent'));
    state.players.opponent.board.seats[0]=c;
    state.players.opponent.board.seats[1]=makeBoardCard(createCardFromBase('acting_out_man_2','opponent'));
    state.players.player.board.seats[0]=makeBoardCard(createCardFromBase('general_student','player'));
    render();
    state.effectFeedbackEvents=[{id:'test-attack',occurredAt:Date.now(),target:'attack-sequence',
      attackerRef:{owner:'opponent',zone:'seat',index:0},targetRef:{owner:'player',zone:'seat',index:0}}];
    showOnlineEffectFeedbackEvents({screen:'battle',feedbackEventIds:new Set()});
    return c.instanceId;
  });
  const card=page.locator(`[data-card-id="${id}"]`);
  await expect(card.locator('.field-stat.attack')).toHaveText('4');
  await expect(card.locator('.board-change-feedback')).toHaveAttribute('aria-label','攻撃力+1');
  await expect(page.locator('.floating-pop.buff')).toHaveText('攻撃力+1');
  await expect(page.locator('.attack-focus-overlay')).toHaveCount(0);
  await expect(page.locator('.attack-focus-overlay.target')).toBeVisible();
  await expect(card.locator('.field-stat.attack')).toHaveText('3');
});
