const {test,expect}=require('@playwright/test');
const {pathToFileURL}=require('node:url');
const path=require('node:path');
test.beforeEach(async({page})=>{
  await page.goto(pathToFileURL(path.join(__dirname,'..','index.html')).href);
  await page.evaluate(()=>{
    startCardTest('general_student');scheduleOpponentAI=()=>{};state.training.skipAnimations=true;state.environment=null;
    for(const side of ['player','opponent'])Object.assign(state.players[side],{
      board:{teacher:null,seats:Array(9).fill(null)},hand:[],deck:[],trash:[],late:[],will:20,maxWill:20,life:20});
  });
});
for(const side of ['player','opponent'])for(const id of ['uma_bone','where_uma']){
  test(`${side}/${id}は融合出席者全7種と自身を除き通常の出席者だけを強化`,async({page})=>{
    const r=await page.evaluate(async({side,id})=>{
      chooseFusionEffectCards=async(_side,_source,candidates,max)=>candidates.slice(0,max);
      const p=state.players[side],source=makeBoardCard(createCardFromBase(id,side));p.board.seats[0]=source;
      const fused=[...Object.values(HORSE_PAIR_RESULTS),'where_uma_bone_maibo'].map(base=>makeBoardCard(createCardFromBase(base,side)));
      fused.forEach((c,i)=>p.board.seats[i+1]=c);
      const normal=makeBoardCard(createCardFromBase('general_student',side));p.board.seats[8]=normal;
      const before=[source,...fused].map(c=>[c.attack,c.currentHp]);
      await resolveHorseEndTurn(side,source);
      const unchanged=[source,...fused].every((c,i)=>c.attack===before[i][0]&&c.currentHp===before[i][1]);
      p.board.seats[8]=null;
      const value=aiRecurringCardValue(side,source);
      await resolveHorseEndTurn(side,source);
      return {unchanged,normal:[normal.attack,normal.currentHp],value,pending:state.pendingCardChoice, busy:fusionTasksBusy()};
    },{side,id});
    expect(r).toEqual({unchanged:true,normal:id==='uma_bone'?[2,3]:[3,3],value:0,pending:null,busy:false});
  });
}
test('ウマの骨の実際の選択画面にも通常の出席者だけが表示される',async({page})=>{
  await page.evaluate(()=>{
    const p=state.players.player;
    const source=makeBoardCard(createCardFromBase('uma_bone','player'));p.board.seats[0]=source;
    p.board.seats[1]=makeBoardCard(createCardFromBase('where_uma','player'));
    p.board.seats[2]=makeBoardCard(createCardFromBase('general_student','player'));
    resolveHorseEndTurn('player',source);
  });
  await expect.poll(()=>page.evaluate(()=>state.pendingCardChoice?.cards.map(c=>c.baseId))).toEqual(['general_student']);
  await page.evaluate(()=>{state.pendingCardChoice.selectedIds=[state.pendingCardChoice.cards[0].instanceId];confirmCardChoiceSelection();});
  await expect.poll(()=>page.evaluate(()=>fusionTasksBusy())).toBe(false);
  expect(await page.evaluate(()=>state.players.player.board.seats[2].currentHp)).toBe(3);
});
test('本文と能力値を維持し対象条件だけ更新',async({page})=>{
  const r=await page.evaluate(()=>['uma_bone','where_uma'].map(id=>{
    const c=createCardFromBase(id,'player');return {stats:[c.cost,c.attack,c.hp],text:cardRulesText(c)};
  }));
  expect(r).toEqual([
    {stats:[5,2,4],text:'自分のターン終了時、自分の講義室にいる融合で生成されていない出席者を2人まで指名し、それらの体力を+1する。'},
    {stats:[5,3,3],text:'自分のターン終了時、自分の講義室にいる融合で生成されていない出席者1人をランダムに指名し、その攻撃力と体力を+1する。'}]);
});
