const { test, expect } = require('@playwright/test');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const fs = require('node:fs');
const url = pathToFileURL(path.join(__dirname, '..', 'index.html')).href;

async function start(page, id = 'private_teacher', fromCatalog = false) {
  await page.goto(url);
  if (fromCatalog) {
    await page.locator('#homeNavDeckButton').click();
    await page.locator('[data-case-view="cards"]').click();
    await page.locator('#cardsCatalogSearch').fill('二等兵講師');
    await page.locator('[data-catalog-card="private_teacher"]').click();
    await page.locator('#cardTestStartButton').click();
  }
  await page.evaluate(({ id, fromCatalog }) => {
    if (!fromCatalog) startCardTest(id);
    scheduleOpponentAI = () => {};
    state.training.skipAnimations = true;
  }, { id, fromCatalog });
  await expect.poll(() => page.evaluate(() => battlePresentationBusy())).toBe(false);
}

for (const fused of [false, true]) test(`二等兵講師は融合が任意で、生成した学生も融合して出席できる ${fused}`, async ({ page }) => {
  await start(page, 'private_teacher', fused);
  if (fused) {
    await page.evaluate(() => showBattleCardPreview(state.players.player.hand.find(c => c.baseId === 'private_teacher')));
    await page.locator('[data-preview-any-hand-fusion]').click();
    await page.evaluate(() => {
      toggleCardChoiceCard(state.pendingCardChoice.cards.find(c => c.baseId === 'general_student').instanceId);
      confirmCardChoiceSelection();
    });
    await page.evaluate(() => showBattleCardPreview(state.players.player.hand.find(c => c.baseId === 'private_teacher')));
    await expect(page.locator('[data-preview-any-hand-fusion]')).toBeDisabled();
    await page.evaluate(() => hideBattleCardPreview());
  }
  expect(await page.evaluate(() => {
    const card = state.players.player.hand.find(c => c.baseId === 'private_teacher');
    return [card.attack, card.hp, hasKeyword(card, '陽気'), canPlaceCardSomewhere(card)];
  })).toEqual([fused ? 4 : 2, fused ? 4 : 2, fused, true]);
  await page.evaluate(() => {
    const c = state.players.player.hand.find(c => c.baseId === 'private_teacher');
    placeCardFromHand('player', c.instanceId, 'teacher', 'player', null, true);
  });
  await expect.poll(() => page.evaluate(() => battlePresentationBusy())).toBe(false);
  expect(await page.evaluate(() => {
    const p = state.players.player, c = p.board.teacher;
    return [c.attack, c.currentHp, p.hand.filter(c => c.baseId === 'exploding_student').length];
  })).toEqual([fused ? 4 : 2, fused ? 4 : 2, 2]);
  expect(await page.evaluate(() => {
    const p = state.players.player, token = p.hand.find(c => c.baseId === 'exploding_student');
    const blocked = placeCardFromHand('player', token.instanceId, 'seat', 'player', 4, false);
    fuseAnyHandCards('player', token.instanceId, [p.hand.find(c => c.baseId === 'ruler').instanceId], false);
    return [blocked, placeCardFromHand('player', token.instanceId, 'seat', 'player', 4, true)];
  })).toEqual([false, true]);
});

test('融合は1回だけで、コピーと校外での素材分解も保つ', async ({ page }) => {
  await start(page);
  expect(await page.evaluate(() => {
    const p = state.players.player, c = p.hand.find(c => c.baseId === 'private_teacher');
    fuseAnyHandCards('player', c.instanceId, [p.hand.find(c => c.baseId === 'ruler').instanceId], false);
    const twice = fuseAnyHandCards('player', c.instanceId, [p.hand.find(c => c.baseId === 'general_student').instanceId], false);
    const copy = copyHorseFusionProgress(c, createCardFromBase(c.baseId, 'player'));
    const stats = [copy.attack, copy.hp, hasKeyword(copy, '陽気')];
    moveToTrash('player', copy, { sourceZone: 'generated' });
    return [twice, stats, c.handFusionStored.length, p.trash.map(c => c.baseId).sort()];
  })).toEqual([false, [4, 4, true], 1, ['private_teacher', 'ruler']]);
});

test('効果による出席では生成しない', async ({ page }) => {
  await start(page);
  expect(await page.evaluate(() => {
    const p = state.players.player, before = p.hand.length;
    attendCard('player', makeBoardCard(createCardFromBase('private_teacher', 'player')), 'teacher', null, { attendanceSource: ATTENDANCE_SOURCE.GENERATED });
    return p.hand.length - before;
  })).toBe(0);
});

test('チュギデスは戦意6で出席でき、5では出席できない', async ({ page }) => {
  await start(page, 'chugidesu');
  expect(await page.evaluate(() => {
    const p = state.players.player, c = p.hand.find(c => c.baseId === 'chugidesu');
    fuseAnyHandCards('player', c.instanceId, p.hand.filter(c => ['ruler', 'general_student'].includes(c.baseId)).map(c => c.instanceId), false);
    p.will = 5;
    const blocked = placeCardFromHand('player', c.instanceId, 'seat', 'player', 4, false);
    p.will = 6;
    return [effectiveCardCost(c), blocked, placeCardFromHand('player', c.instanceId, 'seat', 'player', 4, true), p.will];
  })).toEqual([6, false, true, 0]);
});

test('本文・台帳・オンライン登録・並び順が一致する', async ({ page }) => {
  await start(page);
  const catalog = JSON.parse(fs.readFileSync(path.join(__dirname, '../server/card-catalog.json')));
  const ledger = JSON.parse(fs.readFileSync(path.join(__dirname, '../カード管理台帳.html'), 'utf8').match(/const CARDS = (\[[^\r\n]*\]);/)[1]);
  const card = ledger.find(c => c.id === 'private_teacher');
  expect(await page.evaluate(text => cardRulesText(createCardFromBase('private_teacher', 'player')) === formatCardRulesDisplayText(createCardFromBase('private_teacher', 'player'), text), card.effect)).toBe(true);
  expect(catalog.direct).toContain('private_teacher');
  expect(catalog.names.private_teacher).toBe('二等兵講師');
  expect(catalog.display.chugidesu.cost).toBe(6);
  expect(catalog.deckOrder).toEqual(await page.evaluate(() => getDeckEditorIds('')));
});

test('AIは教卓に融合済みの二等兵講師を出してターンを返す', async ({ page }) => {
  await start(page);
  await page.evaluate(() => {
    state.testMode = false;
    state.currentSide = 'opponent';
    state.aiThinking = true;
    const p = state.players.opponent;
    p.hand = ['private_teacher', 'ruler'].map(id => createCardFromBase(id, 'opponent'));
    p.will = p.maxWill = 4;
    runOpponentAI();
  });
  await expect.poll(() => page.evaluate(() => state.currentSide), { timeout: 15000 }).toBe('player');
  expect(await page.evaluate(() => {
    const p = state.players.opponent, c = p.board.teacher;
    return [c?.baseId, c?.attack, c?.currentHp, p.hand.filter(c => c.baseId === 'exploding_student').length];
  })).toEqual(['private_teacher', 4, 4, 2]);
});
