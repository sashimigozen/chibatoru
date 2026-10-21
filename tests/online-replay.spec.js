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
