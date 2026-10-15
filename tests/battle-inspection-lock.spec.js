const { test, expect } = require('@playwright/test');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const url = pathToFileURL(path.join(__dirname, '..', 'index.html')).href;

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(url);
  await page.evaluate(() => {
    startCardTest('general_student');
    scheduleOpponentAI = () => {};
    state.players.player.hand = ['ruler', 'ruler', 'yuta'].map(id => createCardFromBase(id, 'player'));
    state.players.player.trash = ['diamond_dust', 'general_teacher'].map(id => createCardFromBase(id, 'player'));
    state.players.opponent.trash = [createCardFromBase('general_student', 'opponent')];
    state.players.opponent.late = [{ card: createCardFromBase('scout_student', 'opponent'), zone: 'seat', index: 1, remaining: 1 }];
    state.log = ['一般学生を確認'];
    render();
    // Detail rendering normalizes absent legacy equipment fields to empty
    // values. Compare gameplay values rather than that object shape.
    window.captureRuleSnapshot = () => {
      const card = c => c && ({ id: c.instanceId, base: c.baseId, owner: c.owner,
        attack: c.attack, hp: c.currentHp, maxHp: c.maxHp, defense: c.defense,
        modifiers: c.statModifiers, keywords: c.keywordSources,
        attacks: c.attacksUsedThisTurn, attacked: c.hasAttacked,
        equipment: c.yutaEquipments || [], illness: c.illnessEquipments || [] });
      return JSON.stringify({ players: Object.fromEntries(['player', 'opponent'].map(side => {
        const p = state.players[side];
        return [side, { life: p.life, will: p.will, maxWill: p.maxWill,
          hand: p.hand.map(card), deck: p.deck.map(card), trash: p.trash.map(card),
          late: p.late.map(e => ({ card: card(e.card), remaining: e.remaining, zone: e.zone, index: e.index })),
          seats: p.board.seats.map(card), teacher: card(p.board.teacher) }];
      })), turn: state.actionTurn, side: state.currentSide, selected: state.selectedHandId,
        attacker: state.selectedAttacker, choice: state.pendingCardChoice });
    };
  });
  await expect.poll(() => page.evaluate(() => battlePresentationBusy())).toBe(false);
});

async function closePreview(page) {
  await page.locator('#battleCardPreview').click({ position: { x: 2, y: 2 } });
  await expect(page.locator('#battleCardPreview')).toBeHidden();
}

for (const lock of ['check', 'drawQueue', 'onlineGuest']) {
  test(`${lock}中も各エリアを確認でき、対戦状態は変わらない`, async ({ page }) => {
    await page.evaluate(lock => {
      if (lock === 'check') { state.lectureRoomCheck = true; state.lectureRoomCheckToken = state.preBattleToken; }
      if (lock === 'drawQueue') queuedBattlePresentations += 1;
      if (lock === 'onlineGuest') {
        state.online.enabled = true; state.online.role = 'guest'; state.online.started = true;
        state.remoteResolutionPending = true;
      }
      window.ruleSnapshot = window.captureRuleSnapshot();
    }, lock);
    await page.locator('#playerDeckPile').hover();
    await page.mouse.down();
    await page.waitForTimeout(650);
    await page.mouse.up();
    await page.locator('#deckInspectButton').click();
    await expect(page.locator('#deckModal')).toBeVisible();
    await page.locator('#deckModalClose').click();
    await expect(page.locator('#deckModal')).toBeHidden();
    await page.locator('#battleMenuButton').click();
    await expect(page.locator('#battleMenuDrawer')).toHaveAttribute('aria-hidden', 'false');
    await page.locator('#battleMenuCloseButton').click();
    await expect(page.locator('#battleMenuDrawer')).toHaveAttribute('aria-hidden', 'true');
    await page.locator('#playerHand .card').first().click();
    await expect(page.locator('#battleCardPreview')).toContainText('定規');
    await page.locator('[data-preview-ruler-fuse]').dispatchEvent('click');
    expect(await page.evaluate(() => state.pendingCardChoice)).toBeNull();
    await closePreview(page);
    // Ready attendees use a click for attack reservation; their existing press
    // inspection must remain available without changing the reservation.
    await page.locator('#playerSeatGrid [data-battle-inspect-card]').first().hover();
    await page.mouse.down();
    await page.waitForTimeout(650);
    await expect(page.locator('#cardTooltip')).toContainText('一般学生');
    await page.mouse.up();
    await page.mouse.move(5, 5);
    await expect(page.locator('#cardTooltip')).toBeHidden();
    await page.locator('#opponentSeatGrid [data-battle-inspect-card]').first().click();
    await expect(page.locator('#battleCardPreview')).toBeVisible();
    await closePreview(page);
    for (const side of ['player', 'opponent']) {
      await page.locator(`#${side}TrashButton`).click();
      await expect(page.locator('#battleDrawerTitle')).toContainText('校外');
      await page.locator('[data-inspector-filter="student"]').click();
      await page.locator('[data-inspector-filter="all"]').click();
      const inspectId = await page.evaluate(side => state.players[side].trash.find(card => side !== 'player' || card.baseId === 'diamond_dust').instanceId, side);
      await page.locator(`[data-inspector-card="${inspectId}"]`).click();
      await expect(page.locator('#battleCardPreview')).toBeVisible();
      if (side === 'player') {
        await expect(page.locator('[data-preview-diamond-dust-recovery]')).toBeVisible();
        await page.locator('[data-preview-diamond-dust-recovery]').dispatchEvent('click');
        expect(await page.evaluate(() => state.pendingCardChoice)).toBeNull();
      }
      await closePreview(page);
      await page.locator('#battleLogCloseButton').click();
      await page.locator(`#${side}ActiveEffectsButton`).click();
      await expect(page.locator('#battleDrawerTitle')).toContainText('継続効果');
      await page.locator('#battleLogCloseButton').click();
    }
    await page.locator('#opponentLateZone .late-zone-label').click();
    await expect(page.locator('#battleDrawerTitle')).toContainText('遅刻ゾーン');
    await page.locator('[data-inspector-card]').click();
    await expect(page.locator('#battleCardPreview')).toContainText('斥候学生');
    await page.screenshot({ path: test.info().outputPath(`inspection-${lock}.png`) });
    await closePreview(page);
    await page.locator('#battleLogCloseButton').click();
    await page.locator('#endTurnButton').dispatchEvent('click');
    await page.locator('#battleConcedeButton').dispatchEvent('click');
    expect(await page.evaluate(() => window.captureRuleSnapshot()))
      .toBe(await page.evaluate(() => window.ruleSnapshot));
    expect(await page.evaluate(() => battleNewActionBlocked())).toBe(true);
  });
}

test('必要なカード選択は確認用クリックへ置き換えない', async ({ page }) => {
  await page.evaluate(() => {
    openCardChoice({ mode: 'logic_hunter', title: '選択', cards: state.players.player.hand, min: 1, max: 1 });
  });
  await page.locator('#threeGesturesStage [data-battle-inspect-card]').first().click();
  expect(await page.evaluate(() => state.pendingCardChoice.selectedIds.length)).toBe(1);
  await expect(page.locator('#battleCardPreview')).toBeHidden();
});
