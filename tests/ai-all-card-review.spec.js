const {test,expect}=require('@playwright/test');
const {pathToFileURL}=require('node:url');
const path=require('node:path');

test.beforeEach(async({page})=>{
  await page.goto(pathToFileURL(path.join(__dirname,'..','index.html')).href);
  await page.evaluate(()=>{
    startCardTest('general_student');scheduleOpponentAI=()=>{};
    state.training.skipAnimations=true;state.screen='battle';state.phase='battle';state.currentSide='opponent';
    state.environment=null;state.gameOver=false;state.actionTurn=9;state.firstSide='player';
    for(const side of ['player','opponent'])Object.assign(state.players[side],{
      board:{teacher:null,seats:Array(9).fill(null)},hand:[],deck:[],trash:[],late:[],will:10,maxWill:10,life:20,
      turnsTaken:5,originalDeckCounts:{},abyssTurns:0,internTurnsRemaining:0
    });
  });
});

test('全カードを両サイド・4盤面で評価して例外・NaN・無限加点・盤面変更がない',async({page},info)=>{
  const result=await page.evaluate(()=>{
    const rows=[],errors=[];
    for(const scenario of ['empty','balanced','danger','full']){
      for(const owner of ['player','opponent']){
        const p=state.players[owner];p.board={teacher:null,seats:Array(9).fill(null)};
        p.life=scenario==='danger'?5:20;
        p.deck=['fusion_uma','fusion_bone','yuta','general_student','ruler','general_teacher'].map(id=>createCardFromBase(id,owner));
        if(scenario!=='empty'){
          p.board.teacher=makeBoardCard(createCardFromBase('general_teacher',owner));
          const ids=scenario==='full'?['umaibo','uma_bone','where_uma','maibo_bone','where_maibo','where_bone','general_student','strong_student','trpg_member']:['general_student','strong_student','uma_bone'];
          ids.forEach((id,i)=>{p.board.seats[i]=makeBoardCard(createCardFromBase(id,owner));p.board.seats[i].playedOnTurn=0;});
        }
      }
      for(const side of ['player','opponent'])for(const [id,base] of Object.entries(CARD_BASES)){
        const card=createCardFromBase(id,side);state.currentSide=side;state.players[side].hand=[card];
        const before=JSON.stringify(['player','opponent'].map(s=>state.players[s].board));
        try{
          const scores={choice:trainingAiChoiceCardScore(side,card),mulligan:scoreAiMulliganKeep(card,[card],side)};
          if(base.type==='environment')scores.play=scoreAiEnvironment(card,side);
          else if(base.type==='item')scores.play=side==='opponent'?scoreAiItem(card):scoreTrainingYocchanItem(side,card);
          else scores.play=side==='opponent'?scoreAiPlacement(card,base.type==='teacher'?'teacher':'seat',4):trainingYocchanPlayPriority(side,card);
          for(const [key,value] of Object.entries(scores))if(typeof value!=='number'||Number.isNaN(value)||value===Infinity)errors.push(`${scenario}/${side}/${id}/${key}: ${value}`);
          if(before!==JSON.stringify(['player','opponent'].map(s=>state.players[s].board)))errors.push(`${scenario}/${side}/${id}: mutated board`);
          rows.push({id,name:base.name,side,scenario,...Object.fromEntries(Object.entries(scores).map(([k,v])=>[k,Number.isFinite(v)?v:'hold']))});
        }catch(e){errors.push(`${scenario}/${side}/${id}: ${e.message}`);}
      }
    }
    return {count:Object.keys(CARD_BASES).length,rows,errors};
  });
  await info.attach('全カード評価結果',{body:JSON.stringify(result,null,2),contentType:'application/json'});
  expect(result.errors).toEqual([]);expect(result.rows).toHaveLength(result.count*8);expect(result.count).toBeGreaterThan(250);
});

for(const side of ['player','opponent'])test(`${side}: 融合最終形の戦意6と素材温存・現行の継続効果を評価する`,async({page})=>{
  const result=await page.evaluate(side=>{
    state.currentSide=side;
    const p=state.players[side];
    p.hand=HORSE_MATERIAL_IDS.map(id=>createCardFromBase(id,side));p.will=5;
    const held=!tryFuseHorseForAi(side)&&p.hand.length===4;
    p.will=6;const fused=tryFuseHorseForAi(side)&&p.hand[0].baseId==='where_uma_bone_maibo';
    const buff=makePreviewCard('uma_bone',side);const alone=aiRecurringCardValue(side,buff);
    p.board.seats[0]=makeBoardCard(createCardFromBase('general_student',side));const withAlly=aiRecurringCardValue(side,buff);
    const healer=makePreviewCard('umaibo',side);const fullHeal=aiRecurringCardValue(side,healer);p.life=10;
    const woundedHeal=aiRecurringCardValue(side,healer);
    p.board.seats[1]=makeBoardCard(createCardFromBase('umaibo',side));const endHeal=aiEndTurnHealing(side);
    return {held,fused,alone,withAlly,fullHeal,woundedHeal,endHeal};
  },side);
  expect(result).toEqual({held:true,fused:true,alone:0,withAlly:3,fullHeal:0,woundedHeal:6,endHeal:3});
});

