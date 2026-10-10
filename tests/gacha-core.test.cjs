const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const C = require('../gacha-core.js');
const fixed = n => () => n;
const rich = () => { const s = C.initial(); s.cp = 10000; return s; };
const complete = s => { s.pending = null; return s; };
test('Cynical UR correction preserves old ownership and pending results but new exchange uses Aggro Student', () => {
  const s=C.purchase(rich(),'cynical',1,()=>.99999,'old-results');
  s.pending.results[0][0]={baseId:'general_student',mode:'ultraRare'};
  s.owned.general_student={ultraRare:true};
  assert.equal(C.validate(s).owned.general_student.ultraRare,true);
  s.packs.cynical.total=200;s.packs.cynical.tickets=1;
  assert.throws(()=>C.exchange(s,'cynical','general_student'));
  C.exchange(s,'cynical','aggro_student');
  assert.equal(s.owned.aggro_student.ultraRare,true);
});
test('King Ghidorah clear records grant no CP and remove only unclaimed gifts', () => {
  const s=C.initial();s.cp=150;
  s.gifts['dungeon:king_ghidorah_bed:5']={amount:50,label:'old',claimed:false};
  s.gifts['dungeon:king_ghidorah_bed:10']={amount:100,label:'old',claimed:true};
  C.claim(s,'dungeon:king_ghidorah_bed:5');
  assert.equal(s.cp,150);
  C.migrate(s,[{id:'king_ghidorah_bed',name:'キングギドラベッド'}]);
  assert.equal(s.gifts['dungeon:king_ghidorah_bed:5'],undefined);
  assert.equal(s.gifts['dungeon:king_ghidorah_bed:10'].claimed,true);
  assert.equal(C.reward(s,{id:'dungeon:king_ghidorah_bed:5',amount:50}),false);
  assert.equal(s.cp,150);
  C.validate(s);
});
test('personal CP gift is file-triggered, additive, and received once', () => {
  const s = rich(), file = {format:'chibattle-personal-gift',version:1,id:'personal-cp:2026-10-10',amount:1000000};
  assert.equal(s.gifts[file.id], undefined);
  assert.equal(C.receivePersonalGift(s,file),true);
  assert.equal(s.cp,10000);
  C.claim(s,file.id);
  assert.equal(s.cp,1010000);
  assert.equal(C.receivePersonalGift(s,file),false);
  C.claim(s,file.id);
  assert.equal(C.validate(s).cp,1010000);
  assert.throws(()=>C.receivePersonalGift(s,{...file,amount:2000000}));
});
test('official pools are 255 unique existing cards, 24 specified URs; tokens excluded', () => {
  const pool=C.PACKS.find(p=>p.id==='cynical');
  assert.ok(pool.ur.includes('aggro_student'));
  assert.ok(!pool.ur.includes('general_student'));
  assert.ok(pool.cards.includes('general_student'));
  const source = fs.readFileSync(require.resolve('../index.html'), 'utf8');
  const start = source.indexOf('const CARD_BASES =');
  const end = source.indexOf('\n    };', start) + 7;
  const bases = vm.runInNewContext(source.slice(start, end) + ';CARD_BASES');
  assert.equal(new Set(C.PACKS.flatMap(p => p.cards)).size, 255);
  assert.equal(C.PACKS.flatMap(p => p.ur).length, 24);
  C.PACKS.forEach(p => {
    assert.equal(p.cards.length, p.count);
    p.cards.forEach(id => assert.ok(bases[id] && !bases[id].token && !bases[id].generated, id));
    p.ur.forEach(id => assert.ok(p.cards.includes(id)));
  });
});
test('integer probability boundaries including tiny UR interval', () => {
  C.WEIGHTS.forEach(weights => {
    assert.equal(weights.reduce((a,b) => a+b), 100000);
    let start = 0;
    weights.forEach((weight, i) => {
      assert.equal(C.sample(weights, fixed(start / 100000)), i);
      assert.equal(C.sample(weights, fixed((start + weight - .5) / 100000)), i);
      start += weight;
    });
  });
});
test('5/50 cards, CP deduction, no automatic tier unlock, duplicates no refund', () => {
  const a = C.purchase(rich(), 'cynical', 1, fixed(.99999), 'one');
  assert.equal(a.cp, 9995); assert.equal(a.pending.results.flat().length, 5);
  assert.deepEqual(Object.values(a.owned), [{ ultraRare: true }]);
  const b = C.purchase(complete(a), 'cynical', 10, fixed(.99999), 'ten');
  assert.equal(b.cp, 9945); assert.equal(b.pending.results.flat().length, 50);
  assert.deepEqual(Object.values(b.owned), [{ ultraRare: true }]);
  assert.throws(() => C.purchase(C.initial(), 'cynical', 1, fixed(0), 'poor'));
  assert.throws(() => C.purchase(b, 'cynical', 1, fixed(0), 'double'));
});
test('9 misses then tenth fifth slot guarantee, single and batch same sequence', () => {
  let singles = rich();
  for (let i = 0; i < 10; i++) singles = complete(C.purchase(singles, 'endless', 1, fixed(0), `p${i}`));
  const batch = C.purchase(rich(), 'endless', 10, fixed(0), 'batch');
  assert.equal(batch.pending.results[9][4].mode, 'superRare');
  assert.deepEqual(singles.packs, batch.packs); assert.deepEqual(singles.owned, batch.owned);
  assert.equal(batch.packs.endless.miss, 0); assert.equal(batch.packs.echoes.miss, 0);
  const s = rich(); s.packs.cynical.miss = 9;
  let n = 0;
  const naturalSR = () => ++n === 1 ? .96 : 0;
  const a = C.purchase(s, 'cynical', 1, naturalSR, 'natural');
  assert.equal(a.pending.results[0][0].mode, 'superRare');
  assert.equal(a.pending.results[0][4].mode, 'normal');
  assert.equal(a.packs.cynical.miss, 0);
});
test('199/399 threshold grants mandatory ticket, normal UR never resets it', () => {
  for (const total of [199,399]) {
    const s = rich(); s.packs.awakening.total = total;
    const bought = C.purchase(s, 'awakening', 1, fixed(.99999), 'threshold');
    assert.equal(bought.packs.awakening.total, total + 1);
    assert.equal(bought.packs.awakening.tickets, 1);
    complete(bought);
    assert.throws(() => C.purchase(bought, 'echoes', 1, fixed(0), 'blocked'));
    assert.throws(() => C.exchange(bought, 'awakening', 'general_student'));
    C.exchange(bought, 'awakening', 'gigi_blood');
    assert.equal(bought.packs.awakening.tickets, 0);
    assert.throws(() => C.exchange(bought, 'awakening', 'gigi_blood'));
  }
});
test('initial gift migrates existing saves without changing balance or duplicating after claim', () => {
  const s = C.initial(); s.cp = 17;
  C.migrate(s, []); C.migrate(s, []);
  assert.equal(s.cp, 17); assert.equal(s.gifts['initial-cp'].amount, 50);
  C.validate(s); C.claim(s, 'initial-cp'); C.migrate(s, []); C.claim(s, 'initial-cp');
  assert.equal(s.cp, 67); assert.equal(s.gifts['initial-cp'].claimed, true);
  assert.throws(() => C.validate({...s,gifts:{'initial-cp':{amount:100,label:'invalid',claimed:false}}}));
});
test('migration independent specialty gifts and repeat claims never duplicate CP', () => {
  const s = C.initial(), specialties = [{id:'information',name:'情報'},{id:'math',name:'数学'}];
  C.migrate(s, specialties); C.migrate(s, specialties); assert.equal(Object.keys(s.gifts).length,5);
  C.claim(s,'dungeon:math:5'); assert.equal(s.cp,50);
  C.claim(s); C.claim(s); C.migrate(s, specialties); C.claim(s); assert.equal(s.cp,350);
  assert.equal(C.reward(s,{id:'dungeon:math:10',amount:100}),false);
  C.reward(s,{id:'ai:unique',amount:5}); C.reward(s,{id:'ai:unique',amount:5}); assert.equal(s.cp,355);
});
function memory() {
  const map = new Map(); return {getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,v),removeItem:k=>map.delete(k)};
}
test('two tabs serialized, save failure leaves CP/results/unlocks unchanged', async () => {
  const storage = memory(); storage.setItem(C.KEY,JSON.stringify({...C.initial(),cp:5}));
  let queue = Promise.resolve(); const lock = (_,fn) => { const result = queue.then(fn); queue = result.catch(()=>{}); return result; };
  const a = new C.Store(storage,lock,fixed(0)), b = new C.Store(storage,lock,fixed(0));
  const result = await Promise.allSettled([a.buy('cynical',1,'a'),b.buy('cynical',1,'b')]);
  assert.equal(result.filter(r=>r.status==='fulfilled').length,1); assert.equal(a.read().cp,0);
  const original = storage.getItem(C.KEY); storage.setItem = () => { throw new Error('quota'); };
  await assert.rejects(a.transact(s=>C.claim(s))); assert.equal(storage.getItem(C.KEY),original);
});
test('restore replaces CP and interrupted projections replay idempotently', async () => {
  const storage=memory(), store=new C.Store(storage,(_,fn)=>fn());
  const s=rich(); s.cp=77;
  const projection=Object.fromEntries(C.BACKUP_KEYS.map(k=>[k,null]));
  projection['chibattle-player-profile-v1']='{"username":"test"}';
  await store.restore(s,projection);
  await assert.rejects(store.buy('cynical',1,'blocked'));
  C.recover(storage); C.recover(storage); assert.equal(store.read().cp,77);
  await store.restore(s,projection); C.recover(storage); assert.equal(store.read().cp,77);
  assert.throws(()=>C.validate({...C.initial(),cp:-1}));
  assert.throws(()=>C.validate({...C.initial(),owned:[]}));
  assert.throws(()=>C.validateProjection({'unrelated-key':'{}'}));
});
test('guaranteed SR/UR split keeps the 1% UR boundary and batch crosses threshold once',()=>{
  const s=rich();s.packs.echoes.miss=9;s.packs.echoes.total=199;
  let calls=0;const rng=()=> ++calls===11 ? .99 : 0;
  const result=C.purchase(s,'echoes',10,rng,'crossing');
  assert.equal(result.pending.results[0][4].mode,'ultraRare');
  assert.equal(result.packs.echoes.total,209);assert.equal(result.packs.echoes.tickets,1);
});
