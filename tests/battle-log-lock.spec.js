const { test, expect } = require('@playwright/test');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const url = pathToFileURL(path.join(__dirname, '..', 'index.html')).href;

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(url);
  await page.evaluate(() => {
    startCardTest('general_student');
    scheduleOpponentAI = () => {};
    state.log = Array.from({ length: 60 }, (_, i) => `確認用ログ ${i}`);
    render();
  });
  await expect.poll(() => page.evaluate(() => battlePresentationBusy())).toBe(false);
});

for (const lock of ['check', 'drawQueue', 'attendance', 'remoteChoice']) {
  test(`${lock}待ちでもログを開閉・スクロールでき、対戦操作は止める`, async ({ page }) => {
    await page.evaluate(lock => {
      if (lock === 'check') {
        state.lectureRoomCheckToken = state.preBattleToken;
        state.lectureRoomCheck = true;
      }
      if (lock === 'drawQueue') queuedBattlePresentations += 1;
      if (lock === 'attendance') state.resolvingOrderedAttendance = true;
      if (lock === 'remoteChoice') state.pendingRemoteHandTrim = { mode: 'thin_item_keep' };
      window.lockSnapshot = { turn: state.actionTurn, side: state.currentSide, hand: state.players.player.hand.length };
    }, lock);
    await page.locator('#battleLogButton').click();
    await expect(page.locator('#battleLogDrawer')).toHaveAttribute('aria-hidden', 'false');
    await expect(page.locator('#log')).toContainText('確認用ログ 59');
    await page.locator('#log').hover();
    const before = await page.locator('#log').evaluate(node => node.scrollTop);
    await page.mouse.wheel(0, -600);
    await expect.poll(() => page.locator('#log').evaluate(node => node.scrollTop)).toBeLessThan(before);
    await page.screenshot({ path: test.info().outputPath(`log-${lock}.png`) });
    await page.locator('#battleLogCloseButton').click();
    await expect(page.locator('#battleLogDrawer')).toHaveAttribute('aria-hidden', 'true');
    await page.locator('#endTurnButton').dispatchEvent('click');
    expect(await page.evaluate(() => ({ turn: state.actionTurn, side: state.currentSide, hand: state.players.player.hand.length })))
      .toEqual(await page.evaluate(() => window.lockSnapshot));
    expect(await page.evaluate(() => battleNewActionBlocked())).toBe(true);
    expect(await page.evaluate(() => battleActionInputAllowed(document.querySelector('#playerHand .card')))).toBe(false);
    await page.locator('#battleLogButton').click();
    await page.locator('#battleLogCloseButton').click();
    await expect(page.locator('#battleLogDrawer')).toHaveAttribute('aria-hidden', 'true');
  });
}

test('処理中もログのカードリンクで詳細を確認できる', async ({ page }) => {
  await page.evaluate(() => { state.log = ['一般学生を確認']; render(); state.lectureRoomCheck = true; });
  await page.locator('#battleLogButton').click();
  await page.locator('#log .log-card-link').dispatchEvent('click');
  await expect(page.locator('#battleCardPreview')).toBeVisible();
  await expect(page.locator('#battleCardPreview')).toContainText('一般学生');
});
