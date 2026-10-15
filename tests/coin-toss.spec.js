const { test, expect } = require('@playwright/test');
const { spawn } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const port = 18816;
const url = pathToFileURL(path.join(__dirname, '..', 'index.html'));
url.searchParams.set('ws', `ws://127.0.0.1:${port}`);
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

for (const mode of ['aiBattle', 'dungeon', 'training']) {
  test(`${mode}: 表裏選択・当たり・先攻後攻選択をコイントスで行う`, async ({ page }) => {
    await page.clock.install();
    await page.goto(url.href);
    await page.evaluate(mode => {
      startCardTest('general_student'); scheduleOpponentAI = () => {};
      state.phase = 'versus'; state.firstSide = null;
      state.dungeon.active = mode === 'dungeon';
      state.training.active = mode === 'training'; state.training.skipAnimations = false;
      state.training.leftController = 'user';
      rollCoinFace = () => 'heads';
      if (mode === 'training') beginTrainingPreBattle(state.preBattleToken);
      else beginCoinToss(state.preBattleToken);
    }, mode);
    await expect(page.locator('#coinControls')).toBeVisible();
    await expect(page.locator('#rpsControls')).toBeHidden();
    await expect(page.locator('#rpsArea')).toBeHidden();
    await expect(page.locator('#playerHandZone')).toBeHidden();
    await page.locator('[data-coin-face="heads"]').click();
    expect(await page.evaluate(() => chooseCoinFace('tails'))).toBe(false);
    expect(await page.evaluate(() => state.coinResult)).toBeNull();
    await page.clock.runFor(1101);
    await expect(page.locator('#coinDisc')).toHaveAttribute('aria-label', 'コインの結果：表');
    await expect(page.locator('#preBattleMessage')).not.toContainText('表。');
    await expect(page.locator('#orderChoiceControls')).toBeVisible();
    await page.locator('#chooseSecondButton').click();
    expect(await page.evaluate(() => state.firstSide)).toBe('opponent');
    await page.clock.runFor(651);
    expect(await page.evaluate(() => state.phase)).toBe('dealing');
    expect(await page.evaluate(() => [typeof RPS_ART, Object.keys(RPS_LABELS).length])).toEqual(['object', 3]);
  });
}

test('外れた場合はAIが選び、CPU同士も操作待ちにならない・古いトスは次の試合へ残らない', async ({ page }) => {
  await page.clock.install();
  await page.goto(url.href);
  await page.evaluate(() => {
    startCardTest('general_student'); scheduleOpponentAI = () => {};
    state.phase = 'versus'; state.training.active = false; rollCoinFace = () => 'tails';
    beginCoinToss(state.preBattleToken); chooseCoinFace('heads');
  });
  await page.clock.runFor(1101);
  expect(await page.evaluate(() => state.rpsWinner)).toBe('opponent');
  await expect(page.locator('#preBattleMessage')).not.toContainText('裏。');
  await expect(page.locator('#orderChoiceControls')).toBeHidden();
  await page.clock.runFor(1301);
  expect(await page.evaluate(() => state.phase)).toBe('dealing');
  await page.evaluate(() => {
    state.preBattleToken += 1; state.phase = 'versus'; state.firstSide = null;
    Object.assign(state.training, { active: true, leftController: 'ai', skipAnimations: true });
    beginTrainingPreBattle(state.preBattleToken);
  });
  await page.clock.runFor(20);
  expect(await page.evaluate(() => state.phase)).toBe('dealing');
  await page.evaluate(() => {
    state.training.active = false; state.phase = 'versus';
    beginCoinToss(state.preBattleToken); chooseCoinFace('heads');
    state.preBattleToken += 1; state.phase = 'versus'; state.coinCall = null; state.coinResult = null; state.rpsWinner = null;
  });
  await page.clock.runFor(1101);
  expect(await page.evaluate(() => [state.phase, state.coinResult, state.rpsWinner])).toEqual(['versus', null, null]);
});

