const {test,expect}=require('@playwright/test');
const {pathToFileURL}=require('node:url');
const path=require('node:path');
test.beforeEach(async({page})=>{
  await page.goto(pathToFileURL(path.join(__dirname,'..','index.html')).href);
  await page.evaluate(()=>{startCardTest('umaibo');state.environment=null;state.training.skipAnimations=true;scheduleOpponentAI=()=>{};});
});
test('完成品7種類が校外送りで消滅し、素材・定規・U太系は変更しない',async({page})=>{
  const result=await page.evaluate(()=>{
    const ids=[...Object.values(HORSE_PAIR_RESULTS),'where_uma_bone_maibo'];state.players.player.trash=[];
    const cards=ids.map(id=>createCardFromBase(id,'player'));
    cards.forEach(card=>moveToTrash('player',card));
    return {tokens:cards.every(isTokenCard),vanished:cards.every(card=>card.tokenVanished),recoverable:cards.some(canRecoverTrashCard),trash:state.players.player.trash.length,
      untouched:[...HORSE_MATERIAL_IDS,'double_diamond','ultimate_yuta'].every(id=>!isTokenCard(createCardFromBase(id,'player')))};
  });
  expect(result).toEqual({tokens:true,vanished:true,recoverable:false,trash:0,untouched:true});
});
test('既存の校外に残る完成品も回収候補から除外し、占有マスを破壊時に空ける',async({page})=>{
  expect(await page.evaluate(()=>{
    const card=makeBoardCard(createCardFromBase('umaibo','player'));delete card.token;
    state.players.player.trash=[{...card}];removeLegacyTrashTokens();const oldTrash=state.players.player.trash.length;
    state.players.player.board={teacher:null,seats:Array(9).fill(null)};state.players.player.board.seats[0]=card;
    destroyBoardCard({owner:'player',zone:'seat',index:0});
    return {oldTrash,trash:state.players.player.trash.length,field:state.players.player.board.seats[0]};
  })).toEqual({oldTrash:0,trash:0,field:null});
});
test('直接手札に戻す処理はミジンコと同じ挙動を維持する',async({page})=>{
  expect(await page.evaluate(()=>{
    state.players.player.board={teacher:null,seats:Array(9).fill(null)};state.players.player.hand=[];state.players.player.will=10;
    const card=makeBoardCard(createCardFromBase('umaibo','player'));state.players.player.board.seats[0]=card;
    const item=createCardFromBase('go_home','player');state.players.player.hand=[item];
    castItemOnCard('player',item,'player','seat',0,false);
    return state.players.player.hand.some(card=>card.baseId==='umaibo'&&isTokenCard(card));
  })).toBe(true);
});
