const {test,expect}=require('@playwright/test');
const {pathToFileURL}=require('node:url');
const path=require('node:path');
const fs=require('node:fs');
const text='このカードを手札から出席させたとき、自分の気力を1回復する。このカードが自分の講義室にいるかぎり、自分の気力が回復したとき、自分の気力を1回復する。このカードは講義を持たない。';

test.beforeEach(async({page})=>{
  await page.goto(pathToFileURL(path.join(__dirname,'..','index.html')).href);
  await page.evaluate(()=>{
    startCardTest('smiling_lecturer');scheduleOpponentAI=()=>{};
    state.training.skipAnimations=true;state.phase='battle';state.currentSide='player';state.actionTurn=8;
    state.environment=null;state.kashikashiActionTurn=null;state.gameOver=false;
    for(const side of ['player','opponent'])Object.assign(state.players[side],{
      board:{teacher:null,seats:Array(9).fill(null)},hand:[],deck:[],trash:[],life:10,will:20,maxWill:20,effectUseLockTurnsRemaining:0
    });
  });
});

test('能力値・本文・デッキ登録・講義なし',async({page})=>{
  const r=await page.evaluate(()=>{
    const c=makeBoardCard(createCardFromBase('smiling_lecturer','player'));
    state.players.player.board.teacher=c;
    return {stats:[c.cost,c.attack,c.hp],category:c.category,zones:c.allowedZones,text:cardRulesText(c).replaceAll('\n',''),deck:ALL_DECK_IDS.includes(c.baseId),lecture:canTeacherChooseLecture({owner:'player',zone:'teacher'})};
  });
  expect(r).toEqual({stats:[4,0,4],category:'common',zones:['teacher'],text:text.replace('講義を','[講義]を'),deck:true,lecture:false});
  const catalog=require('../server/card-catalog.json');expect(catalog.direct).toContain('smiling_lecturer');expect(catalog.specialties.common).toContain('smiling_lecturer');
  expect(fs.readFileSync(path.join(__dirname,'../card_rules.txt'),'utf8')).toContain(`smiling_lecturer: "${text}"`);
});

for(const side of ['player','opponent'])test(`手札出席時の1回復から上限まで1ずつ連鎖する ${side}`,async({page})=>{
  expect(await page.evaluate(side=>{
    const events=[];const record=analyticsRecordEffect;analyticsRecordEffect=e=>{if(e.effectType==='heal_life')events.push(e.details.healed);record(e)};
    attendCard(side,makeBoardCard(createCardFromBase('smiling_lecturer',side)),'teacher',null,{attendanceSource:ATTENDANCE_SOURCE.HAND});
    analyticsRecordEffect=record;
    const snapshot=onlineTransformSnapshotForGuest(onlineCreateSnapshot().state);
    return {life:state.players[side].life,other:state.players[oppositeSide(side)].life,events,snapshotLife:snapshot.players[oppositeSide(side)].life};
  },side)).toEqual({life:20,other:10,events:Array(10).fill(1),snapshotLife:20});
});

test('効果による出席時には回復せず、その後のおにぎりドローには反応する',async({page})=>{
  expect(await page.evaluate(()=>{
    attendCard('player',makeBoardCard(createCardFromBase('smiling_lecturer','player')),'teacher',null,{attendanceSource:ATTENDANCE_SOURCE.GENERATED});
    const generated=state.players.player.life;
    const item=createCardFromBase('onigiri_draw','player');state.players.player.hand=[item];
    state.players.player.deck=[createCardFromBase('general_student','player'),createCardFromBase('general_student','player')];
    castImmediateItem('player',item,false);
    return [generated,state.players.player.life,state.players.player.hand.length];
  })).toEqual([10,20,2]);
});

test('複数人も連鎖し、実際の回復が0なら発動しない',async({page})=>{
  expect(await page.evaluate(()=>{
    state.players.player.board.teacher=makeBoardCard(createCardFromBase('smiling_lecturer','player'));
    state.players.player.board.seats[0]=makeBoardCard(createCardFromBase('smiling_lecturer','player'));
    const effects=[];const record=analyticsRecordEffect;analyticsRecordEffect=e=>{if(e.effectType==='heal_life')effects.push(e.source?.instanceId||'initial')};
    const recovered=healPlayer('player',2);const life=state.players.player.life;
    const count=effects.length;healPlayer('player',1);healPlayer('player',0);const after=effects.length;
    analyticsRecordEffect=record;
    return {recovered,life,count,after,sources:new Set(effects.slice(1)).size};
  })).toEqual({recovered:2,life:20,count:9,after:9,sources:2});
});

test('カシカシ・南京錠・退場・体力0では連鎖せず、出席時効果禁止も守る',async({page})=>{
  expect(await page.evaluate(()=>{
    const c=makeBoardCard(createCardFromBase('smiling_lecturer','player'));state.players.player.board.teacher=c;
    const result=[];state.kashikashiActionTurn=state.actionTurn;healPlayer('player',1);result.push(state.players.player.life);
    state.kashikashiActionTurn=null;c.padlockEquipment={baseId:'padlock'};healPlayer('player',1);result.push(state.players.player.life);
    c.padlockEquipment=null;c.currentHp=0;healPlayer('player',1);result.push(state.players.player.life);
    state.players.player.board.teacher=null;healPlayer('player',1);result.push(state.players.player.life);
    state.players.player.effectUseLockTurnsRemaining=1;
    attendCard('player',makeBoardCard(createCardFromBase('smiling_lecturer','player')),'teacher',null,{attendanceSource:ATTENDANCE_SOURCE.HAND});result.push(state.players.player.life);
    healPlayer('player',1);result.push(state.players.player.life);
    return result;
  })).toEqual([11,12,13,14,14,20]);
});

test('気力上限10や独自上限で停止し、相手側の微笑み講師は反応しない',async({page})=>{
  expect(await page.evaluate(()=>{
    state.players.opponent.board.teacher=makeBoardCard(createCardFromBase('smiling_lecturer','opponent'));
    healPlayer('player',1);const other=state.players.player.life;
    state.players.player.board.teacher=makeBoardCard(createCardFromBase('smiling_lecturer','player'));
    state.players.player.life=1;state.players.player.maxLifeOverride=7;healPlayer('player',1);const seven=state.players.player.life;
    delete state.players.player.maxLifeOverride;state.environment=createCardFromBase('shogi_duel_field','player');state.players.player.life=1;healPlayer('player',1);
    return [other,seven,state.players.player.life,state.players.opponent.life];
  })).toEqual([11,7,10,10]);
});

test('体力回復では反応せず、超吸血の気力回復には反応する',async({page})=>{
  expect(await page.evaluate(()=>{
    state.players.player.board.teacher=makeBoardCard(createCardFromBase('smiling_lecturer','player'));
    const vampire=makeBoardCard(createCardFromBase('hearty_grandma','player'));vampire.currentHp=1;state.players.player.board.seats[0]=vampire;
    healCard(vampire,1);const attendee=state.players.player.life;healVampireFromDamage(vampire,2);
    return [attendee,state.players.player.life];
  })).toEqual([10,20]);
});

test('CPUは気力が減っている時ほど出席を高く評価する',async({page})=>{
  expect(await page.evaluate(()=>{
    const c=createCardFromBase('smiling_lecturer','opponent');
    state.players.opponent.life=20;const full=scoreAiPlacement(c,'teacher',null);
    state.players.opponent.life=5;return scoreAiPlacement(c,'teacher',null)>full;
  })).toBe(true);
});
