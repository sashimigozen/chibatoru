'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const http=require('node:http'),{WebSocket,WebSocketServer}=require('ws');
const {createNarabeRooms}=require('./narabe-rooms');

test('部屋一覧は公開情報だけを同期し、4〜6席の増減・満員・開始・退室に追従する',async t=>{
  const server=http.createServer(),wss=new WebSocketServer({server}),rooms=createNarabeRooms({cpuDelay:100000}),clients=[];
  wss.on('connection',ws=>rooms.connect(ws));await new Promise(r=>server.listen(0,'127.0.0.1',r));
  t.after(async()=>{clients.forEach(c=>c.ws.terminate());rooms.close();await new Promise(r=>wss.close(r));await new Promise(r=>server.close(r));});
  const connect=async()=>{const ws=new WebSocket(`ws://127.0.0.1:${server.address().port}`),c={ws,messages:[]};clients.push(c);ws.on('message',raw=>c.messages.push(JSON.parse(raw)));await new Promise(r=>ws.once('open',r));return c;};
  const send=(c,m)=>c.ws.send(JSON.stringify(m));
  const wait=async(c,p,after=0)=>{for(let n=0;n<200;n++){const m=c.messages.slice(after).findLast(p);if(m)return m;await new Promise(r=>setTimeout(r,5));}throw Error('response timeout');};
  const watcher=await connect();send(watcher,{type:'list'});assert.deepEqual((await wait(watcher,m=>m.type==='rooms')).rooms,[]);
  const host=await connect();send(host,{type:'create',name:'一覧ホスト',total:2});const first=await wait(host,m=>m.type==='state');assert.equal(first.total,4);
  const listing=await wait(watcher,m=>m.rooms?.length===1);assert.deepEqual(listing.rooms[0],{code:first.code,name:'一覧ホストの部屋',count:1,total:4});
  send(host,{type:'seats',total:5});await wait(watcher,m=>m.rooms?.[0]?.total===5);
  let mark=watcher.messages.length;send(host,{type:'seats',total:4});await wait(watcher,m=>m.rooms?.[0]?.total===4,mark);
  for(const total of [2,3,7]){const start=host.messages.length;send(host,{type:'seats',total});await wait(host,m=>m.type==='error',start);}
  const people=[host];
  for(let i=1;i<4;i++){const c=await connect();send(c,{type:'join',code:first.code,name:`参加者${i}`});await wait(c,m=>m.type==='state');people.push(c);}
  await wait(watcher,m=>m.rooms?.[0]?.count===4);
  const extra=await connect();send(extra,{type:'join',code:first.code,name:'追加'});await wait(extra,m=>m.type==='error');
  send(host,{type:'seats',total:5});await wait(host,m=>m.total===5&&m.people?.length===4);
  send(extra,{type:'join',code:first.code,name:'追加'});await wait(extra,m=>m.type==='state');
  mark=host.messages.length;send(host,{type:'seats',total:4});await wait(host,m=>m.type==='error',mark);
  mark=host.messages.length;extra.ws.close();await wait(host,m=>m.people?.length===4&&m.total===5,mark);
  mark=watcher.messages.length;send(host,{type:'seats',total:4});await wait(watcher,m=>m.rooms?.[0]?.total===4&&m.rooms[0].count===4,mark);
  for(const c of people)send(c,{type:'ready'});await wait(host,m=>m.people?.length===4&&m.people.every(p=>p.ready));
  mark=watcher.messages.length;send(host,{type:'start',total:4});const started=await wait(host,m=>m.game);assert.equal(started.game.players.length,4);await wait(watcher,m=>m.rooms?.length===0,mark);
  const lone=await connect();send(lone,{type:'create',name:'CPU補充',total:4});await wait(lone,m=>m.type==='state');send(lone,{type:'ready'});await wait(lone,m=>m.people?.[0]?.ready);
  send(lone,{type:'start',total:3});await wait(lone,m=>m.type==='error');send(lone,{type:'start',total:4});const cpu=await wait(lone,m=>m.game);assert.equal(cpu.game.players.length,4);assert.equal(cpu.game.players.filter(p=>/^CPU \d+$/.test(p.name)).length,3);
  const disposable=await connect();send(disposable,{type:'create',name:'退室確認'});const room=await wait(disposable,m=>m.type==='state');await wait(watcher,m=>m.rooms?.some(r=>r.code===room.code));
  mark=watcher.messages.length;disposable.ws.close();await wait(watcher,m=>m.type==='rooms'&&!m.rooms.some(r=>r.code===room.code),mark);
  assert.ok(watcher.messages.filter(m=>m.type==='rooms').every(m=>!JSON.stringify(m).includes('hand')));
});
