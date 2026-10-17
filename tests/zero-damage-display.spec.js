const {test,expect}=require('@playwright/test');
const {pathToFileURL}=require('node:url');
const path=require('node:path');
for(const side of ['player','opponent']) test(`0ダメージは出席者も本体も0表示 ${side}`,async({page})=>{
  await page.goto(pathToFileURL(path.join(__dirname,'..','index.html')).href);
  const result=await page.evaluate(side=>{
    startCardTest('acting_out_woman');scheduleOpponentAI=()=>{};
    state.phase='battle';state.effectFeedbackEvents=[];
    state.online.role='host';state.online.started=true;state.online.connected=false;
    for(const owner of ['player','opponent'])state.players[owner].board={teacher:null,seats:Array(9).fill(null)};
    const woman=makeBoardCard(createCardFromBase('acting_out_woman',side));
    const friend=makeBoardCard(createCardFromBase('acting_out_man_2',side));
    const target=makeBoardCard(createCardFromBase('strong_student',side));target.defense=5;
    state.players[side].board.seats[0]=woman;state.players[side].board.seats[1]=friend;state.players[side].board.seats[2]=target;
    const source=makeBoardCard(createCardFromBase('general_student',oppositeSide(side)));
    render();const hp=target.currentHp,life=state.players[side].life;
    dealDamageToCard(target,3,source);damagePlayer(side,1,source);
    return {hp:target.currentHp===hp,life:state.players[side].life===life,events:state.effectFeedbackEvents.map(e=>e.text)};
  },side);
  expect(result).toEqual({hp:true,life:true,events:['0','0']});
  await expect(page.locator('.floating-pop').filter({hasText:/^0$/})).toHaveCount(2);
  await page.screenshot({path:test.info().outputPath('zero.png')});
});
