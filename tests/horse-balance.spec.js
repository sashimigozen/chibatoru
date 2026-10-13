const {test,expect}=require('@playwright/test');
const {pathToFileURL}=require('node:url');
const path=require('node:path');
test.beforeEach(async({page})=>{
  await page.goto(pathToFileURL(path.join(__dirname,'..','index.html')).href);
  await page.evaluate(()=>{
    startCardTest('where_bone');scheduleOpponentAI=()=>{};state.environment=null;state.training.skipAnimations=true;
    for(const side of ['player','opponent'])Object.assign(state.players[side],{board:{teacher:null,seats:Array(9).fill(null)},hand:[createCardFromBase('general_student',side)],trash:[],late:[],life:20});
  });
});
for(const side of ['player','opponent'])test(`${side}のどこの骨は本体3ダメージ、負荷を付けず無効化も尊重する`,async({page})=>{
  const result=await page.evaluate(async side=>{
    const other=oppositeSide(side);const source=makeBoardCard(createCardFromBase('where_bone',side));state.players[side].board.seats[0]=source;
    await resolveHorseEndTurn(side,source);const life=state.players[other].life;
    state.players[other].lifeShieldUntilTurn=state.actionTurn;state.players[other].lifeShieldUntilSide=state.currentSide;
    await resolveHorseEndTurn(side,source);
    state.players[other].lifeShieldUntilTurn=0;source.padlockEquipment={baseId:'padlock'};
    await resolveHorseEndTurn(side,source);
    return {life,shieldLife:state.players[other].life,load:state.players[other].hand[0].handLoadLevel||0,text:cardRulesText(source)};
  },side);
  expect(result).toEqual({life:17,shieldLife:17,load:0,text:'自分のターン終了時、相手本体に3ダメージを与える。'});
});
test('どこの骨の終了時ダメージで気力0になれば勝利する',async({page})=>{
  await page.evaluate(async()=>{
    const card=makeBoardCard(createCardFromBase('where_bone','player'));state.players.player.board.seats[0]=card;state.players.opponent.life=3;
    await resolveHorseEndTurn('player',card);
  });
  expect(await page.evaluate(()=>[state.players.opponent.life,state.gameOver])).toEqual([0,true]);
});
test('最終形の処理順は回復・強化・盤面2ダメージ・本体3ダメージで手札を変えない',async({page})=>{
  const result=await page.evaluate(()=>{
    const order=[];
    const heal=healPlayer,buff=applyPermanentStatBuff,damage=dealDamageToCard,lifeDamage=damagePlayer;
    healPlayer=(...args)=>{order.push('heal');return heal(...args);};
    applyPermanentStatBuff=(...args)=>{order.push('buff');return buff(...args);};
    dealDamageToCard=(...args)=>{order.push('board');return damage(...args);};
    damagePlayer=(...args)=>{order.push('life');return lifeDamage(...args);};
    const card=makeBoardCard(createCardFromBase('where_uma_bone_maibo','player'));state.players.player.life=10;state.players.player.board.seats[0]=card;
    const enemy=makeBoardCard(createCardFromBase('strong_student','opponent'));state.players.opponent.board.seats[0]=enemy;const hp=enemy.currentHp;
    resolveHorseAttendance('player',card);
    return {order,ownLife:state.players.player.life,enemyLife:state.players.opponent.life,stats:[card.attack,card.currentHp],damage:hp-enemy.currentHp,load:state.players.opponent.hand[0].handLoadLevel||0};
  });
  expect(result).toEqual({order:['heal','buff','board','life'],ownLife:13,enemyLife:17,stats:[5,5],damage:2,load:0});
});
test('遠くから参加する学生は注目を持ち、能力値とコピー効果を維持する',async({page})=>{
  expect(await page.evaluate(()=>{
    const card=createCardFromBase('remote_participant_student','player');return {stats:[card.cost,card.attack,card.hp],attention:hasKeyword(card,'注目'),text:cardRulesText(card)};
  })).toEqual({stats:[5,1,2],attention:true,text:'[注目]\nこのカードを手札から出席させたとき、自分の手札にある戦意5以下の融合で生成された出席者カード1枚を選び、そのコピーを出席させる。'});
});
