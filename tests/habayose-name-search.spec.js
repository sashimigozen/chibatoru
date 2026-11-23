const { test, expect } = require('@playwright/test');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const url = pathToFileURL(path.join(__dirname, '..', 'index.html')).href;
const searchText = '自分のデッキから「U太」とつくカード1枚を選び、手札に加える。';

async function setup(page) {
  await page.goto(url);
  await page.evaluate(() => { startCardTest('habayose'); state.training.skipAnimations = true; scheduleOpponentAI = () => {}; render(); });
  await expect.poll(() => page.evaluate(() => battlePresentationBusy()), { timeout: 15000 }).toBe(false);
}

test('カード一覧のテストから名前だけで検索し、本文だけの一致と自身を候補に出さない', async ({ page }) => {
  await page.goto(url);
  await page.locator('#homeNavDeckButton').click();
  await page.locator('[data-case-view="cards"]').click();
  await page.locator('#cardsCatalogSearch').fill('ハバヨセ!');
  await page.locator('[data-catalog-card="habayose"]').click();
  await expect(page.getByRole('dialog', {name:'カード詳細',exact:true})).toContainText(searchText);
  await page.locator('#cardTestStartButton').click();
  await page.evaluate(() => { state.training.skipAnimations = true; scheduleOpponentAI = () => {}; });
  await expect.poll(() => page.evaluate(() => battlePresentationBusy()), { timeout: 15000 }).toBe(false);
  await page.evaluate(() => beginItemUse(state.players.player.hand.find(c => c.baseId === 'habayose')));
  await expect.poll(() => page.evaluate(() => state.pendingCardChoice?.context?.kind), { timeout: 15000 }).toBe('habayose_search');
  expect(await page.evaluate(() => [...new Set(state.pendingCardChoice.cards.map(c => c.baseId))].sort()))
    .toEqual(['dark_yuta', 'yuta', 'yuta_umbrella']);
  expect(await page.evaluate(() => state.pendingCardChoice.message)).toContain('「U太」とつくカード');
  await page.screenshot({ path: test.info().outputPath('habayose-name-only.png') });
  await page.evaluate(() => {
    toggleCardChoiceCard(state.pendingCardChoice.cards.find(c => c.baseId === 'yuta_umbrella').instanceId);
    confirmCardChoiceSelection();
  });
  await expect.poll(() => page.evaluate(() => state.pendingCardChoice?.context?.kind)).toBe('attendance_optional');
  await page.evaluate(() => confirmCardChoiceSelection());
  await expect.poll(() => page.evaluate(() => fusionTasksBusy()), { timeout: 15000 }).toBe(false);
  expect(await page.evaluate(() => state.players.player.hand.some(c => c.baseId === 'yuta_umbrella'))).toBe(true);
});

test('双方の候補判定とAIがカード名だけを参照し、校外での別名はデッキへ適用しない', async ({ page }) => {
  await setup(page);
  const result = await page.evaluate(() => ['player', 'opponent'].map(side => {
    state.currentSide = side;
    const player = state.players[side], item = createCardFromBase('habayose', side);
    player.will = 2; player.hand = [];
    player.deck = ['habayose', 'sexual_eye', 'red_happi', 'accelerate', 'general_student'].map(id => createCardFromBase(id, side));
    const rejected = habayoseSearchCandidates(side).length, negativeScore = scoreAiHabayose(side, item);
    const named = ['yuta', 'dark_yuta', 'yuta_umbrella', 'yutakun_yutakun', 'ultimate_yuta', 'sick_yuta', 'recovered_dark_yuta'];
    player.deck.push(...named.map(id => createCardFromBase(id, side)));
    return { rejected, negativeScore, positiveScore: scoreAiHabayose(side, item), names: habayoseSearchCandidates(side).map(c => c.baseId),
      aliasInTrash: isUtaInTrash(item), acceptedInDeck: isHabayoseSearchCandidate(item) };
  }));
  for (const r of result) expect(r).toEqual({ rejected: 0, negativeScore: 0, positiveScore: 5,
    names: ['yuta', 'dark_yuta', 'yuta_umbrella', 'yutakun_yutakun', 'ultimate_yuta', 'sick_yuta', 'recovered_dark_yuta'],
    aliasInTrash: true, acceptedInDeck: false });
});

for (const locked of [false, true]) test(`候補なしでも余分に引かず、禁止中=${locked}のシャッフルを守る`, async ({ page }) => {
  await setup(page);
  const before = await page.evaluate(locked => {
    const p = state.players.player; p.hand = []; p.will = 2;
    p.deck = ['habayose', 'sexual_eye', 'red_happi'].map(id => createCardFromBase(id, 'player'));
    state.deckVisualEvents = [];
    state.deckToHandLocks = locked ? [{ owner: 'opponent', releaseAtActionTurn: 999 }] : [];
    const ids = p.deck.map(c => c.instanceId);
    const item = createCardFromBase('habayose', 'player'); p.hand.push(item); castImmediateItem('player', item, true);
    return ids;
  }, locked);
  await expect.poll(() => page.evaluate(() => fusionTasksBusy()), { timeout: 15000 }).toBe(false);
  const after = await page.evaluate(() => ({ hand: state.players.player.hand.length, deck: state.players.player.deck.map(c => c.instanceId),
    events: state.deckVisualEvents.map(e => e.type) }));
  expect(after.hand).toBe(0); expect(after.deck.sort()).toEqual(before.sort());
  expect(after.events).toEqual(locked ? [] : ['shuffle']);
});

test('解決時にも対象を再検証し、本文だけ一致するカードの不正な選択を通さない', async ({ page }) => {
  await setup(page);
  const result = await page.evaluate(async () => {
    const p = state.players.player; p.will = 0; p.hand = [];
    p.deck = [createCardFromBase('sexual_eye', 'player')]; state.deckVisualEvents = [];
    const target = p.deck[0], original = chooseFusionEffectCards;
    chooseFusionEffectCards = async () => [target];
    try { await resolveHabayoseSubmission('player', createCardFromBase('habayose', 'player')); }
    finally { chooseFusionEffectCards = original; }
    return { hand: p.hand.length, deck: p.deck.map(c => c.baseId), events: state.deckVisualEvents.map(e => e.type) };
  });
  expect(result).toEqual({ hand: 0, deck: ['sexual_eye'], events: ['shuffle'] });
});
