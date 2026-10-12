const { test, expect } = require('@playwright/test');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const url = pathToFileURL(path.join(__dirname, '..', 'index.html')).href;
const text = '自分の手札1枚を選び、デッキに戻す。その後、後攻1ターン目または後攻7ターン目なら、自分のデッキからカード1枚を選び、手札に加える。それ以外なら、デッキからカードを1枚引く。';

test.beforeEach(async ({ page }) => {
  await page.goto(url);
  await page.evaluate(() => {
    startCardTest('general_student'); scheduleOpponentAI = () => {};
    state.training.skipAnimations = true;
    state.players.player.hand = ['sage_legacy', 'general_student', 'yuta'].map(id => createCardFromBase(id, 'player'));
    state.players.player.deck = ['general_teacher', 'trpg_member', 'classroom'].map(id => createCardFromBase(id, 'player'));
    state.players.player.turnsTaken = 1; state.firstSide = 'opponent';
    render();
  });
  await expect.poll(() => page.evaluate(() => battlePresentationBusy())).toBe(false);
});

test('合意した本文を表示する', async ({ page }) => {
  expect(await page.evaluate(() => cardRulesText(state.players.player.hand[0]))).toBe(text.replace('。それ以外', '。\nそれ以外'));
});

for (const [first, turn, search] of [['player', 1, false], ['opponent', 1, true], ['opponent', 7, true], ['opponent', 2, false], ['player', 7, false]]) {
  test(`${first}先攻・自分${turn}ターン目は${search ? '選んだ1枚' : '1枚ドロー'}`, async ({ page }) => {
    const result = await page.evaluate(({ first, turn }) => {
      state.firstSide = first; state.players.player.turnsTaken = turn;
      const p = state.players.player, [item, returned] = p.hand, searched = p.deck[1];
      let shuffles = 0;
      const original = shuffleDeckAfterSearch;
      shuffleDeckAfterSearch = side => { shuffles++; original(side); };
      const used = resolveSageLegacyChoice('player', item, searched.instanceId, true, returned.instanceId);
      return { used, shuffles, hand: p.hand.map(c => c.instanceId), searchId: searched.instanceId,
        total: p.hand.length + p.deck.length, trash: p.trash.filter(c => c.baseId === 'sage_legacy').length };
    }, { first, turn });
    expect(result.used).toBe(true);
    expect(result.hand).toHaveLength(2);
    expect(result.total).toBe(5);
    expect(result.trash).toBe(1);
    expect(result.shuffles).toBe(search ? 2 : 1);
    if (search) expect(result.hand).toContain(result.searchId);
  });
}

test('戻す手札がなければ使用不可。デッキ0枚でも戻したカードを選び直せる', async ({ page }) => {
  const result = await page.evaluate(() => {
    const p = state.players.player, [item, returned] = p.hand;
    p.hand = [item];
    const unavailable = !canUseSageLegacy('player', item);
    p.hand.push(returned); p.deck = [];
    const used = resolveSageLegacyChoice('player', item, returned.instanceId, true, returned.instanceId);
    return { unavailable, used, hand: p.hand.map(c => c.instanceId), id: returned.instanceId, deck: p.deck.length };
  });
  expect(result).toMatchObject({ unavailable: true, used: true, deck: 0 });
  expect(result.hand).toEqual([result.id]);
});

test('不正な返却先・検索先ではカードや戦意を消費しない', async ({ page }) => {
  const result = await page.evaluate(() => {
    const [item, returned] = state.players.player.hand;
    const before = JSON.stringify(state.players.player);
    const wrongReturn = resolveSageLegacyChoice('player', item, null, false, item.instanceId);
    const wrongSearch = resolveSageLegacyChoice('player', item, 'invalid', false, returned.instanceId);
    return { wrongReturn, wrongSearch, unchanged: before === JSON.stringify(state.players.player) };
  });
  expect(result).toEqual({ wrongReturn: false, wrongSearch: false, unchanged: true });
});

test('実画面で返却・検索を先に選び、使用演出後に1枚だけ加える', async ({ page }) => {
  await page.evaluate(() => { state.training.skipAnimations = false; openSageLegacyChoice(state.players.player.hand[0]); });
  await page.locator('#threeGesturesHand .card').first().click();
  await page.locator('#threeGesturesConfirmButton').click();
  expect(await page.evaluate(() => state.pendingCardChoice.mode)).toBe('sage_legacy');
  expect(await page.evaluate(() => state.players.player.hand.length)).toBe(3);
  const selectedId = await page.evaluate(() => state.players.player.deck[1].instanceId);
  await page.locator(`#threeGesturesHand [data-card-id="${selectedId}"]`).click();
  await page.locator('#threeGesturesConfirmButton').click();
  await expect.poll(() => page.evaluate(() => state.players.player.hand.length)).toBe(2);
  expect(await page.evaluate(id => state.players.player.hand.some(c => c.instanceId === id), selectedId)).toBe(true);
  await expect.poll(() => page.evaluate(() => battlePresentationBusy())).toBe(false);
});

test('オンラインコマンドは返却IDと検索IDをホストへ送り、同じ処理になる', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const p = state.players.opponent;
    state.online.enabled = true; state.online.role = 'host'; state.online.started = true;
    state.currentSide = 'opponent'; state.firstSide = 'player'; p.turnsTaken = 7;
    const item = createCardFromBase('sage_legacy', 'opponent'), returned = createCardFromBase('general_student', 'opponent');
    const searched = createCardFromBase('trpg_member', 'opponent');
    p.hand = [item, returned]; p.deck = [searched];
    await onlineApplyRemoteCommand({ type: 'sageLegacy', payload: { instanceId: item.instanceId, selectedId: searched.instanceId, returnId: returned.instanceId } });
    return { hand: p.hand.map(c => c.baseId), deck: p.deck.map(c => c.baseId), will: p.will };
  });
  expect(result.hand).toEqual(['trpg_member']);
  expect(result.deck).toEqual(['general_student']);
  expect(result.will).toBe(9);
});

test('シャッフルの例外：通常ドロー・上からの校外送り・三敵は順序を保つ', async ({ page }) => {
  const result = await page.evaluate(() => {
    const p = state.players.player;
    p.deck = ['general_student', 'general_teacher', 'yuta', 'classroom'].map(id => createCardFromBase(id, 'player'));
    const ids = p.deck.map(c => c.instanceId);
    drawOne('player', false);
    moveTopDeckCardsToTrash('player', 1);
    const afterTop = p.deck.map(c => c.instanceId);
    resolveTripleEnemyEffect('player', createCardFromBase('triple_enemy', 'player'), []);
    return { afterTop, remaining: p.deck.map(c => c.instanceId), ids: ids.slice(2) };
  });
  expect(result.afterTop).toEqual(result.ids);
  expect(result.remaining).toEqual(result.ids);
});
