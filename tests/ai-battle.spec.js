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

test('all 45 legal decks remain selectable, but stale decks receive less weight', async ({ page }) => {
  const data = await page.evaluate(() => {
    const pool = ChibattleAiBattleDecks;
    const random = Math.random;
    const now = Date.now;
    const sample = (day) => {
      Date.now = () => Date.parse(day);
      const hits = Object.fromEntries(pool.map(deck => [deck.name, 0]));
      for (let i = 0; i < 4500; i += 1) {
        Math.random = () => (i + 0.5) / 4500;
        hits[__chibattle.chooseAiBattleDeck().name] += 1;
      }
      return hits;
    };
    try {
      return {
        legal: pool.every(deck => __chibattle.validateOnlineDeckForRule({ format: 'normal' }, deck.counts, 'normal').valid),
        current: sample('2026-11-06T00:00:00+09:00'),
        sixDaysLater: sample('2026-11-12T00:00:00+09:00'),
        sevenDaysLater: sample('2026-11-13T00:00:00+09:00'),
        tenDaysLater: sample('2026-11-16T00:00:00+09:00'),
        allDecksStale: sample('2026-11-21T00:00:00+09:00')
      };
    } finally {
      Math.random = random;
      Date.now = now;
    }
  });
  expect(data.legal).toBe(true);
  expect(Object.keys(data.current)).toHaveLength(45);
  expect(Object.values(data.current).every(hits => hits > 0)).toBe(true);
  expect(data.current['ワンパン記']).toBeGreaterThan(data.current['LO最終講義']);
  expect(data.current['LO最終講義']).toBeGreaterThan(data.current['ガトリング講師']);
  const oldVsUpdated = hits => hits['ガトリング講師'] / hits['ワンパン記'];
  expect(oldVsUpdated(data.current)).toBeCloseTo(0.55 / 1.15, 1);
  expect(oldVsUpdated(data.sixDaysLater)).toBeLessThan(oldVsUpdated(data.sevenDaysLater));
  expect(oldVsUpdated(data.sevenDaysLater)).toBeCloseTo(0.55, 1);
  expect(oldVsUpdated(data.tenDaysLater)).toBeCloseTo(0.55 / (1 - 0.45 * 3 / 7), 1);
  expect(Object.values(data.allDecksStale).every(hits => hits === 100)).toBe(true);
});

for (const deckName of ['顔殴りのどこ骨', 'どこのウマの骨のマイボだよ！', 'コイントス研究会', '小細工はなしだ', '単位クリエイター', '爆発しちゃうー', '新生ヴァンパイア', 'ウマイボコピー', 'ワンパン記', '我が敵', 'デザイン', '俺らの場所に入り込むクイーン', '就活の代償']) {
  test(`new AI deck starts with the supplied contents: ${deckName}`, async ({ page }) => {
    await prepare(page);
    const result = await page.evaluate(name => {
      const index = ChibattleAiBattleDecks.findIndex(deck => deck.name === name);
      const random = Math.random;
      try {
        const slices = ChibattleAiBattleDecks.length * 3;
        const rolls = Array.from({ length: slices }, (_, i) => (i + 0.5) / slices);
        const roll = rolls.find(value => {
          Math.random = () => value;
          return __chibattle.chooseAiBattleDeck().name === name;
        });
        if (roll === undefined) throw new Error(`Deck cannot be drawn: ${name}`);
        Math.random = () => roll;
        __chibattle.startSoloBattleWithSelectedDecks();
      } finally { Math.random = random; }
      const player = __chibattle.state.players.opponent;
      return {
        expected: ChibattleAiBattleDecks[index].counts,
        actual: Object.fromEntries(Object.entries(player.originalDeckCounts).filter(([, n]) => n > 0)),
        valid: player.deckValid.valid
      };
    }, deckName);
    expect(result.actual).toEqual(result.expected);
    expect(result.valid).toBe(true);
    await expect(page.locator('#battleScreen')).toBeVisible();
  });
}

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
    const actual = positive(s.players.opponent.originalDeckCounts);
    return s.aiBattle.active && !s.training.active && !s.dungeon.active && s.battleRuleId === 'normal'
      && s.players.player.deckValid.valid && s.players.opponent.deckValid.valid
      && ChibattleAiBattleDecks.some(deck => Object.keys(deck.counts).length === Object.keys(actual).length
        && Object.entries(deck.counts).every(([id, count]) => actual[id] === count));
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

test('result back returns to AI match setup with the selected deck and can start again', async ({ page }) => {
  await prepare(page);
  for (const winner of ['player', 'opponent', null]) {
    await page.locator('#soloBattleStartButton').click();
    await page.evaluate(winner => {
      __chibattle.state.preBattleToken++;
      __chibattle.state.phase = 'battle'; __chibattle.render(); endGame(winner, 'テスト');
    }, winner);
    await expect(page.locator('#resultOverlay .result-actions button')).toHaveCount(1);
    await expect(page.locator('[data-result-ai-back]')).toHaveText('戻る');
    await expect(page.locator('[data-result-home]')).toHaveCount(0);
    await page.locator('[data-result-ai-back]').click();
    await expect(page.locator('#resultOverlay')).toBeHidden();
    await expect(page.locator('#soloDeckScreen h1')).toHaveText('AI BATTLE');
    await expect(page.locator('#soloPlayerDeckName')).toHaveText('テストデッキ');
    await expect(page.locator('#soloBattleStartButton')).toBeEnabled();
  }
  await page.screenshot({ path: test.info().outputPath('returned-ai-match.png') });
});
