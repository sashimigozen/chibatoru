const { test, expect } = require('@playwright/test');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const url = pathToFileURL(path.join(__dirname, '..', 'index.html')).href;
const geometry = el => {
  const marker = el.querySelector('.hand-effect-indicator').getBoundingClientRect();
  const frame = el.querySelector('.card-scale-stage').getBoundingClientRect();
  return { x: (marker.x + marker.width / 2 - frame.x) / frame.width,
    y: (marker.y + marker.height / 2 - frame.y) / frame.height };
};
for (const width of [1440, 1024]) test(`幅${width}: 種類・レアリティ・ホバーにかかわらずカード上端の同じ位置に印を固定`, async ({ page }) => {
  await page.setViewportSize({ width, height: 1000 });
  await page.goto(url);
  await page.evaluate(() => {
    startCardTest('general_student'); scheduleOpponentAI = () => {};
    state.training.skipAnimations = true;
    const modes = ['normal', 'rare', 'superRare', 'ultraRare', 'reward', 'prism'];
    state.players.player.hand = modes.map((mode, index) => {
      const card = createCardFromBase(['general_student', 'general_teacher', 'fusion_uma', 'classroom', 'yuta', 'king_ghidorah_bed'][index], 'player');
      card.profileStyleMode = mode; card.handLoadLevel = 1; return card;
    });
    render(); syncCardTemplateScales();
  });
  await expect(page.locator('#playerHand .hand-effect-indicator')).toHaveCount(6);
  await page.mouse.move(0, 0);
  await page.screenshot({ path: `/tmp/chibatoru-hand-indicators-${width}.png` });
  const cards = page.locator('#playerHand .hand-card');
  for (let index = 0; index < 6; index++) {
    const card = cards.nth(index);
    const before = await card.evaluate(geometry);
    expect(before.x).toBeCloseTo(0.4, 2); expect(before.y).toBeCloseTo(0, 2);
    await card.evaluate(el => showPlayerHandCardHoverOverlay(el));
    await page.waitForTimeout(200);
    await page.evaluate(() => syncCardTemplateScales());
    const after = await card.evaluate(geometry);
    expect(after.x).toBeCloseTo(before.x, 2); expect(after.y).toBeCloseTo(before.y, 2);
    await page.evaluate(() => clearPlayerHandCardHoverOverlay());
  }
});
test('公開された相手手札も同じ位置に固定し、非公開手札には印を出さない', async ({ page }) => {
  await page.goto(url);
  await page.evaluate(() => {
    startCardTest('general_student'); scheduleOpponentAI = () => {};
    state.players.opponent.hand = ['normal', 'superRare', 'reward', 'prism'].map(mode => {
      const card = createCardFromBase('general_student', 'opponent');
      card.profileStyleMode = mode; card.handLoadLevel = 1; return card;
    });
    render();
  });
  await expect(page.locator('#opponentHand .hand-effect-indicator')).toHaveCount(0);
  await page.evaluate(() => { isTrainingAiVsAi = () => true; render(); syncCardTemplateScales(); });
  await expect(page.locator('#opponentHand .hand-effect-indicator')).toHaveCount(4);
  for (const card of await page.locator('#opponentHand .hand-card').all()) {
    const actual = await card.evaluate(geometry);
    expect(actual.x).toBeCloseTo(0.4, 2); expect(actual.y).toBeCloseTo(0, 2);
  }
});
