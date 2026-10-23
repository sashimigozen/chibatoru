(function(root,factory){
  const engine=factory(typeof module==='object'&&module.exports?require('./narabe-cards.js'):root.NarabeCards,
    typeof module==='object'&&module.exports?require('./narabe-specials.js'):root.NarabeSpecials);
  if(typeof module==='object'&&module.exports)module.exports=engine;else root.Narabe=engine;
})(typeof globalThis!=='undefined'?globalThis:this,function(catalog,specials){
  'use strict';
  const {cards,types,start,ranks}=catalog,suits=types.map(t=>t.label),rankName=n=>String(n);
  const byId=new Map(cards.map(c=>[c.id,c])),specialById=new Map(specials.map(c=>[c.id,c]));
  const cardAt=(suit,rank)=>byId.get(suit*ranks+rank-1);
  const cardName=c=>{const card=cardAt(c.suit,c.rank);return card?`${card.name}（${suits[c.suit]}・戦意${c.rank}）`:`${suits[c.suit]}・戦意${c.rank} 空席`;};
  const shuffle=(array,random)=>{const a=[...array];for(let i=a.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;};
  const playing=(g,seat)=>g.players[seat]?.status==='playing';
  const activeSeats=g=>g.players.flatMap((p,i)=>p.status==='playing'?[i]:[]);
  const sortHand=p=>p.hand.sort((a,b)=>a.id-b.id);
  const newTurn=()=>({specialUsed:false,ordinary:0,extra:0,chain:false,chainAnchor:null,chainUsed:false,supplement:false,nextSeat:null});

  function create(names,random=Math.random){
    if(!Array.isArray(names)||names.length<2||names.length>6)throw Error('参加人数は2〜6人です。');
    const deck=shuffle(cards,random),specialDeck=shuffle(specials,random);
    const g={players:names.map((name,i)=>({name,hand:[],specials:specialDeck.slice(i*3,i*3+3).map(c=>c.id),passes:0,status:'playing',rank:null,revealed:[],confused:false})),
      board:types.map((_,suit)=>Array.from({length:ranks},(_,i)=>!cardAt(suit,i+1))),startingCards:[],turn:0,turnState:newTurn(),direction:1,blocks:[],pending:null,
      specialDiscard:[],choiceSerial:0,revision:0,over:false,log:[]};
    deck.forEach((c,i)=>g.players[i%names.length].hand.push(c));
    g.players.forEach((p,i)=>{sortHand(p);p.hand=p.hand.filter(c=>{if(c.rank!==start)return true;g.startingCards.push({seat:i,card:c});g.board[c.suit][start-1]=true;if(c.suit===0)g.turn=i;return false;});});
    g.log.push(`通常カード${cards.length}枚と、1人3枚の専用カードを配りました。専用カードは全員を通して重複なしです。`);
    g.log.push('戦意5の5枚を並べました。「狼(いっぴきおおかみ)」を持っていた人から開始します。通常カードの能力は発動しません。');
    return g;
  }
  function canPlay(g,c,ignoreConnection=false){
    if(!c||!cardAt(c.suit,c.rank)||g.board[c.suit]?.[c.rank-1]!==false||g.blocks?.some(b=>b.suit===c.suit))return false;
    if(!ignoreConnection)for(let n=Math.min(c.rank,start)+1;n<Math.max(c.rank,start);n++)if(!g.board[c.suit][n-1])return false;
    return true;
  }
  const legal=(g,seat)=>(g.players[seat]?.hand||[]).filter(c=>canPlay(g,c));
  function chainLegal(g,seat){
    const t=g.turnState,a=t?.chainAnchor;
    return t?.chain&&!t.chainUsed&&a?(g.players[seat]?.hand||[]).filter(c=>c.suit===a.suit&&Math.abs(c.rank-a.rank)===1&&canPlay(g,c)):[];
  }
  function playable(g,seat){
    if(g.over||g.pending||g.turn!==seat||!playing(g,seat))return [];
    return g.turnState.ordinary<1+g.turnState.extra?legal(g,seat):chainLegal(g,seat);
  }
  function settle(g){
    g.players.forEach(p=>{
      if(p.status==='playing'&&!p.hand.length){p.rank=g.players.filter(x=>x.status==='finished').length+1;p.status='finished';p.revealed=[];g.log.push(`${p.name}が${p.rank}位であがりました。`);}
    });
    const remaining=activeSeats(g);
    if(remaining.length<=1){
      if(remaining.length){const p=g.players[remaining[0]];p.rank=g.players.filter(x=>x.status==='finished').length+1;p.status='finished';}
      g.over=true;g.pending=null;
    }
    return g.over;
  }
  function nextSeat(g,seat){for(let n=1;n<=g.players.length;n++){const i=(seat+g.direction*n+g.players.length*n)%g.players.length;if(playing(g,i))return i;}return seat;}
  function orderedSeats(g,from=g.turn){const result=[];for(let n=0;n<g.players.length;n++){const i=(from+g.direction*n+g.players.length*n)%g.players.length;if(playing(g,i))result.push(i);}return result;}
  function endTurn(g,random){
    const nominated=g.turnState.nextSeat,previous=g.turn;
    if(settle(g))return;
    g.turn=playing(g,nominated)?nominated:nextSeat(g,previous);
    // Resolve consecutive confused turns iteratively, not recursively.
    for(let n=0;n<=g.players.length&&!g.over;n++){
      g.turnState=newTurn();g.blocks=g.blocks.filter(b=>b.owner!==g.turn);g.players[g.turn].revealed=[];
      const p=g.players[g.turn];if(!p.confused)break;p.confused=false;
      const options=legal(g,g.turn);if(!options.length){g.log.push(`${p.name}：混乱で配置できるカードがないため、通常の手番を行います。`);break;}
      place(g,g.turn,options[Math.floor(random()*options.length)],'混乱');
      if(settle(g))break;g.turn=nextSeat(g,g.turn);
    }
  }
  function place(g,seat,c,label=''){
    const p=g.players[seat];p.hand=p.hand.filter(x=>x.id!==c.id);p.revealed=p.revealed.filter(id=>id!==c.id);g.board[c.suit][c.rank-1]=true;
    g.lastMove={seat,cardId:c.id};
    g.log.push(`${p.name}${label?`（${label}）`:''}：${cardName(c)}`);
  }
  function canSpecial(g,seat,id){
    if(g.over||g.pending||seat!==g.turn||!playing(g,seat)||g.turnState.specialUsed||g.turnState.ordinary>0||!g.players[seat].specials.includes(id))return false;
    if(id==='recover')return g.players[seat].passes>0;
    if(id==='supplement')return legal(g,seat).length===0;
    if(id==='cunning')return g.players[seat].hand.some(c=>canPlay(g,c,true));
    return specialById.has(id);
  }
  function prompt(g,kind,seats,source){g.pending={kind,seats:[...seats],responses:{},source,requestId:++g.choiceSerial};}
  function choiceFor(g,seat){
    const q=g.pending;if(!q||!playing(g,seat))return null;
    if(q.kind==='info')return seat===q.source?{kind:'info',title:q.title,groups:q.groups,min:0,requestId:q.requestId}:null;
    if(!q.seats.includes(seat)||Object.hasOwn(q.responses,seat)||(q.kind==='rollcall'&&q.seats[0]!==seat))return null;
    const p=g.players[seat],options=(q.kind==='exchange_all'||q.kind==='reveal'?p.hand:legal(g,seat));
    return {kind:q.kind,requestId:q.requestId,title:({exchange_all:'全員交換：渡す通常カードを選択',reveal:'公開授業：公開する通常カードを選択',force:'強制登校：直ちに配置する通常カードを選択',rollcall:'一斉点呼：配置する通常カードを選択'})[q.kind],cards:options};
  }
  function continueRollcall(g){
    const q=g.pending;if(!q||q.kind!=='rollcall')return;
    while(q.seats.length&&(!playing(g,q.seats[0])||!legal(g,q.seats[0]).length)){const seat=q.seats.shift();if(playing(g,seat))g.log.push(`${g.players[seat].name}：一斉点呼で配置可能なカードはありません。`);}
    if(!q.seats.length)g.pending=null;
  }
  function finishEffect(g,random){
    if(settle(g))return;
    if(!playing(g,g.turn))endTurn(g,random);
  }
  function useSpecial(g,seat,a,random){
    const id=a.specialId;if(!canSpecial(g,seat,id))return false;
    const p=g.players[seat],target=a.targetSeat,targets=['inspect','confuse','exchange','force','nominate'];
    if(targets.includes(id)&&(!Number.isInteger(target)||target===seat||!playing(g,target)))return false;
    if(id==='block'&&(!Number.isInteger(a.suit)||!types[a.suit]))return false;
    const chosen=p.hand.find(c=>c.id===a.cardId);
    if((id==='exchange'||id==='cunning')&&!chosen)return false;
    if(id==='cunning'&&!canPlay(g,chosen,true))return false;
    p.specials=p.specials.filter(x=>x!==id);g.specialDiscard.push(id);g.turnState.specialUsed=true;
    g.log.push(`${p.name}：専用カード「${specialById.get(id).name}」を使用しました。`);
    if(id==='chaos'){
      const seats=activeSeats(g),normal=shuffle(seats.flatMap(i=>g.players[i].hand),random),dedicated=shuffle(seats.flatMap(i=>g.players[i].specials),random);
      let n=0,s=0;for(const i of seats){const x=g.players[i],nc=x.hand.length,sc=x.specials.length;x.hand=normal.slice(n,n+=nc);x.specials=dedicated.slice(s,s+=sc);x.revealed=[];sortHand(x);}
    }else if(id==='extra')g.turnState.extra=1;
    else if(id==='exchange_all'||id==='reveal')prompt(g,id,activeSeats(g),seat);
    else if(id==='block'){g.blocks.push({suit:a.suit,owner:seat});g.log.push(`${suits[a.suit]}は${p.name}の次の手番開始まで配置禁止です。`);}
    else if(id==='recover')p.passes--;
    else if(id==='inspect'||id==='clairvoyance'){
      const seats=id==='inspect'?[target]:activeSeats(g).filter(i=>i!==seat);
      g.pending={kind:'info',source:seat,requestId:++g.choiceSerial,title:specialById.get(id).name,groups:seats.map(i=>({seat:i,cards:id==='inspect'?[...g.players[i].hand]:shuffle(g.players[i].hand,random).slice(0,2)}))};
    }else if(id==='cunning')place(g,seat,chosen,'狡猾老獪');
    else if(id==='confuse')g.players[target].confused=true;
    else if(id==='reverse')g.direction*=-1;
    else if(id==='exchange'){
      const other=g.players[target],received=other.hand[Math.floor(random()*other.hand.length)];
      p.hand=p.hand.filter(c=>c.id!==chosen.id);other.hand=other.hand.filter(c=>c.id!==received.id);p.hand.push(received);other.hand.push(chosen);
      p.revealed=p.revealed.filter(i=>i!==chosen.id);other.revealed=other.revealed.filter(i=>i!==received.id);sortHand(p);sortHand(other);
    }else if(id==='force'){if(legal(g,target).length)prompt(g,'force',[target],seat);else g.log.push(`${g.players[target].name}：強制登校で配置可能なカードはありません。`);}
    else if(id==='chain')g.turnState.chain=true;
    else if(id==='nominate')g.turnState.nextSeat=target;
    else if(id==='supplement')g.turnState.supplement=true;
    else if(id==='rollcall'){prompt(g,'rollcall',orderedSeats(g),seat);continueRollcall(g);}
    else if(id==='rest'){endTurn(g,random);return true;}
    finishEffect(g,random);return true;
  }
  function resolveChoice(g,seat,a,random){
    const choice=choiceFor(g,seat),q=g.pending;if(!choice||a.requestId!==q.requestId)return false;
    if(q.kind==='info'){g.pending=null;return true;}
    const card=choice.cards.find(c=>c.id===a.cardId);if(!card)return false;
    if(q.kind==='rollcall'&&q.seats[0]!==seat)return false;
    if(q.kind==='force'||q.kind==='rollcall'){
      place(g,seat,card,q.kind==='force'?'強制登校':'一斉点呼');
      if(settle(g))return true;
      if(q.kind==='rollcall'){q.seats.shift();continueRollcall(g);}else g.pending=null;
      if(!g.pending)finishEffect(g,random);return true;
    }
    q.responses[seat]=card.id;
    if(!q.seats.every(i=>!playing(g,i)||Object.hasOwn(q.responses,i)))return true;
    if(q.kind==='exchange_all'){
      const seats=orderedSeats(g,q.source),outgoing=seats.map(i=>g.players[i].hand.find(c=>c.id===q.responses[i]));
      seats.forEach((i,n)=>{const p=g.players[i],c=outgoing[n];p.hand=p.hand.filter(x=>x.id!==c.id);p.revealed=p.revealed.filter(id=>id!==c.id);});
      seats.forEach((i,n)=>g.players[seats[(n+1)%seats.length]].hand.push(outgoing[n]));seats.forEach(i=>sortHand(g.players[i]));
      g.log.push('全員が選んだ通常カードを、次のプレイヤーへ同時に渡しました。');
    }else q.seats.filter(i=>playing(g,i)).forEach(i=>{g.players[i].revealed=[q.responses[i]];});
    g.pending=null;finishEffect(g,random);return true;
  }
  function act(g,seat,a,random=Math.random){
    if(!a||typeof a!=='object'||g.over||!playing(g,seat))return false;
    let success=false;if(a.type==='forfeit')return forfeit(g,seat,random);
    if(a.type==='choice')success=resolveChoice(g,seat,a,random);
    else if(!g.pending&&seat===g.turn){
      const p=g.players[seat],t=g.turnState;
      if(a.type==='special')success=useSpecial(g,seat,a,random);
      else if(a.type==='play'||a.type==='chain'){
        const options=a.type==='chain'?chainLegal(g,seat):(t.ordinary<1+t.extra?legal(g,seat):[]),c=options.find(c=>c.id===a.cardId);
        if(c){place(g,seat,c);if(a.type==='chain')t.chainUsed=true;else{t.ordinary++;if(t.chain&&!t.chainAnchor)t.chainAnchor={suit:c.suit,rank:c.rank};}
          if(!settle(g)&&!(t.ordinary<1+t.extra&&legal(g,seat).length)&&!chainLegal(g,seat).length)endTurn(g,random);success=true;}
      }else if(a.type==='pass'||a.type==='end'){
        if(t.ordinary>0){endTurn(g,random);success=true;}
        else if(a.type==='pass'){
          if(!(t.supplement&&!legal(g,seat).length))p.passes++;
          g.log.push(`${p.name}：${t.supplement&&!legal(g,seat).length?'特別補講で手番終了':`パス（${p.passes}/3）`}`);
          if(p.passes>3)eliminate(g,seat);endTurn(g,random);success=true;
        }
      }
    }
    if(success){g.revision++;g.log=g.log.slice(-80);}return success;
  }
  function eliminate(g,seat){
    const p=g.players[seat];p.status='eliminated';p.rank=g.players.length-g.players.filter(x=>x.status==='eliminated').length+1;
    p.hand.forEach(c=>{g.board[c.suit][c.rank-1]=true;});p.hand=[];p.revealed=[];g.specialDiscard.push(...p.specials);p.specials=[];
    g.log.push(`${p.name}は脱落しました。残りの通常カードを場に並べます。`);g.blocks=g.blocks.filter(b=>b.owner!==seat);
  }
  function forfeit(g,seat,random=Math.random){
    if(g.over||!playing(g,seat))return false;
    eliminate(g,seat);const q=g.pending;
    if(settle(g)){g.revision++;return true;}
    if(q){
      if(q.kind==='info'){if(q.source===seat)g.pending=null;}
      else{q.seats=q.seats.filter(i=>i!==seat);delete q.responses[seat];
        if(q.kind==='rollcall')continueRollcall(g);
        else if(q.kind==='force'&&!q.seats.length)g.pending=null;
        else if(['exchange_all','reveal'].includes(q.kind)&&q.seats.every(i=>Object.hasOwn(q.responses,i))){
          const last=q.seats.at(-1),cardId=q.responses[last];delete q.responses[last];resolveChoice(g,last,{cardId,requestId:q.requestId},random);
        }
      }
    }
    if(!g.pending&&!playing(g,g.turn))endTurn(g,random);
    g.revision++;g.log=g.log.slice(-80);return true;
  }
  function actorSeats(g){
    if(g.over)return [];const q=g.pending;if(!q)return [g.turn];
    if(q.kind==='info')return [q.source];if(q.kind==='rollcall')return q.seats.slice(0,1);
    return q.seats.filter(i=>!Object.hasOwn(q.responses,i)&&playing(g,i));
  }
  function aiAction(g,seat){
    const choice=choiceFor(g,seat);
    if(choice){if(choice.kind==='info')return {type:'choice',requestId:choice.requestId};const c=[...choice.cards].sort((a,b)=>b.rank-a.rank)[0];return c?{type:'choice',cardId:c.id,requestId:choice.requestId}:null;}
    if(!actorSeats(g).includes(seat))return null;
    const p=g.players[seat],options=playable(g,seat),target=activeSeats(g).filter(i=>i!==seat).sort((a,b)=>g.players[a].hand.length-g.players[b].hand.length)[0];
    for(const id of p.specials){
      if(!canSpecial(g,seat,id))continue;
      if(id==='recover')return {type:'special',specialId:id};
      if(id==='cunning'&&!options.length)return {type:'special',specialId:id,cardId:p.hand.find(c=>canPlay(g,c,true)).id};
      if(['rest','supplement'].includes(id)&&!options.length)return {type:'special',specialId:id};
      if(id==='extra'&&options.length>=2||id==='chain'&&options.some(c=>p.hand.some(x=>x.suit===c.suit&&Math.abs(x.rank-c.rank)===1)))return {type:'special',specialId:id};
      if(['confuse','force','exchange','nominate','inspect'].includes(id)&&target!==undefined){if(id==='nominate'&&g.players[target].hand.length<3)continue;return {type:'special',specialId:id,targetSeat:target,cardId:p.hand.at(-1)?.id};}
      if(['chaos','reverse','exchange_all','rollcall','clairvoyance','reveal'].includes(id))return {type:'special',specialId:id};
      if(id==='block'){const suit=types.map((_,s)=>s).find(s=>!options.some(c=>c.suit===s));if(suit!==undefined)return {type:'special',specialId:id,suit};}
    }
    return options.length?{type:g.turnState.ordinary<1+g.turnState.extra?'play':'chain',cardId:options[0].id}:{type:g.turnState.ordinary?'end':'pass'};
  }
  function view(g,seat){
    const actors=actorSeats(g),choice=choiceFor(g,seat);
    return {board:g.board,turn:g.turn,turnState:g.turnState,direction:g.direction,blocks:g.blocks,revision:g.revision,over:g.over,log:g.log,startingCards:g.startingCards,lastMove:g.lastMove,actors,
      pending:g.pending?{kind:g.pending.kind,source:g.pending.source,requestId:g.pending.requestId}:null,choice,
      players:g.players.map((p,i)=>({name:p.name,count:p.hand.length,specialCount:p.specials.length,passes:p.passes,status:p.status,rank:p.rank,confused:p.confused,
        revealed:p.hand.filter(c=>p.revealed.includes(c.id)),...(i===seat?{hand:p.hand,specials:p.specials,usableSpecials:p.specials.filter(id=>canSpecial(g,seat,id))}:{})}))};
  }
  function initialDealView(g,seat){
    const initial=structuredClone(g);initial.presenting=true;
    for(const {seat:owner,card} of initial.startingCards||[]){initial.board[card.suit][card.rank-1]=false;initial.players[owner].count++;if(owner===seat)initial.players[owner].hand.push(card);}
    initial.players[seat].hand.sort((a,b)=>a.id-b.id);initial.log=[];return initial;
  }
  return {create,act,legal,canPlay,playable,chainLegal,canSpecial,forfeit,view,initialDealView,actorSeats,aiAction,choiceFor,specials,specialById,suits,rankName,cardName,cardAt,cards,types,start,ranks};
});
