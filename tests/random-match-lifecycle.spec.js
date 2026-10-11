const { test, expect } = require('@playwright/test');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const url = pathToFileURL(path.join(__dirname, '..', 'index.html')).href;

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(url);
  await expect(page.locator('#homeNavGachaButton')).toBeEnabled();
  await page.evaluate(() => {
    window.matchClients = [];
    window.ChibatoruWebSocketClient = class {
      constructor(url, handlers) { this.handlers = handlers; this.open = true; this.everOpened = true; this.closes = 0; matchClients.push(this); }
      connect(payload) { this.payload = payload; }
      send() { return true; }
      close() { this.closes++; this.open = false; this.handlers.onClose(); }
    };
  });
});

async function search(page, matched = false) {
  await page.locator('#homeNavBattleButton').click();
  await page.locator('#onlineRandomMatchButton').click();
  await expect(page.locator('#onlineRandomSetupPanel')).toBeVisible();
  if (matched) await page.evaluate(() => {
    Object.assign(__chibattle.state.online, { role: 'host', connected: true, roomCode: 'RANDOM', roomSessionId: 'session' });
    __chibattle.render();
  });
}

for (const matched of [false, true]) {
  for (const [name, selector, screen] of [
    ['back', '#onlineRandomBackButton', 'online'],
    ['home', '#homeNavHomeButton', 'home'],
    ['battle menu', '#homeNavBattleButton', 'online'],
    ['solo', '#homeNavSoloButton', 'soloMenu'],
    ['cards', '#homeNavDeckButton', 'deck'],
    ['shop', '#homeNavGachaButton', 'gacha']
  ]) test(`${matched ? 'matched' : 'connecting'}: leaving for ${name} cancels connection and all timers`, async ({ page }) => {
    await search(page, matched);
    await page.clock.install();
    await page.evaluate(() => {
      window.abandonedMatchCallbacks = 0;
      const s = __chibattle.state.online;
      s.reconnectTimer = setTimeout(() => { abandonedMatchCallbacks++; }, 1000);
      s.heartbeatTimer = setInterval(() => { abandonedMatchCallbacks++; }, 1000);
      onlineRandomAutoStartTimer = setTimeout(() => { abandonedMatchCallbacks++; }, 1000);
    });
    await page.locator(selector).click();
    const status = () => page.evaluate(() => {
      const s = __chibattle.state;
      return { screen: s.screen, mode: s.online.matchMode, conn: s.online.conn, role: s.online.role,
        timers: [s.online.connectTimer, s.online.reconnectTimer, s.online.heartbeatTimer], closes: matchClients[0].closes };
    });
    expect(await status()).toEqual({ screen, mode: 'private', conn: null, role: null, timers: [null, null, null], closes: 1 });
    await page.clock.runFor(5000);
    expect(await page.evaluate(() => abandonedMatchCallbacks)).toBe(0);
    await page.evaluate(() => {
      const c = matchClients[0];
      c.handlers.onOpen();
      c.handlers.onMessage({ protocol: ONLINE_PROTOCOL_VERSION, type: 'playerJoined', matchType: 'random', roomId: 'LATE', you: { role: 'host' }, players: [] });
      c.handlers.onClose(); c.handlers.onError(new Error('late'));
    });
    expect(await status()).toEqual({ screen, mode: 'private', conn: null, role: null, timers: [null, null, null], closes: 1 });
    if (name === 'back') await page.screenshot({ path: test.info().outputPath(`cancelled-${matched}.png`) });
  });
}

test('returning to the menu before server assigns a role starts a fresh search only on explicit click', async ({ page }) => {
  await search(page);
  await page.locator('#onlineRandomBackButton').click();
  await expect(page.locator('#onlineRandomMainText')).toHaveText('ランダムマッチ');
  await expect(page.locator('#onlineRandomSpinner')).toBeHidden();
  await page.locator('#onlineRandomMatchButton').click();
  expect(await page.evaluate(() => matchClients.length)).toBe(2);
  await expect(page.locator('#onlineRandomSetupPanel')).toBeVisible();
});

test('an actual battle transition and deck preview do not cancel; private rooms are unaffected', async ({ page }) => {
  await search(page, true);
  await page.evaluate(() => { __chibattle.state.online.deckPreviewOpen = true; __chibattle.render(); });
  expect(await page.evaluate(() => matchClients[0].closes)).toBe(0);
  await page.evaluate(() => {
    __chibattle.state.online.started = true; __chibattle.state.screen = 'battle'; __chibattle.render();
  });
  expect(await page.evaluate(() => matchClients[0].closes)).toBe(0);
  await page.evaluate(() => {
    __chibattle.state.online.matchMode = 'private'; __chibattle.state.screen = 'home'; __chibattle.render();
  });
  expect(await page.evaluate(() => matchClients[0].closes)).toBe(0);
});
