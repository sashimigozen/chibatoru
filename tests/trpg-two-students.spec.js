const {test,expect}=require('@playwright/test');
const {pathToFileURL}=require('node:url');
const path=require('node:path');
test.beforeEach(async({page})=>{
  await page.goto(pathToFileURL(path.join(__dirname,'..','index.html')).href);
  await page.evaluate(()=>{
    startCardTest('trpg_member');scheduleOpponentAI=()=>{};state.training.skipAnimations=true;
    state.phase='battle';state.actionTurn=8;state.currentSide='player';state.environment=null;
    for(const side of ['player','opponent']) Object.assign(state.players[side],{
      board:{teacher:null,seats:Array(9).fill(null)},hand:[],deck:[],trash:[],life:20,will:20,maxWill:20
    });
  });
});
test('能力値と表示本文は枚数以外を維持',async({page})=>{
  const r=await page.evaluate(()=>{
    const c=createCardFromBase('trpg_member','player');
    return {stats:[c.cost,c.attack,c.hp],text:cardRulesText(c)};
  });
  expect(r).toEqual({stats:[3,1,2],text:'このカードを手札から出席させたとき、自分のデッキから学生カード2枚をランダムに手札へ加える。'});
});
for(const side of ['player','opponent']) for(const count of [0,1,2,4]) {
  test('学生だけ2枚まで手札へ加え、不足時は可能な分だけ '+side+' '+count,async({page})=>{
    const r=await page.evaluate(({side,count})=>{
      state.currentSide=side;const p=state.players[side];
      p.deck=[createCardFromBase('ruler',side),createCardFromBase('general_teacher',side),
        ...Array.from({length:count},()=>createCardFromBase('general_student',side))];
      const beforeIds=p.deck.map(c=>c.instanceId);
      const trpg=makeBoardCard(createCardFromBase('trpg_member',side));
      attendCard(side,trpg,'seat',0,{attendanceSource:ATTENDANCE_SOURCE.HAND});
      return {hand:p.hand.length,students:p.hand.every(c=>c.type==='student'),fromDeck:p.hand.every(c=>beforeIds.includes(c.instanceId)),
        deck:p.deck.length,nonStudents:p.deck.filter(c=>c.type!=='student').length};
    },{side,count});
    expect(r).toEqual({hand:Math.min(2,count),students:true,fromDeck:true,deck:count+2-Math.min(2,count),nonStudents:2});
  });
}
