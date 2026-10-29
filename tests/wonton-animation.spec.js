const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const http = require('node:http');
let url, server;
test.beforeAll(async () => {
  const root = path.join(__dirname, '..');
  const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.json': 'application/json' };
  server = http.createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const file = path.resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`);
    if (!file.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
    fs.readFile(file, (error, data) => {
      if (error) { res.writeHead(404).end(); return; }
      res.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream' });
      res.end(data);
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  url = `http://127.0.0.1:${server.address().port}/`;
});
test.afterAll(async () => { server?.closeAllConnections(); await new Promise(resolve => server ? server.close(resolve) : resolve()); });

async function setup(page, id = 'wonton_graduation') {
  await page.goto(url);
  await page.evaluate(id => {
    startCardTest(id);
    scheduleOpponentAI = () => {};
    state.training.skipAnimations = false;
  }, id);
  await expect.poll(() => page.evaluate(() => battlePresentationBusy())).toBe(false);
  await page.evaluate(() => window.ChibattleWonton.ready);
}
async function useTestCard(page) {
  await page.evaluate(() => playCard(state.players.player.hand[0].instanceId, 'environment', 'player'));
}
async function settle(page) {
  await expect.poll(() => page.evaluate(() => battlePresentationBusy()), { timeout: 15000 }).toBe(false);
}
function canvasHasArt(canvas) {
  const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
  let paper = 0, ink = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 200) continue;
    if (data[i] > 180 && data[i + 1] > 150 && data[i + 2] < data[i + 1]) paper++;
    if (data[i] < 90 && data[i + 1] < 90 && data[i + 2] < 90) ink++;
  }
  return paper > 500 && ink > 100;
}

