const { test, expect } = require('@playwright/test');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const url = pathToFileURL(path.join(__dirname, '..', 'index.html')).href;

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 }); await page.goto(url);
  await page.evaluate(() => {
    startCardTest('corridor_student'); scheduleOpponentAI = () => {}; state.environment = null; state.training.skipAnimations = true;
    for (const side of ['player', 'opponent']) Object.assign(state.players[side], {
      board: { teacher: null, seats: Array(9).fill(null) }, hand: [], deck: [], trash: [], late: [], will: 10, life: 20
    });
    render();
  });
  await expect.poll(() => page.evaluate(() => battlePresentationBusy())).toBe(false);
});

for (const side of ['player', 'opponent']) test(`${side}: 情報はデッキだけ・手札だけの素材をコピーし、元と負荷は引き継がない`, async ({ page }) => {
  const results = await page.evaluate(side => {
    return ['deck', 'hand'].map(zone => {
      const p = state.players[side]; p.hand = []; p.deck = [];
      const material = Object.assign(createCardFromBase('fusion_bone', side), { handLoadLevel: 2 });
      p[zone] = [material];
      resolveHorseAttendance(side, createCardFromBase('information_tired_student', side));
      const copy = p.hand.at(-1);
      return [p[zone].some(card => card.instanceId === material.instanceId), copy.baseId,
        copy.instanceId !== material.instanceId, copy.handLoadLevel || 0, p.hand.length];
    });
  }, side);
  expect(results).toEqual([[true, 'fusion_bone', true, 0, 1], [true, 'fusion_bone', true, 0, 2]]);
});

test('通路はデッキと手札の異名を自動生成し、元を残して同名は重複しない', async ({ page }) => {
  const originals = await page.evaluate(() => {
    state.players.player.deck = ['fusion_uma', 'fusion_uma'].map(id => createCardFromBase(id, 'player'));
    state.players.player.hand = ['fusion_uma', 'fusion_bone'].map(id => createCardFromBase(id, 'player'));
    const originals = [state.players.player.deck.map(card => card.instanceId), state.players.player.hand.map(card => card.instanceId)];
    resolveHorseAttendance('player', createCardFromBase('corridor_student', 'player')); return originals;
  });
  await expect.poll(() => page.evaluate(() => fusionTasksBusy())).toBe(false);
  expect(await page.evaluate(() => Boolean(state.pendingCardChoice))).toBe(false);
  expect(await page.evaluate(() => [state.players.player.deck.map(card => card.instanceId), state.players.player.hand.slice(0, 2).map(card => card.instanceId)])).toEqual(originals);
  expect(await page.evaluate(() => state.players.player.hand.slice(2).map(card => card.baseId).sort())).toEqual(['fusion_bone', 'fusion_uma']);
});

test('CPUの通路も手札だけの素材を生成できる', async ({ page }) => {
  expect(await page.evaluate(async () => {
    isCpuControlledBattleSide = () => true;
    state.players.opponent.hand = ['fusion_uma', 'fusion_bone'].map(id => createCardFromBase(id, 'opponent'));
    resolveHorseAttendance('opponent', createCardFromBase('corridor_student', 'opponent')); await fusionEffectTail;
    return state.players.opponent.hand.map(card => card.baseId).sort();
  })).toEqual(['fusion_bone', 'fusion_bone', 'fusion_uma', 'fusion_uma']);
});

for (const side of ['player','opponent']) test(`${side}: 通路は乱数で異なる2種類を抽選し、対象0〜1種類も選択待ちなく完了する`, async ({page}) => {
  const result=await page.evaluate(async side=>{
    const p=state.players[side], source=createCardFromBase('corridor_student',side);
    const outcomes=[]; const random=Math.random;
    try {
      for(const value of [0,.999999]) {
        p.deck=HORSE_MATERIAL_IDS.map(id=>createCardFromBase(id,side)); p.hand=[];
        Math.random=()=>value;
        resolveHorseAttendance(side,source); await fusionEffectTail;
        outcomes.push(p.hand.map(c=>c.baseId).sort());
      }
      p.deck=[]; p.hand=[];
      resolveHorseAttendance(side,source); await fusionEffectTail;
      const zero=p.hand.length;
      p.deck=[createCardFromBase('fusion_where',side)]; p.hand=[createCardFromBase('fusion_where',side)];
      resolveHorseAttendance(side,source); await fusionEffectTail;
      return {outcomes,zero,one:p.hand.map(c=>c.baseId),pending:!!state.pendingCardChoice,
        stats:[source.cost,source.attack,source.hp]};
    } finally {Math.random=random;}
  },side);
  for(const ids of result.outcomes){expect(ids).toHaveLength(2);expect(new Set(ids).size).toBe(2);}
  expect(result.outcomes[0]).not.toEqual(result.outcomes[1]);
  expect(result.zero).toBe(0); expect(result.one).toEqual(['fusion_where','fusion_where']);
  expect(result.pending).toBe(false);expect(result.stats).toEqual([3,2,2]);
});

