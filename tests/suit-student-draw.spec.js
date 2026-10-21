const {test,expect}=require('@playwright/test');
const {pathToFileURL}=require('node:url');
const path=require('node:path');
test.beforeEach(async({page})=>{
  await page.goto(pathToFileURL(path.join(__dirname,'..','index.html')).href);
  await page.evaluate(()=>{
    startCardTest('suit_student');scheduleOpponentAI=()=>{};
    state.training.skipAnimations=true;state.phase='battle';state.actionTurn=8;state.currentSide='player';
    state.suitStudentAttendanceCount=0;state.environment=null;state.deckToHandLocks=[];
    for(const side of ['player','opponent']) Object.assign(state.players[side],{
      board:{teacher:null,seats:Array(9).fill(null)},hand:[],deck:[],trash:[],late:[],life:20,will:20,maxWill:20,attendancesThisTurn:0
    });
  });
});
test('能力値・本文・手札出席条件・AIのドロー認識が一致する',async({page})=>{
  const r=await page.evaluate(()=>{
    const c=createCardFromBase('suit_student','player');
    return {stats:[c.cost,c.attack,c.hp],text:cardRulesText(c),trigger:c.attendanceTrigger,ai:AI_DRAW_OR_SEARCH_CARD_IDS.has(c.baseId)};
  });
  expect(r).toEqual({stats:[5,1,1],trigger:'hand',ai:true,
    text:'このカードを手札から出席させたとき、自分のデッキからカードを1枚引く。\nこのカードの戦意は、この対戦中にお互いの講義室へ出た「スーツを着た学生」1人につき-1される。\nこのカードは教師からダメージを受けない。\n出席数：0人'});
});
for(const side of ['player','opponent']) {
  for(const source of ['hand','effect','generated','copy','deck','late']) test('出席元ごとのドロー '+side+' '+source,async({page})=>{
    const r=await page.evaluate(({side,source})=>{
      state.currentSide=side;
      const p=state.players[side],c=makeBoardCard(createCardFromBase('suit_student',side));
      p.deck=['general_student','general_teacher'].map(id=>createCardFromBase(id,side));
      attendCard(side,c,'seat',0,{attendanceSource:source});
      return {hand:p.hand.map(c=>c.baseId),deck:p.deck.length,count:state.suitStudentAttendanceCount,
        nextCost:effectiveCardCost(createCardFromBase('suit_student',side))};
    },{side,source});
    expect(r).toEqual({hand:source==='hand'?['general_student']:[],deck:source==='hand'?1:2,count:1,nextCost:4});
  });
  test('インターンと胸像スーツの変化ではドローしない '+side,async({page})=>{
    const r=await page.evaluate(side=>{
      state.currentSide=side;const p=state.players[side];
      p.deck=[createCardFromBase('general_teacher',side)];
      p.board.seats[0]=makeBoardCard(createCardFromBase('general_student',side));
      p.internTurnsRemaining=1;resolveInternEndTurnEffect(side);
      p.board.seats[1]=makeBoardCard(createCardFromBase('general_student',side));
      const item=createCardFromBase('bust_suit',side);p.hand=[item];
      const used=castItemOnCard(side,item,side,'seat',1,false);
      return {used,hand:p.hand.length,deck:p.deck.length,count:state.suitStudentAttendanceCount};
    },side);
    expect(r).toEqual({used:true,hand:0,deck:1,count:2});
  });
}
test('デッキが空でも出席でき、効果ドローではデッキ切れ敗北にならない',async({page})=>{
  const r=await page.evaluate(()=>{
    const c=makeBoardCard(createCardFromBase('suit_student','player'));
    const entered=attendCard('player',c,'seat',0,{attendanceSource:ATTENDANCE_SOURCE.HAND});
    return {entered:!!entered,hand:state.players.player.hand.length,gameOver:!!state.gameOver};
  });
  expect(r).toEqual({entered:true,hand:0,gameOver:false});
});