for (const width of [1440, 390]) {
  test(`カードテストの卒業は毛筆の完・古書を表示し、4のまま8ダメージ ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await setup(page);
    await page.evaluate(() => {
      window.wontonCounts = [];
      window.wontonSampler = setInterval(() => wontonCounts.push(wontonCount('player')), 10);
    });
    await useTestCard(page);
    const effect = page.locator('.wonton-book-effect');
    await expect(effect).toBeVisible();
    await expect(effect).toHaveAttribute('data-graduation', 'true');
    await expect(effect).toHaveAttribute('data-count', '4');
    expect(await page.evaluate(() => battleNewActionBlocked())).toBe(true);
    await expect(effect).toHaveAttribute('data-phase', 'end-page');
    expect(await page.evaluate(() => [wontonCount('player'), state.players.opponent.life])).toEqual([4, 20]);
    expect(await effect.evaluate(canvasHasArt)).toBe(true);
    await page.screenshot({ path: test.info().outputPath(`graduation-${width}.png`) });
    await settle(page);
    expect(await page.evaluate(() => {
      clearInterval(wontonSampler);
      return [wontonCount('player'), state.players.opponent.life, Math.max(...wontonCounts)];
    })).toEqual([0, 12, 4]);
    await expect(effect).toHaveCount(0);
    expect(errors).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}

test('通常シリーズは1ページめくってからカウントを1増やし、生成・ドローを維持する', async ({ page }) => {
  await setup(page, 'wonton_greeting');
  await useTestCard(page);
  const effect = page.locator('.wonton-book-effect');
  await expect(effect).toBeVisible();
  await expect(effect).toHaveAttribute('aria-label', /0から1、1増加/);
  expect(await page.evaluate(() => wontonCount('player'))).toBe(0);
  await settle(page);
  expect(await page.evaluate(() => [wontonCount('player'), state.players.player.hand.some(c => c.baseId === 'wonton_stall')])).toEqual([1, true]);
  await expect(effect).toHaveCount(0);
});

test('演出中の画面切り替えでは古い対戦のカウント・ダメージを適用しない', async ({ page }) => {
  await setup(page);
  await useTestCard(page);
  await expect(page.locator('.wonton-book-effect')).toBeVisible();
  await page.evaluate(() => { state.screen = 'home'; render(); });
  await expect(page.locator('.wonton-book-effect')).toHaveCount(0);
  await page.waitForTimeout(2600);
  expect(await page.evaluate(() => [wontonCount('player'), state.players.opponent.life, window.ChibattleWonton.isBusy()])).toEqual([4, 20, false]);
});

test('演出スキップでも卒業の処理は1回だけ行う', async ({ page }) => {
  await setup(page);
  await page.evaluate(() => { state.training.skipAnimations = true; });
  await useTestCard(page);
  await settle(page);
  expect(await page.evaluate(() => [wontonCount('player'), state.players.opponent.life])).toEqual([0, 12]);
  await expect(page.locator('.wonton-book-effect')).toHaveCount(0);
});

test('動きを減らす設定でも効果を省略せず、短い静止表示で完了する', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await setup(page);
  await useTestCard(page);
  await settle(page);
  expect(await page.evaluate(() => [wontonCount('player'), state.players.opponent.life])).toEqual([0, 12]);
  await expect(page.locator('.wonton-book-effect')).toHaveCount(0);
});

test('Canvasが利用できなくても卒業の効果は通常どおり解決する', async ({ page }) => {
  await setup(page);
  await page.evaluate(() => { HTMLCanvasElement.prototype.getContext = () => null; });
  await useTestCard(page);
  await settle(page);
  expect(await page.evaluate(() => [wontonCount('player'), state.players.opponent.life])).toEqual([0, 12]);
});

test('卒業のAI評価は増加前のカウントを使い、偽のリーサルと誤認しない', async ({ page }) => {
  await setup(page);
  expect(await page.evaluate(() => {
    state.players.opponent.life = 3;
    state.players.player.submissionCounters['万豚記カウント'] = 1;
    const card = createCardFromBase('wonton_graduation', 'player');
    const low = [scoreAiEnvironment(card, 'player'), submissionDiscardValue('player', card)];
    state.players.player.submissionCounters['万豚記カウント'] = 2;
    return [...low, scoreAiEnvironment(card, 'player')];
  })).toEqual([4, 8, 1000]);
});

test('ver.0.36.0のお知らせに卒業の変更前後・読書演出・検証内容を表示する', async ({ page }) => {
  await page.goto(url);
  await page.locator('#homeUpdatesButton').click();
  const release = page.locator('.update-entry').filter({ has: page.locator('summary', { hasText: 'ver.0.36.0（' }) });
  await release.locator('summary').click();
  const change = release.locator('.update-change').filter({ has: page.locator('.update-before strong', { hasText: '恋の万豚記～卒業シリーズ～' }) });
  await expect(change.locator('.update-before')).toContainText('自分の万豚記カウントを1増やす。その後、');
  await expect(change.locator('.update-after')).not.toContainText('1増やす');
  await expect(change.locator('.update-before .update-text-highlight')).toHaveText(['自分の万豚記カウントを1増やす。その後、']);
  await expect(release).toContainText('万豚記シリーズの読書演出');
  await expect(release).toContainText('万豚記シリーズの効果・テスト');
});

test('ゲスト側の卒業をホスト・ゲスト・観戦で共有し、再送で二重再生しない', async ({ page: host, browser }) => {
  test.setTimeout(60000);
  const guest = await browser.newPage(), spectator = await browser.newPage();
  async function deliver(snapshot) {
    for (const viewer of [guest, spectator]) await viewer.evaluate(snapshot => onlineHandleMessage({ type: 'gameState', protocol: ONLINE_PROTOCOL_VERSION, snapshot }), snapshot);
  }
  async function relay() {
    const snapshots = await host.evaluate(() => outbox.splice(0).filter(m => m.type === 'gameState').map(m => m.snapshot));
    for (const snapshot of snapshots) await deliver(snapshot);
  }
  try {
    for (const [p, role] of [[host, 'host'], [guest, 'guest'], [spectator, 'spectator']]) {
      await setup(p);
      await p.evaluate(role => {
        Object.assign(state.online, { role, started: true, connected: true, conn: {} });
        window.outbox = [];
        onlineSend = m => { outbox.push(JSON.parse(JSON.stringify(m))); return true; };
        window.bookAppearances = 0;
        new MutationObserver(records => records.forEach(r => r.addedNodes.forEach(n => {
          if (n.classList?.contains('wonton-book-effect')) bookAppearances++;
        }))).observe(document.body, { childList: true });
      }, role);
    }
    await host.evaluate(() => {
      state.currentSide = 'opponent';
      state.players.opponent.submissionCounters = { '万豚記カウント': 4 };
      state.players.player.life = 20;
      state.players.opponent.hand = [createCardFromBase('wonton_graduation', 'opponent')];
      render();
    });
    await deliver(await host.evaluate(() => onlineCreateSnapshot()));
    for (const p of [host, guest, spectator]) await settle(p);
    await host.evaluate(() => { moveHandCardToTrash('opponent', state.players.opponent.hand[0], { effectDiscard: true }); render(); });
    await expect.poll(() => host.evaluate(() => outbox.some(m => m.snapshot?.state.effectFeedbackEvents.some(e => e.target === 'wonton-book')))).toBe(true);
    await relay();
    for (const [p, owner] of [[host, 'opponent'], [guest, 'player'], [spectator, 'opponent']]) {
      await expect(p.locator('.wonton-book-effect')).toHaveAttribute('data-owner', owner, { timeout: 15000 });
      await expect(p.locator('.wonton-book-effect')).toHaveAttribute('data-count', '4');
    }
    await settle(host);
    await relay();
    await deliver(await host.evaluate(() => onlineCreateSnapshot()));
    for (const p of [guest, spectator]) await settle(p);
    for (const [p, owner, target] of [[host, 'opponent', 'player'], [guest, 'player', 'opponent'], [spectator, 'opponent', 'player']]) {
      expect(await p.evaluate(({ owner, target }) => [wontonCount(owner), state.players[target].life, bookAppearances], { owner, target })).toEqual([0, 12, 1]);
      await expect(p.locator('.wonton-book-effect')).toHaveCount(0);
    }
  } finally { await guest.close(); await spectator.close(); }
});
