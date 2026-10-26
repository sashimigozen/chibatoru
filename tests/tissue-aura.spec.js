const { test, expect } = require('@playwright/test');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
test.beforeEach(async ({page}) => {
  await page.goto(pathToFileURL(path.join(__dirname, '..', 'index.html')).href);
  await page.evaluate(() => {
    startCardTest('tissue_distributor'); scheduleOpponentAI = () => {};
    state.training.skipAnimations = true; state.phase = 'battle'; state.actionTurn = 8;
    state.currentSide = 'player'; state.environment = null;
    for (const side of ['player', 'opponent']) Object.assign(state.players[side], {
      board: { teacher: null, seats: Array(9).fill(null) }, hand: [], deck: [], trash: [],
      will: 20, maxWill: 20, life: 20, attendancesThisTurn: 0 });
  });
});
test('全文・基本値・分類が一致し、全回復の本文はない', async ({page}) => {
  const result = await page.evaluate(() => {
    const c = createCardFromBase('tissue_distributor', 'player');
    return {text:cardRulesText(c), stats:[c.cost,c.attack,c.hp], specialty:SPECIALTY_CARD_IDS.cafeteria.includes(c.baseId)};
  });
  expect(result).toEqual({stats:[5,2,2], specialty:true,
    text:'このカードが自分の講義室にいるかぎり、自分の講義室にいるヴァンパイアすべての体力を+1する。\n環境が「食堂」であるかぎり、このカードの戦意を-2し、自分の講義室にいるヴァンパイアすべての体力をさらに+1する。\nこの効果は重複しない。'});
});
for (const side of ['player','opponent']) {
  test('複数いても自身・席・教卓への強化は重複せず、食堂と出入りに追従 ' + side, async ({page}) => {
    const result = await page.evaluate(side => {
      const p = state.players[side], other = oppositeSide(side);
      const first = makeBoardCard(createCardFromBase('tissue_distributor',side)); p.board.seats[0]=first;
      const second = makeBoardCard(createCardFromBase('tissue_distributor',side));
      const ally = makeBoardCard(createCardFromBase('hearty_grandma',side)); p.board.teacher=ally;
      const student = makeBoardCard(createCardFromBase('general_student',side)); p.board.seats[2]=student;
      const enemy = makeBoardCard(createCardFromBase('hearty_grandma',other)); state.players[other].board.seats[0]=enemy;
      const values=()=>[first.maxHp,ally.maxHp,student.maxHp,enemy.maxHp];
      applyBoardAuras(); const single=values();
      p.board.seats[1]=second; applyBoardAuras(); const double=values();
      state.environment=createCardFromBase('cafeteria',side); applyBoardAuras(); const food=values();
      const cost=effectiveCardCost(first);
      state.environment=null; applyBoardAuras(); const removedFood=values();
      p.board.seats[1]=null; applyBoardAuras(); const removedSecond=values();
      p.board.seats[0]=null; applyBoardAuras();
      return {single,double,food,cost,removedFood,removedSecond,finalAlly:ally.maxHp};
    }, side);
    expect(result).toEqual({single:[3,3,2,2],double:[3,3,2,2],food:[4,4,2,2],cost:3,
      removedFood:[3,3,2,2],removedSecond:[3,3,2,2],finalAlly:2});
  });
  test('出席しても全回復せず、後から出た味方にも継続強化 ' + side, async ({page}) => {
    const result = await page.evaluate(side => {
      const p=state.players[side]; state.currentSide=side;
      const ally=makeBoardCard(createCardFromBase('chen_san',side)); ally.currentHp=1; p.board.seats[0]=ally;
      const source=makeBoardCard(createCardFromBase('tissue_distributor',side));
      attendCard(side,source,'seat',1,{attendanceSource:ATTENDANCE_SOURCE.HAND}); applyBoardAuras();
      const damaged=[ally.currentHp,ally.maxHp];
      const later=makeBoardCard(createCardFromBase('hearty_grandma',side));
      attendCard(side,later,'seat',2,{attendanceSource:ATTENDANCE_SOURCE.EFFECT}); applyBoardAuras();
      return {damaged,later:[later.currentHp,later.maxHp],source:[source.currentHp,source.maxHp]};
    }, side);
    expect(result).toEqual({damaged:[2,4],later:[3,3],source:[3,3]});
  });
  test('南京錠・継続効果無効化・瀕死の効果元を除外する ' + side, async ({page}) => {
    const result=await page.evaluate(side=>{
      const p=state.players[side];
      const source=makeBoardCard(createCardFromBase('tissue_distributor',side)); p.board.teacher=source;
      const ally=makeBoardCard(createCardFromBase('hearty_grandma',side));p.board.seats[0]=ally;
      applyBoardAuras(); const before=ally.maxHp;
      source.padlockEquipment={baseId:'padlock'};applyBoardAuras();const locked=ally.maxHp;
      source.padlockEquipment=null;state.kashikashiActionTurn=state.actionTurn;applyBoardAuras();const suppressed=ally.maxHp;
      state.kashikashiActionTurn=null;applyBoardAuras();const restored=ally.maxHp;
      source.currentHp=0;applyBoardAuras();
      return {before,locked,suppressed,restored,after:ally.maxHp};
    },side);
    expect(result).toEqual({before:3,locked:2,suppressed:2,restored:3,after:2});
  });
}
test('詳細の強化元・継続効果・オンラインの視点変換を確認する', async ({page})=>{
  const result=await page.evaluate(()=>{
    const source=makeBoardCard(createCardFromBase('tissue_distributor','player'));state.players.player.board.seats[0]=source;
    applyBoardAuras();
    const detail=battleCardDerivedStatModifiers(source);
    const lines=boardActiveEffectLines('player');
    const guest=makeBoardCard(onlineSwapOwnersDeep(onlineCreateSnapshot().state.players.player.board.seats[0]));
    state.players.player.board.seats[0]=null;state.players.opponent.board.seats[0]=guest;
    applyBoardAuras();
    return {detail,lines,guest:[guest.owner,guest.maxHp,guest.currentHp]};
  });
  expect(result.detail).toContainEqual({source:'ティッシュ配り',attack:0,hp:1,defense:0});
  expect(result.lines.join('')).toContain('ヴァンパイアすべての体力を+1');
  expect(result.lines.join('')).not.toContain('戦意');
  expect(result.guest).toEqual(['opponent',3,3]);
});

