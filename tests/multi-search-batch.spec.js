const { test, expect } = require('@playwright/test');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const url = pathToFileURL(path.join(__dirname, '..', 'index.html')).href;

async function settled(page) {
  await expect.poll(() => page.evaluate(() => battlePresentationBusy()), { timeout: 20000 }).toBe(false);
}
async function setup(page, size = { width: 1440, height: 900 }) {
  await page.setViewportSize(size);
  await page.goto(url);
  await page.evaluate(() => {
    startCardTest('efficient_experiment_method');
    scheduleOpponentAI = () => {};
    state.training.skipAnimations = true;
    render();
  });
  await settled(page);
  await page.evaluate(() => { state.deckVisualEvents = []; });
}

for (const size of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
  test(`効率的な実験法の通常テストで3種類を中央にまとめて引き、最後に一度混ぜる ${size.width}`, async ({ page }) => {
    await setup(page, size);
    const before = await page.evaluate(() => ({
      ids: state.players.player.hand.map(c => c.instanceId),
      deckCount: state.players.player.deck.length
    }));
    await page.evaluate(() => {
      state.training.skipAnimations = false;
      beginItemUse(state.players.player.hand.find(c => c.baseId === 'efficient_experiment_method'));
    });
    const preview = page.locator('.draw-flight[data-search-draw="true"][data-draw-phase="preview"]');
    await expect(preview).toHaveCount(3, { timeout: 15000 });
    await expect(preview.locator('.draw-flight-front')).toHaveCount(3);
    await expect(page.locator('.deck-flight[data-deck-phase="shuffle"]')).toHaveCount(0);
    const bounds = await preview.evaluateAll(nodes => nodes.map(n => {
      const r = n.getBoundingClientRect(); return { x: r.x, y: r.y, right: r.right, bottom: r.bottom };
    }));
    expect(Math.abs((Math.min(...bounds.map(r => r.x)) + Math.max(...bounds.map(r => r.right))) / 2 - size.width / 2)).toBeLessThan(1);
    expect(Math.abs((bounds[0].y + bounds[0].bottom) / 2 - size.height / 2)).toBeLessThan(1);
    for (const r of bounds) { expect(r.x).toBeGreaterThanOrEqual(0); expect(r.right).toBeLessThanOrEqual(size.width); }
    await page.screenshot({ path: test.info().outputPath(`search-batch-${size.width}.png`) });
    await expect(page.locator('.deck-flight[data-deck-phase="shuffle"]')).toHaveCount(3);
    await settled(page);
    const after = await page.evaluate(ids => ({
      types: state.players.player.hand.filter(c => !ids.includes(c.instanceId)).map(c => c.type),
      deckCount: state.players.player.deck.length,
      events: state.deckVisualEvents.map(e => ({ type: e.type, count: e.count, center: e.centerReveal }))
    }), before.ids);
    expect(after.types).toEqual(['student', 'teacher', 'item']);
    expect(after.deckCount).toBe(before.deckCount - 3);
    expect(after.events).toEqual([
      { type: 'draw', count: 3, center: true }, { type: 'shuffle', count: 1, center: undefined }
    ]);
  });
}

for (const side of ['player', 'opponent']) {
  test(`${side}の乾いた食券は2種類を一度に引き、食堂条件と枚数を維持する`, async ({ page }) => {
    await setup(page);
    const result = await page.evaluate(side => {
      const own = state.players[side];
      state.currentSide = side;
      own.will = 10;
      const item = createCardFromBase('dry_meal_ticket', side);
      own.hand = [item];
      own.deck = ['onigiri_draw', 'fluid_pasta', 'onigiri_draw', 'fluid_pasta', 'general_student'].map(id => createCardFromBase(id, side));
      const denied = castImmediateItem(side, item, false);
      state.environment = makeBoardCard(createCardFromBase('cafeteria', side));
      const used = castImmediateItem(side, item, false);
      return { denied, used, hand: own.hand.map(c => c.baseId), deck: own.deck.map(c => c.baseId).sort(), events: state.deckVisualEvents };
    }, side);
    expect(result.denied).toBe(false);
    expect(result.used).toBe(true);
    expect(result.hand).toEqual(['onigiri_draw', 'fluid_pasta']);
    expect(result.deck).toEqual(['fluid_pasta', 'general_student', 'onigiri_draw']);
    expect(result.events.map(e => [e.type, e.count])).toEqual([['draw', 2], ['shuffle', 1]]);
    expect(result.events[0].centerReveal).toBe(true);
    for (const event of result.events) {
      expect(event).not.toHaveProperty('cards');
      expect(event).not.toHaveProperty('name');
      expect(event).not.toHaveProperty('baseId');
    }
  });
}

