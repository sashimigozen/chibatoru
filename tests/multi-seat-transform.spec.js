const { test, expect } = require('@playwright/test');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
test.beforeEach(async ({page})=>{
  await page.goto(pathToFileURL(path.join(__dirname,'..','index.html')).href);
  await page.evaluate(()=>{
    startCardTest('zombie');scheduleOpponentAI=()=>{};
    state.training.skipAnimations=true;state.phase='battle';state.actionTurn=8;state.currentSide='player';state.environment=null;
    for(const side of ['player','opponent']) Object.assign(state.players[side],{
      board:{teacher:null,seats:Array(9).fill(null)},hand:[],deck:[],trash:[],late:[],life:20,will:20,maxWill:20
    });
  });
});
for(const side of ['player','opponent']) {
  for(const id of ['loud_members','big_omata','plump_student','adjective_vs_cynical']) {
    test('ゾンビ変化で1枚・1マスへ戻り、空きマスと退場も正常 '+side+' '+id,async({page})=>{
      const result=await page.evaluate(({side,id})=>{
        const other=oppositeSide(side);
        const target=makeBoardCard(createCardFromBase(id,side));target.attack=0;
        placeMultiSeatCard(side,0,target);
        const oldIndexes=[...target.occupiedSeatIndexes];
        const attacker=makeBoardCard(createCardFromBase('zombie',other));state.players[other].board.seats[0]=attacker;
        resolveCardAttack(attacker,target);
        render();
        const occupied=state.players[side].board.seats.flatMap((card,index)=>card?.instanceId===target.instanceId?[index]:[]);
        const nodeCount=document.querySelectorAll('#'+side+'SeatGrid [data-card-id="'+target.instanceId+'"]').length;
        const guest=onlineTransformSnapshotForGuest(onlineCreateSnapshot().state);
        const guestSeats=guest.players[other].board.seats.filter(card=>card?.instanceId===target.instanceId).length;
        const free=oldIndexes.slice(1).every(index=>isBoardSlotOpen(side,'seat',index));
        const shape=target.occupiedSeatSize??null;
        const refs=listBoardRefs(side).length;
        destroyBoardCard({owner:side,zone:'seat',index:0});
        return {baseId:target.baseId,occupied,nodeCount,guestSeats,free,shape,refs,
          remaining:listBoardRefs(side).length,trash:state.players[side].trash.filter(c=>c.instanceId===target.instanceId).length};
      },{side,id});
      // Preserve the existing token-removal rule; footprint changes must not change it.
      expect(result).toEqual({baseId:'zombie',occupied:[0],nodeCount:1,guestSeats:1,free:true,shape:null,refs:1,remaining:0,trash:id==='big_omata'?0:1});
    });
  }
  test('インターンも大型学生の占有マスを解放し基準マスだけに変化する '+side,async({page})=>{
    const result=await page.evaluate(side=>{
      const target=makeBoardCard(createCardFromBase('loud_members',side));placeMultiSeatCard(side,4,target);
      const id=target.instanceId;state.players[side].internTurnsRemaining=1;
      const transformed=resolveInternEndTurnEffect(side);render();
      return {baseId:transformed.baseId,idSame:transformed.instanceId===id,
        occupied:state.players[side].board.seats.flatMap((c,i)=>c?[i]:[]),
        shape:transformed.occupiedSeatSize??null,refs:listBoardRefs(side).length,
        nodes:document.querySelectorAll('#'+side+'SeatGrid [data-card-id="'+id+'"]').length,
        free:[5,7,8].every(i=>isBoardSlotOpen(side,'seat',i))};
    },side);
    expect(result).toEqual({baseId:'suit_student',idSame:true,occupied:[4],shape:null,refs:1,nodes:1,free:true});
  });
}
test('変化後のゾンビを通常サイズで実表示し、元の基準マスを維持する',async({page})=>{
  await page.evaluate(()=>{
    const target=makeBoardCard(createCardFromBase('loud_members','opponent'));target.attack=0;
    placeMultiSeatCard('opponent',4,target);
    const attacker=makeBoardCard(createCardFromBase('zombie','player'));state.players.player.board.seats[0]=attacker;
    resolveCardAttack(attacker,target);render();
  });
  const transformed=page.locator('#opponentSeatGrid [data-base-id="zombie"]');
  await expect(transformed).toHaveCount(1);
  await expect(transformed).not.toHaveClass(/multi-seat-board-card/);
  expect(await page.evaluate(()=>listBoardRefs('opponent'))).toEqual([{owner:'opponent',zone:'seat',index:4}]);
  await page.screenshot({path:test.info().outputPath('transformed-zombie.png')});
});
