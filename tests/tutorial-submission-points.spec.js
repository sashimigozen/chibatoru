const {test,expect}=require('@playwright/test');
const {pathToFileURL}=require('node:url');
const path=require('node:path');
const url=pathToFileURL(path.join(__dirname,'../index.html')).href;
const hand=(p,id)=>p.locator(`#playerHand [data-base-id="${id}"]`).first();
const board=(p,side,id)=>p.locator(`#${side}BoardPanel [data-base-id="${id}"]`).first();
const idle=p=>expect.poll(()=>p.evaluate(()=>!battlePresentationBusy()&&!fusionTasksBusy()),{timeout:20000}).toBe(true);
async function open(p,id,stage='practice'){
  await p.goto(url);await p.locator('#homeNavSoloButton').click();await p.locator('#soloTutorialButton').click();
  await p.locator(`[data-tutorial-chapter="${id}"]`).click();
  for(let i=0;i<['practice','quiz','expert'].indexOf(stage);i++)await p.locator('#tutorialStageSwitch').click();
  await p.locator('#tutorialStartButton').click();await idle(p);await expect.poll(()=>p.evaluate(()=>state.tutorial.intro)).toBe(false);
}
async function closePreview(p){if(await p.locator('#battleCardPreview').isVisible())await p.locator('#battleCardPreview').click({position:{x:5,y:5}});}
async function nextTo(p,title){
  await closePreview(p);
  for(let i=0;i<15;i++){
    if(await p.locator('#tutorialCoachTitle').textContent()===title)return;
    await p.locator('#tutorialNextButton').click();
  }
  throw Error(title);
}
async function play(p,id,index=1){
  await idle(p);await hand(p,id).click();
  await (id.startsWith('wonton_')?p.locator('#environmentSlot'):p.locator(`.slot[data-owner="player"][data-zone="seat"][data-index="${index}"]`)).click();
  await idle(p);await closePreview(p);
}
async function choose(p,name){
  await p.locator('#threeGesturesHand button').filter({hasText:name}).first().click();
  await p.locator('#threeGesturesConfirmButton').click();
}
async function drag(p,id,target){
  await idle(p);const a=await hand(p,id).boundingBox(),b=await target.boundingBox();
  await p.mouse.move(a.x+a.width/2,a.y+16);await p.mouse.down();
  await p.mouse.move(b.x+b.width/2,b.y+b.height/2,{steps:12});await p.mouse.up();
  if(await p.locator('#itemTargetConfirmButton').isVisible())await p.locator('#itemTargetConfirmButton').click();
}
async function attack(p,id,target=null){
  await idle(p);await board(p,'player',id).click();
  await (target?board(p,'opponent',target):p.locator('#opponentLifeTarget')).click({force:true});await idle(p);await closePreview(p);
}
const data=p=>p.evaluate(()=>({points:state.players.player.pointScore,unit:hasAcquiredUnit('player'),count:wontonCount('player'),life:state.players.player.life,hand:state.players.player.hand.map(c=>c.baseId),long:state.players.player.board.seats.find(c=>c?.baseId==='long_sleeve_student')&&{attack:state.players.player.board.seats.find(c=>c?.baseId==='long_sleeve_student').attack,hp:state.players.player.board.seats.find(c=>c?.baseId==='long_sleeve_student').currentHp}}));
test('提出編は生成・効果での手札捨て・場に出す提出を通常操作で練習できる',async({page:p})=>{
  test.setTimeout(60000);await open(p,'submission');
  await nextTo(p,'万豚記を環境マスに置こう');await play(p,'wonton_ki');
  expect((await data(p)).count).toBe(0);expect((await data(p)).hand).toContain('wonton_greeting');
  await nextTo(p,'効果で校外へ送って提出しよう');await p.locator('#endTurnButton').click();
  await choose(p,'万豚記～挨拶シリーズ～');await idle(p);
  await expect.poll(()=>p.evaluate(()=>state.currentSide==='player'&&!state.aiThinking&&!state.lectureRoomCheck)).toBe(true);
  expect((await data(p)).count).toBe(1);expect((await data(p)).hand).toContain('wonton_stall');
  await nextTo(p,'場に出して提出しよう');await play(p,'wonton_stall');
  expect((await data(p)).count).toBe(2);expect((await data(p)).life).toBe(18);
  expect((await data(p)).hand).toContain('wonton_fever');
  await p.locator('#tutorialBackStepButton').click();await idle(p);
  await expect(p.locator('#tutorialCoachTitle')).toHaveText('場に出して提出しよう');
  expect((await data(p)).count).toBe(1);await play(p,'wonton_stall');
  await nextTo(p,'リーサルクイズに挑戦しよう');await p.screenshot({path:test.info().outputPath('submission-practice.png')});
  await p.locator('#tutorialNextButton').click();await expect(p.locator('#tutorialStepCounter')).toHaveText('2/3');
});
test('点数編は能力の撃破・攻撃の撃破・単位取得と強化を体験し、一つ戻せる',async({page:p})=>{
  test.setTimeout(60000);await open(p,'points');await nextTo(p,'能力で倒して点数を獲得しよう');
  expect((await data(p)).points).toBe(8);await play(p,'short_sleeve_student');expect((await data(p)).points).toBe(9);
  await nextTo(p,'攻撃で倒して単位を取得しよう');await attack(p,'long_sleeve_student','ae_student');
  expect(await data(p)).toMatchObject({points:10,unit:true,long:{attack:4,hp:6}});
  await p.locator('#tutorialBackStepButton').click();await idle(p);
  expect(await data(p)).toMatchObject({points:9,unit:false,long:{attack:1,hp:3}});
  await attack(p,'long_sleeve_student','ae_student');await nextTo(p,'リーサルクイズに挑戦しよう');
  await p.screenshot({path:test.info().outputPath('points-practice.png')});
});
for(const stage of ['quiz','expert']){
  test(`提出編 ${stage}は提出を使ってそのターン中に勝利できる`,async({page:p})=>{
    test.setTimeout(60000);await open(p,'submission',stage);await p.locator('#tutorialToggleButton').click();
    const item=stage==='quiz'?'female_highball':'male_highball';
    await drag(p,item,stage==='quiz'?p.locator('.playmat'):board(p,'opponent','super_ae_student'));
    await choose(p,'恋の万豚記～卒業シリーズ～');
    if(stage==='expert'){await expect(p.locator('#itemTargetConfirmButton')).toBeVisible();await expect.poll(()=>p.evaluate(()=>!battlePresentationBusy({ignoreFusionTasks:true}))).toBe(true);await closePreview(p);await board(p,'opponent','super_ae_student').click();await p.locator('#itemTargetConfirmButton').click();}
    await idle(p);
    if(stage==='expert')await drag(p,'grudge',p.locator('#opponentLifeTarget'));
    await expect(p.locator('#resultOverlay')).toContainText('勝利');
    expect((await data(p)).count).toBe(0);
  });
  test(`点数編 ${stage}は単位取得による強化を使って勝利できる`,async({page:p})=>{
    test.setTimeout(60000);await open(p,'points',stage);await p.locator('#tutorialToggleButton').click();
    if(stage==='quiz')await play(p,'short_sleeve_student');
    else{
      await hand(p,'sports_spectator_student').click();await p.locator('.slot[data-owner="player"][data-zone="seat"][data-index="1"]').click();
      await choose(p,'1ダメージ');await idle(p);
    }
    expect((await data(p)).unit).toBe(true);
    await attack(p,'long_sleeve_student');await attack(p,'long_sleeve_student');
    if(stage==='expert')await drag(p,'grudge',p.locator('#opponentLifeTarget'));
    await expect(p.locator('#resultOverlay')).toContainText('勝利');
  });
}
test('新しい編のクイズで失敗しても再挑戦でき、他の編へカウントを持ち越さない',async({page:p})=>{
  await open(p,'points','quiz');await p.locator('#endTurnButton').click();await expect(p.locator('#resultOverlay')).toContainText('失敗');
  await p.locator('[data-result-tutorial-retry]').click();await idle(p);await expect.poll(()=>p.evaluate(()=>state.tutorial.intro)).toBe(false);expect((await data(p)).points).toBe(9);
  await p.locator('#tutorialExitButton').click();await p.locator('[data-tutorial-chapter="lecture"]').click();await p.locator('#tutorialStartButton').click();
  expect(await data(p)).toMatchObject({points:0,unit:false,count:0});
});
