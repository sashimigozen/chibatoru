const {test,expect}=require('@playwright/test');
const {pathToFileURL}=require('node:url');
const path=require('node:path');
test.beforeEach(async({page})=>{
  await page.goto(pathToFileURL(path.join(__dirname,'..','index.html')).href);
  await page.evaluate(()=>{
    startCardTest('general_student');scheduleOpponentAI=()=>{};
    state.phase='battle';state.currentSide='opponent';state.actionTurn=9;state.environment=null;
    state.training.skipAnimations=true;
    for(const side of ['player','opponent'])Object.assign(state.players[side],{
      life:20,will:10,maxWill:10,turnsTaken:5,hand:[],deck:[],trash:[],late:[],
      board:{seats:Array(9).fill(null),teacher:null}
    });
  });
});
for(const threat of ['beta','gamma'])for(const [id,zone,index] of [
  ['aggro_king','seat',6],['aggro_queen','seat',5],['general_teacher','teacher',null]
])test(`${threat}を妨害するために${id}の得意マスを捨てない`,async({page})=>{
  const move=await page.evaluate(({threat,id})=>{
    state.players.player.hand=[createCardFromBase(threat,'player')];
    state.players.opponent.hand=[createCardFromBase(id,'opponent')];
    const result=findAiPlayMove();return {zone:result.zone,index:result.index??null};
  },{threat,id});
  expect(move).toEqual({zone,index});
});
for(const [threat,slots] of [['beta',[3,5]],['gamma',[4]]])test(`${threat}の妨害は適性差のない学生なら選ぶ`,async({page})=>{
  const index=await page.evaluate(threat=>{
    state.players.player.hand=[createCardFromBase(threat,'player')];
    state.players.opponent.hand=[createCardFromBase('general_student','opponent')];
    return findAiPlayMove().index;
  },threat);
  expect(slots).toContain(index);
});
