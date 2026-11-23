const { test, expect } = require('@playwright/test');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const url = pathToFileURL(path.join(__dirname, '..', 'index.html')).href;

async function start(page, id) {
  await page.goto(url);
  await page.evaluate(id => {
    startCardTest(id);
    scheduleOpponentAI = () => {};
    state.training.skipAnimations = true;
  }, id);
  await expect.poll(() => page.evaluate(() => battlePresentationBusy())).toBe(false);
}
async function pinige(page) {
  await start(page, 'pinige');
  await page.evaluate(() => beginItemUse(state.players.player.hand.find(c => c.baseId === 'pinige')));
  await expect(page.locator('.effect-mode-option')).toHaveCount(4);
}

for (const id of ['king_ghidorah_bed', 'environment_setup']) {
  test(`${id}も同じ効果選択を使い、既存の次の処理へ進む`, async ({ page }) => {
    await start(page, id);
    await page.evaluate(id => {
      state.players.player.will = 7;
      beginItemUse(state.players.player.hand.find(c => c.baseId === id));
    }, id);
    await expect(page.locator('#threeGesturesStage')).toHaveClass(/effect-mode-choice/);
    await expect(page.locator('#effectModeSource .card')).toHaveCount(1);
    await page.locator('.effect-mode-option').nth(id === 'king_ghidorah_bed' ? 1 : 0).click();
    await expect(page.locator('#threeGesturesStage')).not.toHaveClass(/effect-mode-choice/);
    if (id === 'king_ghidorah_bed') {
      await expect(page.locator('#threeGesturesHand .card').first()).toBeVisible();
      expect(await page.evaluate(() => state.pendingCardChoice.mode)).toBe('king_ghidorah_discard');
    } else {
      expect(await page.evaluate(() => state.pendingCardChoice)).toBeNull();
      expect(await page.evaluate(() => state.players.player.hand.some(c => c.type === 'environment'))).toBe(true);
    }
  });
}

test('効果を1つ選ぶカードは使用カード1枚と縦のボタンを表示し、押した効果を1回だけ処理する', async ({ page }) => {
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.setViewportSize({ width: 1108, height: 512 });
  await start(page, 'sports_spectator_student');
  await page.evaluate(() => playCard(state.players.player.hand.find(c => c.baseId === 'sports_spectator_student').instanceId, 'seat', 'player', 4));
  await expect(page.locator('.effect-mode-option')).toHaveCount(2);
  await expect.poll(() => page.evaluate(() => battlePresentationBusy({ ignoreFusionTasks: true }))).toBe(false);
  await expect(page.locator('#effectModeSource .card')).toHaveCount(1);
  await expect(page.locator('#threeGesturesHand .card')).toHaveCount(0);
  await expect(page.locator('#threeGesturesConfirmButton')).toBeHidden();
  await page.screenshot({ path: test.info().outputPath('single-landscape.png') });
  await page.locator('.effect-mode-option').nth(1).click();
  await expect.poll(() => page.evaluate(() => !state.pendingCardChoice && !fusionTasksBusy())).toBe(true);
  expect(await page.evaluate(() => { const c = state.players.player.board.seats[4]; return [c.attack, c.currentHp]; })).toEqual([3, 3]);
  expect(errors).toEqual([]);
});

test('複数選択は選択・解除と確定を分け、盤面を見て戻っても選択を維持する', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await pinige(page);
  const rows = page.locator('.effect-mode-option');
  await expect(rows.nth(1)).toContainText('自分のデッキから[点数]を持つ学生2枚を引く。');
  await expect(page.locator('#threeGesturesConfirmButton')).toBeDisabled();
  await rows.nth(0).click();
  await expect(rows.nth(0)).toBeFocused();
  await expect(rows.nth(0)).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#threeGesturesStage [data-selection-peek]').click();
  await expect(page.locator('#threeGesturesStage')).toBeHidden();
  await page.evaluate(() => showSelectionOverlayFromBoard());
  await expect(rows.nth(0)).toHaveAttribute('aria-pressed', 'true');
  await rows.nth(0).click();
  await expect(rows.nth(0)).toHaveAttribute('aria-pressed', 'false');
  await rows.nth(3).click(); await rows.nth(0).click();
  await expect(rows.nth(1)).toBeDisabled();
  await expect(page.locator('#threeGesturesConfirmButton')).toBeEnabled();
  await page.screenshot({ path: test.info().outputPath('multiple-desktop.png') });
  await page.locator('#threeGesturesConfirmButton').click();
  await expect.poll(() => page.evaluate(() => !state.pendingCardChoice && !fusionTasksBusy())).toBe(true);
  expect(await page.evaluate(() => state.players.player.trash.filter(c => c.baseId === 'pinige').length)).toBe(1);
});

for (const viewport of [{ width: 390, height: 844 }, { width: 1108, height: 512 }]) {
  test(`4つの効果と確定操作が画面に収まる ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport); await pinige(page);
    await page.waitForTimeout(450);
    for (const selector of ['#effectModeSource', '#threeGesturesHand', '#threeGesturesConfirmButton']) {
      const box = await page.locator(selector).boundingBox();
      expect(box.x).toBeGreaterThanOrEqual(0); expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
      expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
    }
    expect(await page.locator('#threeGesturesHand').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    await page.screenshot({ path: test.info().outputPath(`multiple-${viewport.width}.png`) });
  });
}

test('決定演出中に対戦を切り替えた場合、古い選択を実行しない', async ({ page }) => {
  await start(page, 'sports_spectator_student');
  await page.evaluate(() => playCard(state.players.player.hand.find(c => c.baseId === 'sports_spectator_student').instanceId, 'seat', 'player', 4));
  await expect(page.locator('.effect-mode-option')).toHaveCount(2);
  await expect.poll(() => page.evaluate(() => battlePresentationBusy({ ignoreFusionTasks: true }))).toBe(false);
  await page.evaluate(() => {
    document.querySelectorAll('.effect-mode-option')[1].click();
    startCardTest('pinige'); state.training.skipAnimations = true;
  });
  await page.waitForTimeout(350);
  expect(await page.evaluate(() => [state.pendingCardChoice, effectModeCommit, state.players.player.board.seats.filter(c => c?.baseId === 'sports_spectator_student').length])).toEqual([null, null, 0]);
});

test('動きを減らす設定でも選択・即決定を使用できる', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await start(page, 'sports_spectator_student');
  await page.evaluate(() => playCard(state.players.player.hand.find(c => c.baseId === 'sports_spectator_student').instanceId, 'seat', 'player', 4));
  await expect.poll(() => page.evaluate(() => battlePresentationBusy({ ignoreFusionTasks: true }))).toBe(false);
  await expect(page.locator('.effect-mode-option').first()).toHaveCSS('animation-name', 'none');
  await page.locator('.effect-mode-option').nth(1).click();
  await expect.poll(() => page.evaluate(() => !state.pendingCardChoice && !fusionTasksBusy())).toBe(true);
});
