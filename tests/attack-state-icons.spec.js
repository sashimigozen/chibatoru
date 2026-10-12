const { test, expect } = require('@playwright/test');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const url = pathToFileURL(path.join(__dirname, '..', 'index.html')).href;

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(url);
  await page.evaluate(() => { startCardTest('general_student'); scheduleOpponentAI = () => {}; });
  await expect.poll(() => page.evaluate(() => battlePresentationBusy())).toBe(false);
});

for (const [id, fresh, blue] of [
  ['general_student', false, true], ['zombie', true, false],
  ['zombie', false, true], ['aggro_princess', true, true], ['happy_blue_bird', false, false]
]) {
  test(`${id} ${fresh ? '出席直後' : '待機終了後'}の攻撃範囲を表示`, async ({ page }) => {
    await page.evaluate(({ id, fresh }) => {
      const card = makeBoardCard(createCardFromBase(id, 'player'));
      card.playedOnTurn = fresh ? state.actionTurn : state.actionTurn - 1;
      state.players.player.board.seats.fill(null);
      state.players.player.board.seats[0] = card;
      render();
    }, { id, fresh });
    const icon = page.locator('#playerSeatGrid .attack-state');
    await expect(icon).toHaveCount(1);
    await expect(icon).toHaveAttribute('title', blue ? '本体にも攻撃可能' : '出席者のみ攻撃可能');
    expect(await icon.evaluate(el => el.classList.contains('attack-super-cheerful'))).toBe(blue);
  });
}

for (const keyword of ['注目', '超注目']) {
  test(`${keyword}がいても青、実際の本体攻撃制限は維持`, async ({ page }) => {
    const result = await page.evaluate(keyword => {
      const card = makeBoardCard(createCardFromBase('general_student', 'player'));
      card.playedOnTurn = state.actionTurn - 1;
      state.players.player.board.seats.fill(null);
      state.players.player.board.seats[0] = card;
      state.players.opponent.board.seats[0].keywords = [keyword];
      state.selectedAttacker = { owner: 'player', zone: 'seat', index: 0 };
      render();
      return { actual: canSelectedAttackerTargetLife('opponent'), superCheerful: hasKeyword(card, '超陽気') };
    }, keyword);
    await expect(page.locator('#playerSeatGrid .attack-super-cheerful')).toHaveCount(1);
    expect(result).toEqual({ actual: false, superCheerful: false });
    if (keyword === '注目') await page.screenshot({ path: test.info().outputPath('attack-ready-blue.png') });
  });
}

test('召喚酔い・行動済み・相手ターンの表示は維持', async ({ page }) => {
  const result = await page.evaluate(() => {
    const c = makeBoardCard(createCardFromBase('general_student', 'player'));
    c.playedOnTurn = state.actionTurn;
    const fresh = statusPartsForCard(c, true);
    c.playedOnTurn--;
    markCardAttackUsed(c);
    const used = statusPartsForCard(c, true);
    resetCardAttackUsage(c);
    state.currentSide = 'opponent';
    const otherTurn = statusPartsForCard(c, true);
    return { fresh, used, otherTurn };
  });
  expect(result.fresh.some(p => p.title === '召喚酔い')).toBe(true);
  expect(result.fresh.some(p => p.tone?.includes('attack-state'))).toBe(false);
  expect(result.used.some(p => p.title === '攻撃済み')).toBe(true);
  expect(result.otherTurn.some(p => p.tone?.includes('attack-state'))).toBe(false);
});