for (const side of ['player','opponent']) {
  test('複数の効果元の一方が無効でも残る1人だけで強化する ' + side, async ({page}) => {
    const result = await page.evaluate(side => {
      const p = state.players[side];
      const first = makeBoardCard(createCardFromBase('tissue_distributor', side));
      const second = makeBoardCard(createCardFromBase('tissue_distributor', side));
      p.board.seats[0] = first; p.board.teacher = second;
      state.environment = createCardFromBase('cafeteria', side);
      applyBoardAuras(); const both = friendlyTissueHpBonus(side);
      first.padlockEquipment = {baseId:'padlock'};
      applyBoardAuras(); const one = friendlyTissueHpBonus(side);
      second.padlockEquipment = {baseId:'padlock'};
      applyBoardAuras(); const none = friendlyTissueHpBonus(side);
      second.padlockEquipment = null;
      applyBoardAuras(); const restored = friendlyTissueHpBonus(side);
      return {both,one,none,restored};
    }, side);
    expect(result).toEqual({both:2,one:2,none:0,restored:2});
  });
}

test('AIは2人目の強化を追加分として優先しない', async ({page}) => {
  const result = await page.evaluate(() => {
    const side = 'player';
    const hand = createCardFromBase('tissue_distributor', side);
    state.players[side].board.seats[0] = makeBoardCard(createCardFromBase('hearty_grandma', side));
    const first = trainingYocchanPlayPriority(side, hand);
    state.players[side].board.seats[1] = makeBoardCard(createCardFromBase('tissue_distributor', side));
    applyBoardAuras();
    const second = trainingYocchanPlayPriority(side, hand);
    return {first,second};
  });
  expect(result.first).toBeGreaterThanOrEqual(800);
  expect(result.second).toBeLessThan(800);
});
