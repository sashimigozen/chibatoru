const { test, expect } = require('@playwright/test');
const { spawn } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const catalog = require('../server/card-catalog.json');
const port = 18827;
const game = pathToFileURL(path.join(__dirname, '..', 'index.html'));
game.searchParams.set('ws', 'ws://127.0.0.1:' + port);
let server;
test.beforeAll(async () => {
  server = spawn(process.execPath, [path.join(__dirname, '..', 'server/server.js')], {
    env: { ...process.env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe']
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('server startup timeout')), 5000);
    server.stdout.on('data', data => { if (String(data).includes('listening')) { clearTimeout(timer); resolve(); } });
    server.once('error', reject);
  });
});
test.afterAll(() => server?.kill());

test('対戦サーバーのカード一覧・専攻・枚数制限は通常版と一致する', async ({ page }) => {
  await page.goto(game.href);
  expect(await page.evaluate(() => ({
    specialties: Object.fromEntries(Object.entries(SPECIALTY_CARD_IDS).map(([key, ids])=>[key,[...ids].sort()])), direct: [...DIRECT_DECK_CARD_IDS].sort(),
    aces: [...ACE_CARD_IDS].sort(), copyLimits: CARD_COPY_LIMITS
  }))).toEqual({
    specialties: Object.fromEntries(Object.entries(catalog.specialties).map(([key, ids])=>[key,[...ids].sort()])),
    direct: [...catalog.direct].sort(), aces: [...catalog.aces].sort(), copyLimits: catalog.copyLimits
  });
});

test('初期の使用不可デッキは有効な保存デッキを選択し、元の編成は変えない', async ({ page }) => {
  await page.goto(game.href);
  const before = await page.evaluate(() => JSON.stringify(state.deckBuilder.counts.player));
  expect(await page.evaluate(() => onlineLocalDeckValidation().valid)).toBe(false);
  await page.locator('#homeNavBattleButton').click();
  expect(await page.evaluate(() => onlineLocalDeckValidation().valid)).toBe(true);
  expect(await page.evaluate(() => JSON.stringify(state.deckBuilder.counts.player))).toBe(before);
  expect(await page.evaluate(() => onlineLocalDeckDescriptor().kind)).toBe('saved');
});

test('明示した保存デッキは勝手に変更せず、使用不可の理由をランダム準備画面にも表示する', async ({ page }) => {
  await page.goto(game.href);
  await page.evaluate(() => {
    state.deckBuilder.savedDecks['確認用'] = { counts: { general_student: 1 } };
    state.online.localDeckName = onlineDeckDescriptorValue({ format: 'normal', kind: 'saved', name: '確認用' });
    showOnlineScreen();
    state.online.matchMode = 'random'; state.online.lobbyView = 'private';
    state.online.role = 'host'; state.online.connected = true; render();
  });
  await expect(page.locator('#onlineRandomReadyButton')).toBeDisabled();
  await expect(page.locator('#onlineRandomStatusText')).toContainText('40〜60枚');
  expect(await page.evaluate(() => onlineLocalDeckDescriptor().name)).toBe('確認用');
});

test('新しい融合素材・出席者を含むデッキでも双方が準備OKから対戦開始できる', async ({ browser }) => {
  const contexts = [], pages = [];
  try {
    for (let i = 0; i < 2; i++) {
      const context = await browser.newContext(); contexts.push(context);
      const page = await context.newPage(); pages.push(page);
      await page.goto(game.href); await page.locator('#homeNavBattleButton').click();
      await page.locator('#onlinePrivateMatchButton').click();
    }
    const [host, guest] = pages;
    await host.locator('#onlineCreateRoomButton').click();
    await expect.poll(() => host.evaluate(() => state.online.lastSeenAt)).toBeGreaterThan(0);
    await guest.locator('#onlineRoomInput').fill(await host.evaluate(() => state.online.roomCode));
    await guest.locator('#onlineJoinRoomButton').click();
    for (const page of pages) {
      await expect.poll(() => page.evaluate(() => state.online.connected)).toBe(true);
      await page.evaluate(() => {
        const counts = createAutoDeckCounts();
        delete counts.general_student;
        delete counts.aggro_student;
        delete counts.aggro_king;
        counts.fusion_uma = 1; counts.fusion_maibo = 1; counts.corridor_student = 1;
        state.deckBuilder.savedDecks['融合テスト'] = { counts };
        state.online.localDeckName = onlineDeckDescriptorValue({ format: 'normal', kind: 'saved', name: '融合テスト' });
        render(); onlineUpdateDeckSelection();
      });
      await expect(page.locator('#onlineReadyButton')).toBeEnabled();
      await page.locator('#onlineReadyButton').click();
      await expect.poll(() => page.evaluate(() => state.online.localReady)).toBe(true);
    }
    await expect(host.locator('#onlineStartButton')).toBeEnabled();
    await host.locator('#onlineStartButton').click();
    await expect(host.locator('#coinControls')).toBeVisible();
    await expect.poll(() => guest.evaluate(() => state.phase)).toBe('coinToss');
    for (const page of pages) expect(await page.evaluate(() => Boolean(window.__newRules))).toBe(false);
    expect(await host.evaluate(() => state.online.logDeltaSupported)).toBe(true);
    await host.evaluate(() => { analyticsPushEvent('effect',{details:{marker:'delta-history-test'}}); onlineBroadcastState(true); });
    await expect.poll(()=>guest.evaluate(()=>state.analytics.events.some(event=>event.details?.marker==='delta-history-test'))).toBe(true);
    await expect.poll(()=>host.evaluate(()=>onlineSnapshotEventAck)).toBeGreaterThan(0);
    expect(await host.evaluate(()=>onlineCreateSnapshot().state.analytics.events.length)).toBe(0);
    await host.evaluate(() => { analyticsPushEvent('effect',{details:{marker:'second-delta-test'}}); onlineBroadcastState(true); });
    await expect.poll(()=>guest.evaluate(()=>state.analytics.events.filter(event=>['delta-history-test','second-delta-test'].includes(event.details?.marker)).length)).toBe(2);

  } finally {
    for (const page of pages) await page.evaluate(() => onlineCloseConnection(false)).catch(() => {});
    for (const context of contexts) await context.close();
  }
});
