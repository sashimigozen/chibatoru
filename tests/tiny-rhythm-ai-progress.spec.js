const {test,expect}=require('@playwright/test');
const {pathToFileURL}=require('node:url');
const path=require('node:path');
const url=pathToFileURL(path.join(__dirname,'..','index.html')).href;
for(const count of [1,3])test(`AIが小刻みリズム学生で${count}人をコピーしてターンを返す`,async({page})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(url);
 await page.evaluate(count=>{
  startCardTest('tiny_rhythm_student');scheduleOpponentAI=()=>{};state.testMode=false;state.training.skipAnimations=true;state.environment=null;state.currentSide='opponent';state.aiThinking=true;
  for(const side of ['player','opponent'])Object.assign(state.players[side],{board:{teacher:null,seats:Array(9).fill(null)},hand:[],trash:[],late:[],deck:[createCardFromBase('general_student',side)],will:8,maxWill:8,life:20});
  state.players.opponent.hand=['tiny_rhythm_student',...Array(count).fill('umaibo')].map(id=>createCardFromBase(id,'opponent'));
  runOpponentAI();
 },count);
 await expect.poll(()=>page.evaluate(()=>state.currentSide),{timeout:10000}).toBe('player');
 expect(await page.evaluate(()=>({busy:fusionTasksBusy(),queue:!!state.pendingSpecialAttendanceQueue,pending:!!state.pendingCopiedCard,copies:listBoardRefs('opponent').map(getBoardCardFromRef).filter(c=>c.baseId==='umaibo').length,originals:state.players.opponent.hand.filter(c=>c.baseId==='umaibo').length}))).toEqual({busy:false,queue:false,pending:false,copies:count,originals:count});
 expect(errors).toEqual([]);
});