for (const face of ['heads', 'tails']) test(`オンラインの結果${face}: ホストだけが選択し、勝者の選択権と結果を観戦者にも同期する`, async ({ browser }) => {
  const contexts = [];
  const open = async () => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } }); contexts.push(context);
    const page = await context.newPage(); await page.goto(url.href);
    await page.locator('#homeNavBattleButton').click(); return page;
  };
  try {
    const host = await open(), guest = await open();
    for (const page of [host, guest]) await page.locator('#onlinePrivateMatchButton').click();
    await host.locator('#onlineCreateRoomButton').click();
    await expect.poll(() => host.evaluate(() => state.online.role)).toBe('host');
    const code = await host.evaluate(() => state.online.roomCode);
    await guest.locator('#onlineRoomInput').fill(code); await guest.locator('#onlineJoinRoomButton').click();
    await expect.poll(() => host.evaluate(() => state.online.connected)).toBe(true);
    for (const page of [host, guest]) {
      await page.evaluate(() => {
        state.deckBuilder.counts.player = createAutoDeckCounts();
        document.getElementById('onlineDeckSelect').dispatchEvent(new Event('change', { bubbles: true }));
      });
      await page.locator('#onlineReadyButton').click();
    }
    await expect(host.locator('#onlineStartButton')).toBeEnabled(); await host.locator('#onlineStartButton').click();
    await expect(host.locator('#coinControls')).toBeVisible();
    await expect.poll(() => guest.evaluate(() => state.phase)).toBe('coinToss');
    const spectator = await open();
    await spectator.locator('#onlineSpectateButton').click(); await spectator.locator('#onlineSpectateRoomInput').fill(code);
    await spectator.locator('#onlineSpectateSearchButton').click();
    await expect.poll(() => spectator.evaluate(() => state.phase)).toBe('coinToss');
    for (const page of [guest, spectator]) {
      await expect(page.locator('#coinControls')).toBeHidden();
      expect(await page.evaluate(() => chooseCoinFace('heads'))).toBe(false);
    }
    await host.evaluate(face => { window.tossRolls = 0; rollCoinFace = () => { window.tossRolls++; return face; }; }, face);
    await host.screenshot({ path: test.info().outputPath('coin-call.png') });
    await host.locator('[data-coin-face="heads"]').click();
    for (const page of [host, guest, spectator]) await expect(page.locator('#coinDisc')).toHaveAttribute('aria-label', `コインの結果：${face === 'heads' ? '表' : '裏'}`);
    expect(await host.evaluate(() => window.tossRolls)).toBe(1);
    const winner = face === 'heads' ? 'player' : 'opponent';
    const guestWinner = face === 'heads' ? 'opponent' : 'player';
    expect(await host.evaluate(() => state.rpsWinner)).toBe(winner);
    expect(await guest.evaluate(() => state.rpsWinner)).toBe(guestWinner);
    const choosing = face === 'heads' ? host : guest;
    const waiting = face === 'heads' ? guest : host;
    for (const page of [waiting, spectator]) await expect(page.locator('#orderChoiceControls')).toBeHidden();
    await expect(choosing.locator('#orderChoiceControls')).toBeVisible();
    await choosing.screenshot({ path: test.info().outputPath('coin-winner-order.png') });
    await choosing.locator('#chooseFirstButton').click();
    await expect.poll(() => host.evaluate(() => state.firstSide)).toBe(winner);
    await expect.poll(() => guest.evaluate(() => state.firstSide)).toBe(guestWinner);
    await expect.poll(() => spectator.evaluate(() => state.firstSide)).toBe(winner);
    await expect.poll(() => guest.evaluate(() => state.phase)).toBe('mulligan');
  } finally { for (const context of contexts) await context.close(); }
});

test('スマイルの口だけの銀青色の表と黒い裏を持ち、上下方向に回転して結果の面で止まる', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.clock.install();
  await page.goto(url.href);
  await page.evaluate(() => {
    startCardTest('general_student'); scheduleOpponentAI = () => {};
    state.phase = 'versus'; state.training.active = false; rollCoinFace = () => 'tails';
    beginCoinToss(state.preBattleToken);
  });
  await expect(page.locator('#coinDisc .coin-face')).toHaveCount(2);
  await expect(page.locator('#coinDisc .coin-smile-mark')).toHaveCount(2);
  await page.screenshot({ path: test.info().outputPath('coin-smile-heads.png') });
  await page.locator('[data-coin-face="tails"]').click();
  const spin = await page.locator('#coinDisc').evaluate(el => {
    const animation = el.getAnimations()[0];
    animation.pause(); animation.currentTime = 150;
    return animation.effect.getKeyframes().map(frame => frame.transform);
  });
  expect(spin.every(transform => transform.includes('rotateX') && !transform.includes('rotateY'))).toBe(true);
  await page.screenshot({ path: test.info().outputPath('coin-smile-flip.png') });
  await page.clock.runFor(1101);
  await expect(page.locator('#coinDisc')).toHaveClass(/tails/);
  const appearance = await page.locator('#coinDisc').evaluate(el => ({
    rotation: getComputedStyle(el).transform,
    black: getComputedStyle(el.querySelector('.coin-face.tails')).backgroundColor,
    hiddenBackfaces: [...el.querySelectorAll('.coin-face')].every(face => getComputedStyle(face).backfaceVisibility === 'hidden'),
    text: el.textContent.trim()
  }));
  expect(appearance.black).toBe('rgb(16, 20, 25)');
  expect(appearance.hiddenBackfaces).toBe(true); expect(appearance.text).toBe('');
  expect(appearance.rotation).toContain('matrix3d');
  await page.screenshot({ path: test.info().outputPath('coin-smile-tails.png') });
});
