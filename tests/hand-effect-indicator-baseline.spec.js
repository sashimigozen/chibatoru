const { test, expect } = require('@playwright/test');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const url = pathToFileURL(path.join(__dirname, '..', 'index.html')).href;

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(url);
  await page.evaluate(() => {
    startCardTest('general_student'); scheduleOpponentAI = () => {};
    state.training.skipAnimations = true; state.environment = null;
    for (const side of ['player', 'opponent']) {
      state.players[side].board = { teacher: null, seats: Array(9).fill(null) };
      state.players[side].will = 0;
    }
  });
  await expect.poll(() => page.evaluate(() => battlePresentationBusy())).toBe(false);
});

test('全カードの印刷された能力だけでは手札の変更マークを表示しない', async ({ page }) => {
  const result = await page.evaluate(() => Object.keys(CARD_BASES).flatMap(id => {
    const card = createCardFromBase(id, 'player');
    return handCardEffectNotes(card).length ? [{ id, notes: handCardEffectNotes(card) }] : [];
  }));
  expect(result).toEqual([]);
});

test('元の超注目を含む手札に印を付けず、他の能力を付与したカードだけに表示する', async ({ page }) => {
  await page.evaluate(() => {
    state.players.player.hand = ['super_ae_student', 'laughing_front_student', 'aggro_princess', 'general_student']
      .map(id => createCardFromBase(id, 'player'));
    render();
  });
  await expect(page.locator('#playerHand .hand-effect-indicator')).toHaveCount(0);
  expect(await page.evaluate(() => [hasKeyword(state.players.player.hand[0], '超注目'), hasKeyword(state.players.player.hand[0], '注目')])).toEqual([true, true]);
  await page.evaluate(() => {
    addKeyword(state.players.player.hand[0], '陽気', 'いけます'); render();
    showBattleCardPreview(state.players.player.hand[0]);
  });
  await expect(page.locator('#playerHand .hand-effect-indicator')).toHaveCount(1);
  await expect(page.locator('#playerHand .hand-effect-indicator')).toHaveAttribute('aria-label', '陽気：いけます');
  await expect(page.locator('#battleCardPreview')).toContainText('いけます');
  await page.screenshot({ path: test.info().outputPath('granted-ability-marker.png') });
});

test('負荷・数値変更・戦意変更の印を維持し、能力の付与がなくなれば印も消える', async ({ page }) => {
  const notes = await page.evaluate(() => {
    const cards = Array.from({ length: 4 }, () => createCardFromBase('general_student', 'player'));
    addHandLoad(cards[0]);
    cards[1].attack += 1;
    cards[2].smokeFlareCostReduction = 1;
    addKeyword(cards[3], '陽気', 'いけます');
    state.players.player.hand = cards; render();
    return cards.map(handCardEffectNotes);
  });
  expect(notes).toEqual([['負荷'], ['攻撃力 +1'], ['戦意が変化しています'], ['陽気：いけます']]);
  await expect(page.locator('#playerHand .hand-effect-indicator')).toHaveCount(4);
  await page.evaluate(() => {
    const card = state.players.player.hand[3]; card.keywords = []; card.keywordSources = {}; render();
  });
  await expect(page.locator('#playerHand .hand-effect-indicator')).toHaveCount(3);
});

test('公開された相手手札・ゲスト視点でも元の能力を変更扱いせず、非公開情報を漏らさない', async ({ page }) => {
  const snapshotNotes = await page.evaluate(() => {
    const innate = createCardFromBase('super_ae_student', 'opponent');
    const changed = createCardFromBase('super_ae_student', 'opponent');
    addKeyword(changed, '陽気', 'いけます');
    state.players.opponent.hand = [innate, changed]; render();
    const snapshot = onlineTransformSnapshotForGuest(onlineCreateSnapshot().state);
    return snapshot.players.player.hand.map(handCardEffectNotes);
  });
  expect(snapshotNotes).toEqual([[], ['陽気：いけます']]);
  await expect(page.locator('#opponentHand .hand-effect-indicator')).toHaveCount(0);
  await page.evaluate(() => { isTrainingAiVsAi = () => true; renderOpponentHand(); syncCardTemplateScales(); });
  await expect(page.locator('#opponentHand .hand-effect-indicator')).toHaveCount(1);
});