for(const side of ['player','opponent'])test(`${side}: 持ち物の条件・自滅回避と実際の実行経路をそろえる`,async({page})=>{
  const result=await page.evaluate(side=>{
    const p=state.players[side],enemy=state.players[oppositeSide(side)];
    const book=createCardFromBase('forbidden_book',side);p.hand=[book];enemy.life=5;p.life=3;
    const unsafe=planAiUtilityItem(side,book).score;p.life=4;const lethal=planAiUtilityItem(side,book).score;
    enemy.lifeShieldUntilTurn=state.actionTurn;enemy.lifeShieldUntilSide=side;const blocked=planAiUtilityItem(side,book).score;
    enemy.lifeShieldUntilTurn=0;
    const item=createCardFromBase('big_wall',side);p.hand=[item];
    const missing=planAiUtilityItem(side,item).score;
    [0,1].forEach(i=>p.board.seats[i]=makeBoardCard(createCardFromBase('general_student',side)));
    const plan=planAiUtilityItem(side,item),used=useAiUtilityItem(side,item,plan);
    return {unsafe,lethal,blocked,missing,used,hp:p.board.seats.slice(0,2).map(c=>c.currentHp),attention:p.board.seats.slice(0,2).every(c=>hasKeyword(c,'注目'))};
  },side);
  expect(result).toEqual({unsafe:0,lethal:1000,blocked:0,missing:0,used:true,hp:[4,4],attention:true});
});

for(const side of ['player','opponent'])test(`${side}: 強化先・効果源の保護と確定した終了時除去を判断する`,async({page})=>{
  const result=await page.evaluate(async side=>{
    state.currentSide=side;state.training.active=true;state.training.leftController='ai';
    const p=state.players[side],enemy=state.players[oppositeSide(side)];
    const multi=makeBoardCard(createCardFromBase('absolute_woman',side));
    const big=makeBoardCard(createCardFromBase('strong_student',side));
    const locked=makeBoardCard(createCardFromBase('strong_student',side));locked.padlockEquipment={baseId:'padlock'};
    p.board.seats[0]=multi;p.board.seats[1]=big;p.board.seats[2]=locked;
    const source=makeBoardCard(createCardFromBase('uma_bone',side));p.board.seats[3]=source;
    const chosen=await chooseFusionEffectCards(side,source,[locked,big,multi],2,'buff');
    const target=makeBoardCard(createCardFromBase('general_student',oppositeSide(side)));enemy.board.seats[0]=target;
    const removal=makeBoardCard(createCardFromBase('maibo_bone',side));p.board.seats[4]=removal;
    const safe=planAiGuaranteedEndTurnEffectKills(side);
    target.padlockEquipment={baseId:'padlock'};const immune=planAiGuaranteedEndTurnEffectKills(side);
    return {chosen:chosen.map(c=>c.baseId),kill:safe.targetIds.has(target.instanceId),keep:safe.sourceIds.has(removal.instanceId),immune:immune.targetIds.has(target.instanceId)};
  },side);
  expect(result).toEqual({chosen:['absolute_woman','strong_student'],kill:true,keep:true,immune:false});
});

test('環境は双方への利益を比較し、遅刻の解消・回復の損得を評価する',async({page})=>{
  const result=await page.evaluate(()=>{
    const p=state.players.opponent,enemy=state.players.player;
    p.board.seats[0]=makeBoardCard(createCardFromBase('ae_student','opponent'));
    const cote=makePreviewCard('cote_dazur','opponent');const own=scoreAiEnvironment(cote);
    p.board.seats[0]=null;enemy.board.seats[0]=makeBoardCard(createCardFromBase('ae_student','player'));
    const other=scoreAiEnvironment(cote);
    const noLate=makePreviewCard('no_late_time','opponent');p.hand=[createCardFromBase('adjective_student','opponent')];
    const helps=scoreAiEnvironment(noLate);p.hand=[];enemy.hand=[createCardFromBase('adjective_student','player')];
    enemy.hand[0].publicHandAddition=true;const hurts=scoreAiEnvironment(noLate);
    const heal=createCardFromBase('peaceful_mind','opponent');p.life=15;enemy.life=20;const useful=baseScoreAiItem(heal);
    p.life=20;enemy.life=15;const useless=baseScoreAiItem(heal);
    return {own,other,helps,hurts,useful,useless};
  });
  expect(result.own).toBeGreaterThan(result.other);expect(result.helps).toBeGreaterThan(result.hurts);
  expect(result.useful).toBeGreaterThan(0);expect(result.useless).toBe(0);
});

for(const side of ['player','opponent'])test(`${side}: 生成・手札破壊の新しいAI実行先は実際に効果を解決する`,async({page})=>{
  const result=await page.evaluate(side=>{
    state.currentSide=side;const p=state.players[side],enemy=state.players[oppositeSide(side)];
    p.deck=[createCardFromBase('yuta',side)];const generate=createCardFromBase('think_so',side);p.hand=[generate];
    const generated=useAiUtilityItem(side,generate,planAiUtilityItem(side,generate));
    const yutas=p.hand.filter(c=>c.baseId==='yuta').map(c=>effectiveCardCost(c));
    const discard=createCardFromBase('philosophy_cheating',side);p.hand.push(discard);
    enemy.hand=['ruler','seriously_hit','suspicious_document'].map(id=>createCardFromBase(id,oppositeSide(side)));
    const plan=planAiUtilityItem(side,discard),used=useAiUtilityItem(side,discard,plan);
    return {generated,yutas,used,remaining:enemy.hand.map(c=>c.baseId),trash:enemy.trash.map(c=>c.baseId).sort()};
  },side);
  expect(result).toEqual({generated:true,yutas:[2,2],used:true,remaining:['suspicious_document'],trash:['ruler','seriously_hit']});
});
