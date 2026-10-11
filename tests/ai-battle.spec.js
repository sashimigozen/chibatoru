const { test, expect } = require('@playwright/test');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const C = require('../gacha-core.js');
const url = pathToFileURL(path.join(__dirname, '..', 'index.html')).href;

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.addInitScript(({ key, economy }) => {
    localStorage.clear(); localStorage.setItem(key, JSON.stringify(economy));
  }, { key: C.KEY, economy: C.initial() });
  await page.goto(url);
  await expect(page.locator('#homeNavGachaButton')).toBeEnabled();
  await page.evaluate(() => {
    __chibattle.state.deckBuilder.savedDecks['テストデッキ'] = { counts: { ...ChibattleAiBattleDecks[0].counts } };
  });
});

async function prepare(page) {
  await page.locator('#homeNavSoloButton').click();
  await page.locator('#soloAiBattleButton').click();
  await expect(page.locator('#soloDeckScreen h1')).toHaveText('AI BATTLE');
  await page.locator('#soloPlayerSlot').click();
  await page.locator('#soloDeckGrid button', { hasText: 'テストデッキ' }).click();
  await expect(page.locator('#soloBattleStartButton')).toBeEnabled();
}
const cp = page => page.evaluate(key => JSON.parse(localStorage.getItem(key)).cp, C.KEY);

test('17 legal decks are selected uniformly with unchanged counts', async ({ page }) => {
  const data = await page.evaluate(() => {
    const pool = ChibattleAiBattleDecks;
    const random = Math.random;
    try {
      return pool.map((deck, i) => {
        Math.random = () => (i + 0.5) / pool.length;
        return { name: deck.name, picked: __chibattle.chooseAiBattleDeck().name,
          valid: __chibattle.validateOnlineDeckForRule({ format: 'normal' }, deck.counts, 'normal').valid };
      });
    } finally { Math.random = random; }
  });
  expect(data).toHaveLength(17);
  expect(new Set(data.map(d => d.name)).size).toBe(17);
  expect(data.every(d => d.valid && d.name === d.picked)).toBe(true);
});

test('only the player selects a deck; AI contents stay hidden and training stays separate', async ({ page }) => {
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await prepare(page);
  await expect(page.locator('#soloAiDeckName')).toHaveText('ランダム');
  for (const id of ['soloAiSlot', 'soloAiDeckConfirmButton', 'soloLeftControllerButton', 'soloTrainingDataButton', 'soloRuleCycleButton', 'soloInitiativeCycleButton']) {
    await expect(page.locator('#' + id)).toBeHidden();
  }
  await page.screenshot({ path: test.info().outputPath('ai-battle-setup.png') });
  await page.locator('#soloBattleStartButton').click();
  await expect(page.locator('#battleScreen')).toBeVisible();
  expect(await page.evaluate(() => {
    const s = __chibattle.state;
    const positive = counts => Object.fromEntries(Object.entries(counts).filter(([, n]) => n > 0));
    return s.aiBattle.active && !s.training.active && !s.dungeon.active && s.battleRuleId === 'normal'
      && s.players.player.deckValid.valid && s.players.opponent.deckValid.valid
      && ChibattleAiBattleDecks.some(d => JSON.stringify(positive(s.players.opponent.originalDeckCounts)) === JSON.stringify(d.counts));
  })).toBe(true);
  await page.evaluate(() => { __chibattle.state.preBattleToken++; __chibattle.startSoloBattleFromHome(); });
  await expect(page.locator('#soloDeckScreen h1')).toHaveText('TRAINING');
  await expect(page.locator('#soloAiSlot')).toBeVisible();
  await expect(page.locator('#soloRuleCycleButton')).toBeVisible();
  expect(errors).toEqual([]);
});

test('each victory directly adds 5 CP once, persists, and shows 5CP GET; losses add none', async ({ page }) => {
  await prepare(page);
  const gifts = await page.evaluate(key => JSON.parse(localStorage.getItem(key)).gifts, C.KEY);
  for (const [winner, expected] of [['player', 5], ['opponent', 5], ['player', 10]]) {
    await page.evaluate(() => __chibattle.startSoloBattleWithSelectedDecks());
    await page.evaluate(winner => {
      __chibattle.state.preBattleToken++;
      __chibattle.state.phase = 'battle'; __chibattle.render();
      endGame(winner, 'テスト');
    }, winner);
    await expect.poll(() => cp(page)).toBe(expected);
    if (winner === 'player') {
      await expect(page.locator('.ai-battle-reward')).toBeVisible();
      await expect(page.locator('.ai-battle-reward')).toHaveText('5CP GET');
      await expect(page.locator('#resultOverlay')).toHaveCSS('opacity', '1');
      await page.screenshot({ path: test.info().outputPath(`victory-${expected}.png`) });
      await page.evaluate(() => ChibattleGacha.recordBattleResult('player'));
      await expect.poll(() => page.evaluate(key => JSON.parse(localStorage.getItem(key)).revision, C.KEY)).toBeGreaterThan(0);
      expect(await cp(page)).toBe(expected);
    } else await expect(page.locator('.ai-battle-reward')).toBeHidden();
  }
  expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)).gifts, C.KEY)).toEqual(gifts);
  await page.evaluate(() => __chibattle.startSoloBattleFromHome());
  await page.evaluate(() => {
    const s = __chibattle.state;
    s.soloSelection.playerDeckName = s.soloSelection.opponentDeckName = 'テストデッキ';
    __chibattle.startSoloBattleWithSelectedDecks(); s.preBattleToken++; endGame('player', 'テスト');
  });
  expect(await cp(page)).toBe(10);
  await expect(page.locator('.ai-battle-reward')).toBeHidden();
});
