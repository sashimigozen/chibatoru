'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const E=require('./narabe-engine');
const c=(s,r)=>E.cardAt(s,r);
function game(id){
  const g=E.create(['A','B','C'],()=>.4);g.turn=0;
  const hands=[[c(0,1),c(0,4),c(0,6),c(0,7),c(0,10)],[c(0,2),c(0,3),c(0,8),c(0,9)],[c(1,3),c(1,4),c(1,6),c(1,7),c(1,8)]];
  g.players.forEach((p,i)=>{p.hand=hands[i];p.specials=i===0?[id]:[];p.passes=0;});return g;
}
const use=(g,id,params={})=>{assert.equal(E.act(g,0,{type:'special',specialId:id,...params},()=>.4),true);};
const choose=(g,seat,cardId)=>assert.equal(E.act(g,seat,{type:'choice',cardId,requestId:g.pending?.requestId},()=>.4),true);

test('18種類が全員重複なし・各人3枚。通常43枚・空席7・環境10は空席',()=>{
  for(let n=2;n<=6;n++)for(let k=0;k<30;k++){
    const g=E.create(Array.from({length:n},(_,i)=>`P${i}`));
    const ids=g.players.flatMap(p=>p.specials);assert.equal(ids.length,n*3);assert.equal(new Set(ids).size,n*3);
    assert.ok(g.players.every(p=>p.specials.length===3));
    for(let seat=0;seat<n;seat++)E.view(g,seat).players.forEach((p,i)=>{assert.equal(p.specials!==undefined,i===seat);assert.equal(p.hand!==undefined,i===seat);assert.equal(p.specialCount,3);});
  }
  assert.equal(E.cards.length,43);assert.equal(E.specials.length,18);assert.equal(E.cardAt(4,10),undefined);
  for(const [s,r,id]of[[1,6,'kakiage_teacher'],[2,6,'jobs_woody'],[2,9,'window_eater'],[3,8,'ittan']])assert.equal(c(s,r).baseId,id);
});
test('カオスは枚数を保ち通常と専用を混ぜない。使用したカードは戻らない',()=>{
  const g=E.create(['A','B','C','D','E','F']);g.turn=g.players.findIndex(p=>p.specials.includes('chaos'));const seat=g.turn;
  const normal=g.players.map(p=>p.hand.length),before=g.players.flatMap(p=>p.hand.map(c=>c.id)).sort((a,b)=>a-b);
  const specialCounts=g.players.map((p,i)=>p.specials.length-(i===seat?1:0));
  assert.ok(E.act(g,seat,{type:'special',specialId:'chaos'},()=>.2));
  assert.deepEqual(g.players.map(p=>p.hand.length),normal);assert.deepEqual(g.players.map(p=>p.specials.length),specialCounts);
  assert.deepEqual(g.players.flatMap(p=>p.hand.map(c=>c.id)).sort((a,b)=>a-b),before);
  assert.equal(g.players.flatMap(p=>p.specials).includes('chaos'),false);assert.equal(new Set(g.players.flatMap(p=>p.specials)).size,17);
});
test('追加手番は通常配置が2回。専用カードは1枚のみ、配置後の専用も禁止',()=>{
  const g=game('extra');g.players[0].specials.push('reverse');use(g,'extra');
  assert.equal(E.act(g,0,{type:'special',specialId:'reverse'}),false);
  assert.equal(E.act(g,0,{type:'play',cardId:c(0,4).id}),true);assert.equal(g.turn,0);
  assert.equal(E.act(g,0,{type:'play',cardId:c(0,6).id}),true);assert.equal(g.turn,1);
  const h=game('reverse');E.act(h,0,{type:'play',cardId:c(0,4).id});assert.equal(E.act(h,0,{type:'special',specialId:'reverse'}),false);
});
test('全員交換は全員の選択まで非公開で待ち逆方向にも対応',()=>{
  const g=game('exchange_all');g.direction=-1;const initial=g.players.map(p=>p.hand[0]);use(g,'exchange_all');
  choose(g,0,initial[0].id);assert.ok(g.players[0].hand.includes(initial[0]));
  assert.equal(E.view(g,1).pending.responses,undefined);assert.equal(E.view(g,1).players[0].hand,undefined);
  choose(g,1,initial[1].id);choose(g,2,initial[2].id);
  assert.equal(g.pending,null);assert.ok(g.players[2].hand.includes(initial[0]));assert.ok(g.players[1].hand.includes(initial[2]));assert.ok(g.players[0].hand.includes(initial[1]));assert.equal(g.turn,0);
});
test('配置禁止は効果にも効き、所有者の次の手番開始時に解除',()=>{
  const g=game('block');use(g,'block',{suit:0});assert.equal(E.canPlay(g,c(0,6)),false);assert.equal(E.canPlay(g,c(0,1),true),false);
  E.act(g,0,{type:'pass'});assert.equal(g.blocks.length,1);E.act(g,1,{type:'pass'});E.act(g,2,{type:'pass'});assert.equal(g.turn,0);assert.equal(g.blocks.length,0);
});
test('パス回復は0回なら消費せず拒否、1回だけ減少',()=>{
  const g=game('recover'),before=JSON.stringify(g);assert.equal(E.act(g,0,{type:'special',specialId:'recover'}),false);assert.equal(JSON.stringify(g),before);
  g.players[0].passes=2;use(g,'recover');assert.equal(g.players[0].passes,1);
});
for(const id of ['inspect','clairvoyance'])test(`${id}の情報は使用者のみ。終了後は消える`,()=>{
  const g=game(id);use(g,id,{targetSeat:1});const mine=E.view(g,0),other=E.view(g,1);
  assert.equal(mine.choice.kind,'info');assert.equal(other.choice,null);assert.equal(JSON.stringify(other).includes('groups'),false);
  assert.equal(mine.choice.groups.length,id==='inspect'?1:2);
  assert.ok(mine.choice.groups.every(x=>x.cards.length===(id==='inspect'?g.players[x.seat].hand.length:2)));
  assert.equal(E.act(g,1,{type:'choice'}),false);choose(g,0);assert.equal(E.view(g,0).choice,null);
});
test('狡猾老獪は飛び越して置き、その後も通常配置できる。禁止は越せない',()=>{
  const g=game('cunning');g.blocks=[{suit:0,owner:2}];const before=JSON.stringify(g);
  assert.equal(E.act(g,0,{type:'special',specialId:'cunning',cardId:c(0,10).id}),false);assert.equal(JSON.stringify(g),before);
  g.blocks=[];use(g,'cunning',{cardId:c(0,10).id});assert.equal(g.board[0][9],true);assert.equal(g.turn,0);assert.equal(g.turnState.ordinary,0);
  E.act(g,0,{type:'play',cardId:c(0,6).id});assert.equal(g.turn,1);
});
test('混乱は次の手番に合法な1枚だけ強制配置。配置不能時は通常手番',()=>{
  const g=game('confuse');use(g,'confuse',{targetSeat:2});E.act(g,0,{type:'pass'});const before=g.players[2].hand.length;E.act(g,1,{type:'pass'});
  assert.equal(g.players[2].hand.length,before-1);assert.equal(g.players[2].confused,false);assert.equal(g.turn,0);
  const h=game('confuse');h.players[1].hand=[c(0,1)];use(h,'confuse',{targetSeat:1});E.act(h,0,{type:'pass'});assert.equal(h.turn,1);assert.equal(h.players[1].passes,0);assert.equal(h.players[1].confused,false);
});
test('リバースは進行方向を反転し通常配置後に逆側へ進む',()=>{
  const g=game('reverse');use(g,'reverse');assert.equal(g.direction,-1);E.act(g,0,{type:'play',cardId:c(0,4).id});assert.equal(g.turn,2);
});
test('交換留学は選択した1枚と相手のランダム1枚を交換し公開を解除',()=>{
  const g=game('exchange'),given=g.players[0].hand[0],received=g.players[1].hand[1];g.players[0].revealed=[given.id];g.players[1].revealed=[received.id];
  use(g,'exchange',{targetSeat:1,cardId:given.id});assert.ok(g.players[0].hand.includes(received));assert.ok(g.players[1].hand.includes(given));assert.deepEqual(g.players[0].revealed,[]);assert.deepEqual(g.players[1].revealed,[]);
});
test('強制登校は対象本人が選択し通常手番を消費しない。対象なしは省略',()=>{
  const g=game('force');use(g,'force',{targetSeat:2});assert.deepEqual(E.actorSeats(g),[2]);assert.equal(E.view(g,0).choice,null);
  assert.equal(E.act(g,0,{type:'choice',cardId:c(1,4).id}),false);choose(g,2,c(1,4).id);assert.equal(g.turn,0);assert.equal(g.turnState.ordinary,0);assert.equal(g.players[2].passes,0);
  const h=game('force');use(h,'force',{targetSeat:1});assert.equal(h.pending,null);assert.equal(h.players[1].passes,0);
});
test('連鎖出席は同じタイプ・隣り合う戦意の追加1枚だけ。任意終了も可能',()=>{
  const g=game('chain');use(g,'chain');E.act(g,0,{type:'play',cardId:c(0,6).id});assert.equal(g.turn,0);
  assert.equal(E.act(g,0,{type:'chain',cardId:c(0,4).id}),false);assert.equal(E.act(g,0,{type:'chain',cardId:c(0,7).id}),true);assert.equal(g.turn,1);
  const h=game('chain');use(h,'chain');E.act(h,0,{type:'play',cardId:c(0,6).id});E.act(h,0,{type:'end'});assert.equal(h.turn,1);assert.equal(h.players[0].passes,0);
});
test('公開授業は全員選択後に公開し本人の次の手番開始で解除',()=>{
  const g=game('reveal');use(g,'reveal');for(let seat=0;seat<3;seat++)choose(g,seat,g.players[seat].hand[0].id);
  assert.ok(E.view(g,1).players.every(p=>p.revealed.length===1));E.act(g,0,{type:'pass'});assert.equal(g.players[1].revealed.length,0);assert.equal(g.players[0].revealed.length,1);
});
test('手番指名は通常配置を終えてから指名先へ進み、その人を起点に継続',()=>{
  const g=game('nominate');use(g,'nominate',{targetSeat:2});E.act(g,0,{type:'play',cardId:c(0,4).id});assert.equal(g.turn,2);E.act(g,2,{type:'pass'});assert.equal(g.turn,0);
});
test('特別補講は合法カードがあると使えず、出せない場合だけパス免除',()=>{
  const g=game('supplement');assert.equal(E.act(g,0,{type:'special',specialId:'supplement'}),false);
  g.players[0].hand=[c(0,1),c(0,10)];use(g,'supplement');E.act(g,0,{type:'pass'});assert.equal(g.players[0].passes,0);assert.equal(g.turn,1);
});
test('一斉点呼はその時の順番・各処理時の合法判定。後の人が新しくつながる',()=>{
  const g=game('rollcall');g.players[1].hand=[c(0,3),c(0,8),c(0,9)];use(g,'rollcall');assert.deepEqual(E.actorSeats(g),[0]);
  assert.equal(E.view(g,2).choice,null);choose(g,0,c(0,4).id);assert.deepEqual(E.actorSeats(g),[1]);choose(g,1,c(0,3).id);choose(g,2,c(1,6).id);
  assert.equal(g.pending,null);assert.equal(g.turn,0);assert.equal(g.turnState.ordinary,0);assert.deepEqual(g.players.map(p=>p.passes),[0,0,0]);
});
test('自主休講は配置可能でもパスを増やさず終了',()=>{
  const g=game('rest');assert.ok(E.legal(g,0).length);const count=g.players[0].hand.length;use(g,'rest');assert.equal(g.turn,1);assert.equal(g.players[0].passes,0);assert.equal(g.players[0].hand.length,count);
});
test('専用が残っていても通常0枚であがる。不正対象は状態変更なし',()=>{
  const g=game('reverse');g.players[0].hand=[c(0,4)];E.act(g,0,{type:'play',cardId:c(0,4).id});assert.equal(g.players[0].rank,1);assert.equal(g.players[0].specials.length,1);
  const h=game('exchange');for(const a of [{type:'special',specialId:'exchange',targetSeat:0,cardId:0},{type:'special',specialId:'exchange',targetSeat:99,cardId:0},{type:'special',specialId:'exchange',targetSeat:1,cardId:999}]){const before=JSON.stringify(h);assert.equal(E.act(h,0,a),false);assert.equal(JSON.stringify(h),before);}
});
test('全員交換・一斉点呼の回答待ち中の切断でも続行できる',()=>{
  for(const id of ['exchange_all','reveal','rollcall','force','inspect']){
    const g=game(id);use(g,id,{targetSeat:2});E.forfeit(g,2);
    let n=0;while(g.pending&&!g.over&&n++<20){const seat=E.actorSeats(g)[0];assert.ok(E.act(g,seat,E.aiAction(g,seat)));}
    assert.equal(g.pending,null);assert.equal(g.turn,0);assert.equal(g.players[2].status,'eliminated');
  }
});
test('全18種類込みで2〜6人・500戦が停止せず終了し通常/専用の非公開を維持',()=>{
  for(let n=2;n<=6;n++)for(let run=0;run<100;run++){
    const g=E.create(Array.from({length:n},(_,i)=>`P${i}`));let count=0;
    while(!g.over&&count++<500){const seat=E.actorSeats(g)[0],a=E.aiAction(g,seat);assert.ok(a);assert.ok(E.act(g,seat,a));
      E.view(g,seat).players.forEach((p,i)=>{if(i!==seat){assert.equal(p.hand,undefined);assert.equal(p.specials,undefined);}});
    }
    assert.equal(g.over,true);assert.deepEqual(g.players.map(p=>p.rank).sort((a,b)=>a-b),Array.from({length:n},(_,i)=>i+1));
  }
});

