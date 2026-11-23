const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const root = path.join(__dirname, '..');
const url = pathToFileURL(path.join(root, 'index.html')).href;
const ids = ['chigauyo', 'handy_jet_engine'];

async function setup(page, id) {
  await page.goto(url);
  await page.evaluate(id => {
    startCardTest(id);
    scheduleOpponentAI = () => {};
    state.training.skipAnimations = true;
  }, id);
  await expect.poll(() => page.evaluate(() => battlePresentationBusy())).toBe(false);
}

test('2枚の本文を維持し、カード・管理ログ・台帳と全文比較の戦意を4へ揃える', async ({ page }) => {
  await page.goto(url);
  const data = await page.evaluate(ids => ({
    cards: ids.map(id => ({ id, cost: CARD_BASES[id].cost, text: cardRulesText(createCardFromBase(id, 'player')) })),
    order: getDeckEditorIds(''),
    changes: UPDATE_HISTORY[0].changes.filter(c => ['ちがうよ', 'ハンディジェットエンジン'].includes(c.title))
  }), ids);
  const catalog = JSON.parse(fs.readFileSync(path.join(root, 'server/card-catalog.json')));
  expect(catalog.deckOrder).toEqual(data.order);
  for (const card of data.cards) {
    expect(card.cost).toBe(4);
    expect(catalog.display[card.id].cost).toBe(4);
  }
  expect(data.changes).toHaveLength(2);
  for (const change of data.changes) {
    expect(change.before).toContain('／戦意3／');
    expect(change.after).toBe(change.before.replace('／戦意3／', '／戦意4／'));
    expect(change.beforeHighlights).toEqual(['戦意3']);
    expect(change.afterHighlights).toEqual(['戦意4']);
  }
  await page.goto(pathToFileURL(path.join(root, 'カード管理台帳.html')).href);
  expect(await page.evaluate(ids => ids.map(id => CARDS.find(c => c.id === id).cost), ids)).toEqual([4, 4]);
});

for (const id of ids) {
  test(`${id}：双方とも戦意3では使用できず、4で支払って従来の効果を処理する`, async ({ page }) => {
    await setup(page, id);
    const rows = await page.evaluate(id => ['player', 'opponent'].map(side => {
      const other = side === 'player' ? 'opponent' : 'player';
      const own = state.players[side], foe = state.players[other];
      const item = createCardFromBase(id, side);
      state.currentSide = side;
      own.hand = [item, createCardFromBase('general_student', side)];
      foe.hand = Array.from({ length: 3 }, () => createCardFromBase('general_teacher', other));
      own.deck = Array.from({ length: 8 }, () => createCardFromBase('general_student', side));
      foe.deck = Array.from({ length: 8 }, () => createCardFromBase('general_teacher', other));
      own.trash = []; foe.trash = [];
      own.will = 3;
      const before = JSON.stringify(state.players);
      const blocked = !castImmediateItem(side, item, false);
      const unchanged = before === JSON.stringify(state.players);
      own.will = 4;
      const used = castImmediateItem(side, item, false);
      return { side, blocked, unchanged, used, will: own.will, ownHand: own.hand.length,
        foeHand: foe.hand.length, ownTrash: own.trash.map(c => c.baseId), foeTrash: foe.trash.length };
    }), id);
    for (const row of rows) expect(row).toEqual({ side: row.side, blocked: true, unchanged: true,
      used: true, will: 0, ownHand: id === 'chigauyo' ? 2 : 0,
      foeHand: id === 'chigauyo' ? 2 : 1,
      ownTrash: id === 'chigauyo' ? [id] : [id, 'general_student'], foeTrash: id === 'chigauyo' ? 0 : 2 });
  });

  test(`${id}：AIの支払いも4、高負荷では5になる`, async ({ page }) => {
    await setup(page, id);
    const data = await page.evaluate(id => {
      const own = state.players.opponent, foe = state.players.player;
      const item = createCardFromBase(id, 'opponent');
      state.currentSide = 'opponent';
      own.hand = [item]; own.trash = []; own.deck = [];
      foe.hand = Array.from({ length: 4 }, () => createCardFromBase('general_student', 'player'));
      foe.deck = [];
      item.handLoadLevel = 2;
      const loadedCost = effectiveCardCost(item);
      own.will = 4;
      const loadedBlocked = !useAiItem(item);
      item.handLoadLevel = 0;
      const used = useAiItem(item);
      return { loadedCost, loadedBlocked, used, will: own.will, usedOnce: own.trash.filter(c => c.instanceId === item.instanceId).length };
    }, id);
    expect(data).toEqual({ loadedCost: 5, loadedBlocked: true, used: true, will: 0, usedOnce: 1 });
  });

  test(`${id}：カード一覧から始めたテストを初期手札のまま使用できる`, async ({ page }) => {
    await page.goto(url);
    await page.locator('#homeNavDeckButton').click();
    await page.locator('[data-case-view="cards"]').click();
    await page.locator('#cardsCatalogSearch').fill(id === 'chigauyo' ? 'ちがうよ' : 'ハンディジェットエンジン');
    await page.locator(`[data-catalog-card="${id}"]`).click();
    await expect(page.locator('#cardTestCard .card-header .stat-cost')).toHaveText('4');
    await page.locator('#cardTestStartButton').click();
    await expect.poll(() => page.evaluate(() => battlePresentationBusy())).toBe(false);
    const initial = await page.evaluate(id => ({ will: state.players.player.will,
      hand: state.players.player.hand.length, other: state.players.opponent.hand.length,
      deck: state.players.player.deck.length, otherDeck: state.players.opponent.deck.length,
      cost: state.players.player.hand.find(c => c.baseId === id).cost }), id);
    expect(initial.cost).toBe(4);
    expect(initial.other).toBe(6);
    await page.evaluate(id => beginItemUse(state.players.player.hand.find(c => c.baseId === id)), id);
    await expect.poll(() => page.evaluate(id => state.players.player.trash.filter(c => c.baseId === id).length, id)).toBe(1);
    await expect.poll(() => page.evaluate(() => battlePresentationBusy())).toBe(false);
    const final = await page.evaluate(() => ({ will: state.players.player.will,
      hand: state.players.player.hand.length, other: state.players.opponent.hand.length }));
    expect(final.will).toBe(initial.will - 4);
    const redraw = Math.ceil((initial.hand - 1 + initial.other) / 2);
    expect(final.hand).toBe(id === 'chigauyo' ? redraw : initial.hand - 2);
    expect(final.other).toBe(id === 'chigauyo' ? redraw : initial.other - 2);
  });
}
