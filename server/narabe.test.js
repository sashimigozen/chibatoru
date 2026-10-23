'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const E = require('./narabe-engine');
const { createNarabeRooms } = require('./narabe-rooms');
const { WebSocketServer, WebSocket } = require('ws');
const http = require('node:http');

test('配札演出は43枚を元の持ち主へ戻し、戦意5の5枚だけ公開して38枚の開始状態へ戻せる',()=>{
  for(let n=2;n<=6;n++)for(let run=0;run<20;run++){
    const g=E.create(Array.from({length:n},(_,i)=>`P${i}`)),saved=JSON.stringify(g);
    for(let seat=0;seat<n;seat++){
      const final=E.view(g,seat),initial=E.initialDealView(final,seat);
      assert.equal(final.startingCards.length,5);
      assert.ok(final.startingCards.every(x=>x.card.rank===5));
      assert.equal(initial.players.reduce((sum,p)=>sum+p.count,0),43);
      assert.deepEqual(initial.players.map(p=>p.count),Array.from({length:n},(_,i)=>Math.floor(43/n)+(i<43%n?1:0)));
      assert.equal(initial.board.flat().filter(Boolean).length,7);
      initial.players.forEach((p,i)=>assert.equal(Array.isArray(p.hand),i===seat));
      for(const {seat:owner,card}of final.startingCards){
        initial.players[owner].count--;initial.board[card.suit][card.rank-1]=true;
        if(owner===seat)initial.players[owner].hand=initial.players[owner].hand.filter(c=>c.id!==card.id);
      }
      assert.deepEqual(initial.players,final.players);assert.deepEqual(initial.board,final.board);
    }
    assert.equal(JSON.stringify(g),saved);
  }
});