test('実際の6接続でも情報確認は使用者だけ、全員交換は手番外の本人が選択できる',async t=>{
  const {WebSocketServer,WebSocket}=require('ws'),http=require('node:http');
  const {createNarabeRooms}=require('./narabe-rooms');
  const server=http.createServer(),wss=new WebSocketServer({server}),rooms=createNarabeRooms({random:()=>.4});
  wss.on('connection',ws=>rooms.connect(ws));await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const clients=[];t.after(async()=>{clients.forEach(c=>c.ws.terminate());rooms.close();await new Promise(r=>wss.close(r));await new Promise(r=>server.close(r));});
  const wait=async(c,predicate)=>{for(let n=0;n<300;n++){const m=c.messages.findLast(predicate);if(m)return m;await new Promise(r=>setTimeout(r,5));}throw Error('network timeout');};
  const send=(c,m)=>c.ws.send(JSON.stringify(m));
  for(let i=0;i<6;i++){
    const ws=new WebSocket(`ws://127.0.0.1:${server.address().port}`),cl={ws,messages:[]};clients.push(cl);ws.on('message',raw=>cl.messages.push(JSON.parse(raw)));
    await new Promise(r=>ws.once('open',r));send(cl,i?{type:'join',name:`P${i}`,code:(await wait(clients[0],m=>m.type==='state')).code}:{type:'create',name:'P0'});await wait(cl,m=>m.type==='state'&&m.people.length===i+1);
  }
  clients.forEach(cl=>send(cl,{type:'ready'}));await wait(clients[0],m=>m.people?.length===6&&m.people.every(p=>p.ready));send(clients[0],{type:'start',total:6});
  await wait(clients[0],m=>m.game);clients.forEach(cl=>send(cl,{type:'dealt'}));await wait(clients[0],m=>m.game&&!m.game.presenting);
  let revision=0;
  const action=async(seat,a)=>{if(a.type==='choice')a.requestId=clients[seat].messages.findLast(m=>m.game?.revision===revision).game.choice.requestId;send(clients[seat],{type:'action',revision,action:a});revision++;await Promise.all(clients.map(cl=>wait(cl,m=>m.game?.revision===revision)));};
  await action(5,{type:'special',specialId:'clairvoyance'});
  clients.forEach((cl,i)=>{
    const g=cl.messages.findLast(m=>m.game?.revision===revision).game;
    assert.equal(g.players.filter(p=>p.hand).length,1);assert.equal(g.players.filter(p=>p.specials).length,1);
    if(i===5){assert.equal(g.choice.groups.length,5);assert.ok(g.choice.groups.every(x=>x.cards.length===2));}else{assert.equal(g.choice,null);assert.equal(JSON.stringify(g.pending).includes('groups'),false);}
  });
  await action(5,{type:'choice'});await action(5,{type:'pass'}); // P0
  await action(0,{type:'pass'});await action(1,{type:'pass'}); // P2 has exchange_all
  await action(2,{type:'special',specialId:'exchange_all'});
  const original=clients.map(cl=>cl.messages.findLast(m=>m.game?.revision===revision).game.players[clients.indexOf(cl)].hand);
  const simultaneousRevision=revision;
  for(let seat=5;seat>=0;seat--){
    const own=clients[seat].messages.findLast(m=>m.game?.revision===revision).game;
    assert.equal(own.choice.kind,'exchange_all');send(clients[seat],{type:'action',revision:simultaneousRevision,action:{type:'choice',cardId:original[seat][0].id,requestId:own.choice.requestId}});
  }
  revision+=6;await Promise.all(clients.map(cl=>wait(cl,m=>m.game?.revision===revision)));
  clients.forEach((cl,i)=>{
    const g=cl.messages.findLast(m=>m.game?.revision===revision).game;
    assert.equal(g.pending,null);assert.equal(g.turn,2);assert.equal(g.players[i].hand.length,original[i].length);
    assert.ok(g.players[i].hand.some(c=>c.id===original[(i+5)%6][0].id));
  });
});