test('オンラインホストが通路の抽選を解決し、ゲストへ結果を同期して選択要求は送らない', async ({page})=>{
  const result=await page.evaluate(async()=>{
    Object.assign(state.online,{role:'host',started:true,connected:true,conn:{}});
    window.requests=[];onlineSend=message=>{requests.push(message);return true;};
    state.players.opponent.deck=HORSE_MATERIAL_IDS.map(id=>createCardFromBase(id,'opponent'));
    resolveHorseAttendance('opponent',createCardFromBase('corridor_student','opponent'));await fusionEffectTail;
    const guest=onlineTransformSnapshotForGuest(onlineCreateSnapshot().state);
    return {host:state.players.opponent.hand.map(c=>c.baseId),guest:guest.players.player.hand.map(c=>c.baseId),
      choiceRequests:requests.filter(m=>m.privateChoiceKind==='fusion_effect_choice').length,
      pending:!!state.pendingCardChoice,remote:!!state.pendingRemoteHandTrim};
  });
  expect(result.host).toHaveLength(2);expect(new Set(result.host).size).toBe(2);
  expect(result.guest).toEqual(result.host);expect(result.choiceRequests).toBe(0);
  expect(result.pending).toBe(false);expect(result.remote).toBe(false);
});

test('通路のランダム生成の表示本文と更新情報が一致する',async({page})=>{
  const result=await page.evaluate(()=>{
    const card=createCardFromBase('corridor_student','player');
    return {text:cardRulesText(card),update:UPDATE_HISTORY[0].changes.find(c=>c.title===card.name).after};
  });
  expect(result.text).toBe('このカードを手札から出席させたとき、自分のデッキと手札にある「ウマ」「マイボ」「骨」「どこ」の中から、名前の異なるカードをランダムに2枚選び、それぞれを1枚ずつ手札に生成する。');
  expect(result.update).toBe(`学生／学友会・持ち物／戦意3／攻撃力2／体力2\n${result.text}`);
});

test('オンラインの遠くからのゲスト選択へ両方の素材だけを送り、手札とデッキを消費せず生成する', async ({ page }) => {
  await page.evaluate(() => {
    Object.assign(state.online, { role: 'host', started: true, connected: true, conn: {} });
    onlineSend = message => { if (message.privateChoiceKind === 'fusion_effect_choice') window.request = message; return true; };
    state.players.opponent.deck = [createCardFromBase('fusion_uma', 'opponent')];
    state.players.opponent.hand = ['fusion_bone', 'general_student'].map(id => createCardFromBase(id, 'opponent'));
    resolveHorseAttendance('opponent', createCardFromBase('remote_participant_student', 'opponent'));
  });
  await expect.poll(() => page.evaluate(() => window.request?.cards.map(card => card.baseId))).toEqual(['fusion_uma', 'fusion_bone']);
  await page.evaluate(() => onlineHandleMessage({ type: 'thinItemChoiceResponse', protocol: ONLINE_PROTOCOL_VERSION,
    privateChoiceKind: 'fusion_effect_choice', requestId: request.requestId, selectedIds: request.cards.map(card => card.instanceId) }));
  await expect.poll(() => page.evaluate(() => fusionTasksBusy())).toBe(false);
  expect(await page.evaluate(() => [state.players.opponent.deck.length, state.players.opponent.hand.map(card => card.baseId)]))
    .toEqual([1, ['fusion_bone', 'general_student', 'fusion_uma', 'fusion_bone']]);
});