test('固定43枚のうち戦意5を5枚公開、空席7マスを埋め、残り38枚で2〜6人全員の試合が終了する', () => {
  for (let n = 2; n <= 6; n++) for (let run = 0; run < 40; run++) {
    const g = E.create(Array.from({ length: n }, (_, i) => `P${i}`));
    const ids = g.players.flatMap(p => p.hand.map(c => c.id));
    assert.equal(ids.length,38);assert.equal(new Set(ids).size,38);
    assert.equal(g.board.length,5);g.board.forEach(row=>assert.equal(row.length,10));
    assert.equal(g.board.flat().filter(Boolean).length,12);
    assert.equal(E.cards.filter(c=>g.board[c.suit][c.rank-1]).length,5);
    assert.equal(g.players[g.turn].status,'playing');
    let turns = 0;
    while (!g.over && turns++ < 150) {
      const cards = E.legal(g, g.turn);
      assert.equal(E.act(g, g.turn, cards.length ? { type: 'play', cardId: cards[0].id } : { type: 'pass' }), true);
    }
    assert.equal(g.over, true); assert.deepEqual(g.players.map(p => p.rank).sort((a,b) => a-b), Array.from({ length: n }, (_, i) => i+1));
  }
});
test('隣接制限・戦意5からの飛び越し禁止・他人のカード・手番外の拒否', () => {
  const g = E.create(['A','B']);
  assert.equal(E.canPlay(g, { suit: 0, rank: 3 }), false);
  assert.equal(E.canPlay(g, { suit: 0, rank: 6 }), true);
  g.board[0][3] = true; assert.equal(E.canPlay(g, { suit: 0, rank: 3 }), true);
  assert.equal(E.canPlay(g, { suit: 0, rank: 2 }), false);
  const original = JSON.stringify(g);
  assert.equal(E.act(g, (g.turn + 1) % 2, { type: 'pass' }), false);
  assert.equal(E.act(g, g.turn, { type: 'play', cardId: -1 }), false);
  assert.equal(JSON.stringify(g), original);
});
test('空席は配られず、配置済みとして飛ばせるが、途中の実カードは飛ばせない',()=>{
  const g=E.create(['A','B']);
  // Teacher 6 is now real. Teacher 7 waits for it.
  assert.equal(g.board[1][5],false);assert.equal(E.cardAt(1,6).baseId,'kakiage_teacher');
  assert.equal(E.canPlay(g,{suit:1,rank:7}),false);
  assert.equal(E.canPlay(g,{suit:1,rank:8}),false);
  assert.equal(E.canPlay(g,{suit:1,rank:6}),true);
  // Vampire 6 and 9 are real too; environment 10 is absent.
  assert.equal(E.canPlay(g,{suit:2,rank:10}),false);
  g.board[2][6]=true;assert.equal(E.canPlay(g,{suit:2,rank:10}),false);
  g.board[2][7]=true;assert.equal(E.canPlay(g,{suit:2,rank:10}),false);
  g.board[2][5]=true;g.board[2][8]=true;assert.equal(E.canPlay(g,{suit:2,rank:10}),true);
  assert.equal(E.cardAt(4,10),undefined);assert.equal(g.board[4][9],true);
  assert.equal(E.cardAt(4,7).baseId,'full_lock');assert.equal(E.cardAt(4,8).baseId,'cote_dazur');
  g.board[4][5]=true;assert.equal(E.canPlay(g,{suit:4,rank:7}),true);
  assert.equal(E.canPlay(g,{suit:4,rank:8}),false);
  g.board[4][6]=true;assert.equal(E.canPlay(g,{suit:4,rank:8}),true);
  const before=JSON.stringify(g);g.turn=0;
  assert.equal(E.act(g,0,{type:'play',cardId:49}),false);
  assert.equal(JSON.stringify({...g,turn:JSON.parse(before).turn}),before);
});
test('採用43枚のID・名前・戦意・タイプ・能力値は通常版のカード定義と一致する',()=>{
  const fs=require('node:fs'),path=require('node:path');
  const source=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
  const begin=source.indexOf('const CARD_BASES = {'),end=source.indexOf('\n    };',begin);
  const lines=source.slice(begin,end).split('\n');
  assert.equal(E.cards.length,43);assert.equal(new Set(E.cards.map(c=>c.id)).size,43);
  const expected=[['aggro_student','general_student','yuta','elite_open_chatter','lone_wolf','seat_taking_group','spoon_wizard','loud_student','extra_people','infight_shogi'],['general_teacher','lightning_n','logic_hunter','kyoto_sound_i','thin_professor_h','ninety_three_teacher','president'],['zombie','cafeteria_lady','apprentice_vampire','chen_san','gigi_blood','vampire'],['ruler','environment_setup','onigiri_draw','thin_item','seriously_hit','abyss','greeting_3000','green_curry'],['classroom','cafeteria','gangi_fortress','academic_move','meguro_library','student_council','full_lock','chaos_world']];
  expected[1].push('kakiage_teacher');expected[2].push('jobs_woody','window_eater');expected[3].push('ittan');expected[4]=expected[4].filter(id=>id!=='chaos_world');expected[4].push('cote_dazur');
  E.types.forEach((_,suit)=>assert.deepEqual(E.cards.filter(c=>c.suit===suit).map(c=>c.baseId),expected[suit]));
  for(const card of E.cards){
    const line=lines.find(l=>l.trimStart().startsWith(card.baseId+': {'));
    assert.ok(line,card.baseId);
    const name=line.match(/name: ("(?:\\.|[^"\\])*")/);
    assert.equal(card.name,JSON.parse(name[1]));
    assert.equal(card.type,line.match(/type: "([^"]+)"/)[1]);
    assert.equal(card.cost,Number(line.match(/cost: (\d+)/)[1]));
    for(const key of ['attack','hp'])assert.equal(card[key],Number(line.match(new RegExp(key+': (\\d+)'))?.[1]||0));
    assert.equal(card.rank,card.cost);assert.equal(card.effect,undefined);
  }
});
test('パス3回は継続、4回目で脱落・公開・順位確定', () => {
  const g = E.create(['A','B','C']); const seat = g.turn;
  for (let i = 0; i < 3; i++) { g.turn = seat; E.act(g, seat, { type:'pass' }); assert.equal(g.players[seat].status,'playing'); }
  const cards = [...g.players[seat].hand]; g.turn = seat; E.act(g, seat, { type:'pass' });
  assert.equal(g.players[seat].rank, 3); assert.equal(g.players[seat].hand.length, 0);
  cards.forEach(c => assert.equal(g.board[c.suit][c.rank-1], true));
  assert.equal(g.over, false);
});
test('手番外の切断処理で現在の手番を奪わない。相手の手札を公開しない', () => {
  const g = E.create(['A','B','C']); const current = g.turn, other = (current+1)%3;
  E.forfeit(g, other); assert.equal(g.turn, current);
  const v = E.view(g,current); assert.ok(v.players[current].hand); assert.equal(v.players[(current+2)%3].hand, undefined);
});

