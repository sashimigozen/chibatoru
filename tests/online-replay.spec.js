const { test, expect } = require('@playwright/test');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const url = pathToFileURL(path.join(__dirname, '..', 'index.html')).href;

test('host records private replay separately; offline/CPU/guest never uploads it', async ({ page }) => {
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(url);
  const result = await page.evaluate(() => {
    const s = __chibattle.state, sent = [];
    s.online.role = 'host'; s.online.connected = true; s.online.started = false; s.online.startPending = true;
    s.online.conn = { send: message => { sent.push(message); return true; } };
    s.aiBattle.active = false; s.training.active = false; s.dungeon.active = false; s.testMode = false;
    analyticsStartGame();
    const mode = s.analytics.game.mode;
    s.online.started = true; s.online.startPending = false;
    s.players.player.hand = [__chibattle.createCardFromBase('general_student', 'player')];
    const random = battleRandom(), coin = rollCoinFace();
    onlineSubmitAnalyticsLog('test');
    const privateMessages = sent.filter(m => m.type === 'analyticsLog');
    const shared = __chibattle.onlineCreateSnapshot();
    const count = sent.length;
    for (const mode of ['aiBattle', 'training', 'dungeon']) {
      s[mode].active = true; onlineSubmitAnalyticsLog('excluded'); s[mode].active = false;
    }
    s.online.role = 'guest'; onlineSubmitAnalyticsLog('excluded');
    s.online.role = 'host'; s.online.started = false; s.online.startPending = false;
    onlineSubmitAnalyticsLog('excluded');
    const trace = { entries: privateMessages.flatMap(m => m.trace.entries) };
    return { mode, random, coin, trace, restoredHand: ChibattleOnlineReplay.restore(trace).players.player.hand,
      sharedHasTrace: JSON.stringify(shared).includes('"kind":"checkpoint"'),
      excludedUploads: sent.length - count };
  });
  expect(result.mode).toBe('online');
  expect(result.trace.entries.some(e => e.kind === 'random' && e.data.value === result.random)).toBe(true);
  expect(result.trace.entries.some(e => e.kind === 'coin' && e.data.face === result.coin)).toBe(true);
  expect(result.restoredHand).toHaveLength(1);
  expect(result.sharedHasTrace).toBe(false);
  expect(result.excludedUploads).toBe(0);
  expect(errors).toEqual([]);
});

 test('delta uploads stay bounded, preserve retries, and snapshots keep the complete guest event history', async ({page})=>{
  await page.goto(url);
  const result=await page.evaluate(()=>{
    const s=__chibattle.state,sent=[];
    s.online.role='host';s.online.connected=true;s.online.started=true;s.online.logDeltaSupported=true;
    s.online.conn={send:m=>{sent.push(JSON.parse(JSON.stringify(m)));return true;}};
    s.aiBattle.active=false;s.training.active=false;s.dungeon.active=false;s.testMode=false;
    analyticsStartGame();
    for(let i=0;i<5000;i++) analyticsPushEvent('effect',{details:{n:i}});
    onlineSubmitAnalyticsLog('test');
    const uploads=sent.filter(m=>m.type==='analyticsLog');
    const total=uploads.flatMap(m=>m.events).length;
    const firstPending=JSON.stringify(Object.values(s.online.pendingMessages).find(p=>p.message.type==='analyticsLog').message);
    const size=Math.max(...uploads.map(m=>new TextEncoder().encode(JSON.stringify(m)).length));
    const snapshot=__chibattle.onlineCreateSnapshot();
    const id=onlineNextMessageId(); onlineSend({type:'gameState',msgId:id,snapshot},{track:true});
    onlineHandleAck(id);
    const next=__chibattle.onlineCreateSnapshot();
    s.analytics.game.firstSide='opponent';
    analyticsPushEvent('effect',{details:{n:5001}});onlineSubmitAnalyticsLog('test');
    const last=sent.filter(m=>m.type==='analyticsLog').at(-1);
    return {total,size,nextEvents:next.state.analytics.events.length,offset:next.state.analytics.eventOffset,lastEvents:last.events.length,
      retryStable:firstPending===JSON.stringify(Object.values(s.online.pendingMessages).find(p=>p.message.type==='analyticsLog').message)};
  });
  expect(result.total).toBe(5001);expect(result.size).toBeLessThan(140000);
  expect(result.nextEvents).toBe(0);expect(result.offset).toBe(5001);
  expect(result.lastEvents).toBe(1);expect(result.retryStable).toBe(true);
 });

 test('guest snapshots append events without losing the previous turns; log rendering reuses existing lines', async({page})=>{
  await page.goto(url);
  const result=await page.evaluate(()=>{
    const s=__chibattle.state;
    s.online.role='host';s.online.connected=true;s.online.started=true;s.online.logDeltaSupported=true;
    s.online.conn={send:()=>true};s.aiBattle.active=false;s.training.active=false;s.dungeon.active=false;s.testMode=false;
    analyticsStartGame();
    const first=__chibattle.onlineCreateSnapshot();
    const id=onlineNextMessageId();onlineSend({type:'gameState',msgId:id,snapshot:first},{track:true});onlineHandleAck(id);
    analyticsPushEvent('action',{side:'player',cardName:'一般学生',actionType:'play_card'});
    const next=__chibattle.onlineCreateSnapshot();
    s.online.role='guest';s.online.lastSnapshotSeq=0;s.analytics=createAnalyticsState();
    onlineApplySnapshot(first);onlineApplySnapshot(next);
    const count=s.analytics.events.length,side=s.analytics.events.at(-1).side;
    s.log=['相手が一般学生を出席'];renderLog();const line=document.querySelector('#log li');
    renderLog();const unchanged=line===document.querySelector('#log li');
    s.log.unshift('あなたがターン終了');renderLog();
    return{count,side,unchanged,kept:line===document.querySelector('#log li'),lines:document.querySelectorAll('#log li').length};
  });
  expect(result).toEqual({count:2,side:'player',unchanged:true,kept:true,lines:2});
 });