test('候補不足・0枚・手札上限・ドロー禁止でも余分なカードを引かない', async ({ page }) => {
  await setup(page);
  const result = await page.evaluate(() => {
    const own = state.players.player;
    const outcomes = [];
    for (const mode of ['short', 'empty', 'overflow', 'locked']) {
      pendingAnimations.length = 0;
      state.deckVisualEvents = [];
      state.deckToHandLocks = mode === 'locked' ? [{ owner: 'opponent', releaseAtActionTurn: 999 }] : [];
      state.battleHandLimit = 12;
      own.trash = [];
      own.hand = mode === 'overflow' ? Array.from({ length: 11 }, () => createCardFromBase('yuta', 'player')) : [];
      own.deck = (mode === 'empty' ? ['cafeteria'] : mode === 'short' ? ['general_teacher', 'cafeteria'] : ['general_student', 'general_teacher', 'ruler', 'cafeteria']).map(id => createCardFromBase(id, 'player'));
      const previous = own.hand.map(c => c.instanceId);
      const counts = pullDeckSearchBatch('player', ['student', 'teacher', 'item'].map(type => ({ predicate: c => c.type === type, count: 1 })));
      outcomes.push({ mode, counts, hand: own.hand.length, trash: own.trash.map(c => c.baseId),
        added: own.hand.filter(c => !previous.includes(c.instanceId)).map(c => c.instanceId),
        events: state.deckVisualEvents.map(e => ({ type: e.type, count: e.count, ids: e.cardIds })) });
    }
    return outcomes;
  });
  expect(result[0].counts).toEqual([0, 1, 0]);
  expect(result[0].events.map(e => [e.type, e.count])).toEqual([['draw', 1], ['shuffle', 1]]);
  expect(result[1].counts).toEqual([0, 0, 0]);
  expect(result[1].events.map(e => e.type)).toEqual(['shuffle']);
  expect(result[2].hand).toBe(12);
  expect(result[2].trash).toEqual(['general_teacher', 'ruler']);
  expect(result[2].events[0].ids).toEqual(result[2].added);
  expect(result[2].events.map(e => [e.type, e.count])).toEqual([['draw', 1], ['shuffle', 1]]);
  expect(result[3].counts).toEqual([0, 0, 0]);
  expect(result[3].hand).toBe(0);
  expect(result[3].events).toEqual([]);
});

test('ゲストと観戦者へ一括サーチを一度だけ同期し、相手のカード表面は隠す', async ({ page }) => {
  await setup(page);
  for (const role of ['guest', 'spectator']) {
    await page.evaluate(role => {
      state.training.skipAnimations = false;
      state.online.role = 'host'; state.online.enabled = true; state.online.started = true;
      const owner = 'player';
      state.players[owner].hand = [];
      state.players[owner].deck = ['general_student', 'general_teacher', 'ruler', 'cafeteria', 'cafeteria', 'cafeteria'].map(id => createCardFromBase(id, owner));
      const before = onlineCreateSnapshot();
      pullDeckSearchBatch(owner, ['student', 'teacher', 'item'].map(type => ({ predicate: c => c.type === type, count: 1 })));
      window.batchSnapshot = onlineCreateSnapshot(); pendingAnimations.length = 0;
      state.online.role = role;
      onlineHandleMessage({ type: 'gameState', protocol: 1, snapshot: { ...before, seq: state.online.lastSnapshotSeq + 1 } });
      onlineHandleMessage({ type: 'gameState', protocol: 1, snapshot: { ...window.batchSnapshot, seq: state.online.lastSnapshotSeq + 1 } });
    }, role);
    await expect(page.locator('.draw-flight[data-search-draw="true"]')).toHaveCount(3);
    await expect(page.locator('.draw-flight-front')).toHaveCount(0);
    await page.evaluate(() => onlineHandleMessage({ type: 'gameState', protocol: 1, snapshot: { ...window.batchSnapshot, seq: state.online.lastSnapshotSeq + 1 } }));
    await expect(page.locator('.draw-flight[data-search-draw="true"]')).toHaveCount(3);
    await expect(page.locator('.deck-flight[data-deck-phase="shuffle"]')).toHaveCount(3);
    await settled(page);
    await expect(page.locator('.draw-flight')).toHaveCount(0);
    await page.evaluate(() => { state.deckVisualEvents = []; });
  }
});