test('実際の3接続：準備・開始権限・非公開手札・手番・古い操作・切断', async t => {
  const server = http.createServer(), wss = new WebSocketServer({ server }), rooms = createNarabeRooms({ cpuDelay: 5 });
  wss.on('connection', ws => rooms.connect(ws)); await new Promise(r => server.listen(0,'127.0.0.1',r));
  const clients = [];
  t.after(async () => { clients.forEach(c => c.ws.terminate()); rooms.close(); await new Promise(r => wss.close(r)); await new Promise(r => server.close(r)); });
  const connect = async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${server.address().port}`), messages = [];
    ws.on('message', raw => messages.push(JSON.parse(raw))); clients.push({ws,messages});
    await new Promise(r => ws.once('open',r)); return clients.at(-1);
  };
  const wait = async (c, predicate) => {
    for(let i=0;i<200;i++){ const found=c.messages.findLast(predicate); if(found)return found; await new Promise(r=>setTimeout(r,5)); } throw Error('応答タイムアウト');
  };
  const send = (c,m) => c.ws.send(JSON.stringify(m));
  const a = await connect(); send(a,{type:'create',name:'ホスト'}); const first = await wait(a,m=>m.type==='state');
  const b = await connect(), c = await connect();
  send(b,{type:'join',code:first.code,name:'ゲスト1'}); send(c,{type:'join',code:first.code,name:'ゲスト2'});
  await wait(a,m=>m.people?.length===3);
  send(b,{type:'start',total:3}); await new Promise(r=>setTimeout(r,25)); assert.equal(a.messages.some(m=>m.game), false);
  send(a,{type:'start',total:3}); await wait(a,m=>m.type==='error');
  for(const cl of clients)send(cl,{type:'ready'});
  await wait(a,m=>m.people?.length===3 && m.people.every(p=>p.ready)); send(a,{type:'start',total:3});
  const s = await wait(a,m=>m.game);
  for (const cl of clients) {
    const snap=await wait(cl,m=>m.game);snap.game.players.forEach((p,i)=>assert.equal(Array.isArray(p.hand),i===snap.seat));
    assert.equal(snap.game.startingCards.length,5);assert.ok(snap.game.startingCards.every(x=>x.card.rank===5));
    assert.equal(E.initialDealView(snap.game,snap.seat).players.reduce((sum,p)=>sum+p.count,0),43);
  }
  // No moves, including CPU moves, until every client finishes the shared deal animation.
  const earlyActor=clients[s.game.turn];send(earlyActor,{type:'action',revision:0,action:{type:'pass'}});
  await wait(earlyActor,m=>m.type==='error'&&m.message.includes('配札'));
  assert.equal(a.messages.filter(m=>m.game).at(-1).game.revision,0);
  clients.forEach(cl=>send(cl,{type:'dealt'}));
  await wait(a,m=>m.game&&!m.game.presenting);
  const active = clients[s.game.turn]; const snap=await wait(active,m=>m.game); const card=E.legal(snap.game,snap.seat)[0];
  const action = card?{type:'play',cardId:card.id}:{type:'pass'};
  send(active,{type:'action',revision:snap.game.revision,action}); await wait(a,m=>m.game?.revision===1);
  send(active,{type:'action',revision:0,action}); await new Promise(r=>setTimeout(r,25));
  assert.equal(a.messages.at(-1).game.revision,1);
  c.ws.close(); const after=await wait(a,m=>m.game?.players[2].status==='eliminated'); assert.equal(after.game.players[2].rank,3);
});

test('通常サーバーでも /narabe を独立した部屋へ振り分ける', async t => {
  const net = require('node:net'), { spawn } = require('node:child_process');
  const probe = net.createServer(); await new Promise(r => probe.listen(0,'127.0.0.1',r));
  const port = probe.address().port; await new Promise(r => probe.close(r));
  const child = spawn(process.execPath, ['server.js'], { cwd: __dirname, env: { ...process.env, PORT:String(port), CHIBATORU_D1_API_TOKEN:'' }, stdio:['ignore','pipe','pipe'] });
  t.after(()=>child.kill('SIGTERM'));
  await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(Error('server startup timeout')),5000);
    child.stdout.on('data', chunk=>{if(String(chunk).includes('listening')){clearTimeout(timer);resolve();}});
    child.on('exit',code=>{clearTimeout(timer);reject(Error(`server exited ${code}`));});
  });
  const ws=new WebSocket(`ws://127.0.0.1:${port}/narabe`); t.after(()=>ws.terminate());
  const room=await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(Error('namespace timeout')),2000);
    ws.on('message',raw=>{const m=JSON.parse(raw);if(m.type==='hello')ws.send(JSON.stringify({type:'create',name:'七並べ'}));if(m.type==='state'){clearTimeout(timer);resolve(m);}});
  });
  assert.equal(room.people[0].name,'七並べ');
  const health=await (await fetch(`http://127.0.0.1:${port}/health`)).json();
  assert.equal(health.rooms,0); // Narabe room never enters normal battle rooms.
});
