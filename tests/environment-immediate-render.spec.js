const { test, expect } = require('@playwright/test');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const url = pathToFileURL(path.join(__dirname, '..', 'index.html')).href;

for (const side of ['player', 'opponent']) for (const env of ['gangi_fortress', 'student_council', 'building_12_classroom']) {
  test(`${side}の${env}が演出後すぐ両講義室へ反映される`, async ({ page }) => {
    await page.goto(url);
    await page.evaluate(({ side, env }) => {
      startCardTest('general_student'); scheduleOpponentAI = () => {};
      state.currentSide = side; state.environment = null;
      for (const owner of ['player', 'opponent']) {
        state.players[owner].board.seats.fill(null);
        state.players[owner].board.teacher = null;
        state.players[owner].board.seats[4] = makeBoardCard(createCardFromBase('general_student', owner));
      }
      const card = createCardFromBase(env, side);
      state.players[side].hand = [card]; render();
      placeCardFromHand(side, card.instanceId, 'environment', side, null, false);
      // This is what the AI does before waiting for the asynchronous placement.
      render();
    }, { side, env });
    await expect.poll(() => page.evaluate(() => state.pendingCardPlay)).toBeNull();
    await expect(page.locator('#environmentSlot')).toContainText(await page.evaluate(env => CARD_BASES[env].name, env));
    const stats = await page.evaluate(() => ['player', 'opponent'].map(side => {
      const c = state.players[side].board.seats[4];
      const node = document.querySelector(`[data-card-id="${c.instanceId}"]`);
      return { attack: c.attack, hp: c.currentHp, maxHp: c.maxHp, visible: node.textContent };
    }));
    for (const stat of stats) {
      expect(stat).toMatchObject(env === 'building_12_classroom' ? { attack: 1, hp: 2, maxHp: 2 } : { attack: 2, hp: 4, maxHp: 4 });
      expect(stat.visible).toContain(env === 'building_12_classroom' ? '1' : '4');
    }
    await page.screenshot({ path: test.info().outputPath(`${side}-${env}.png`) });
  });
}

test('TRPGの非同期出席後もドローを開始し、AIがターンを返せる', async ({ page }) => {
  await page.goto(url);
  await page.evaluate(() => {
    startCardTest('general_student'); scheduleOpponentAI = () => {};
    state.currentSide = 'opponent'; state.actionTurn = 6;
    state.players.opponent.turnsTaken = 3; state.players.opponent.will = state.players.opponent.maxWill = 3;
    state.players.opponent.hand = [createCardFromBase('trpg_member', 'opponent')];
    state.players.opponent.deck = Array.from({ length: 15 }, () => createCardFromBase('general_student', 'opponent'));
    state.players.opponent.board.seats.fill(null); state.players.opponent.board.teacher = null;
    render(); window.aiDone = false; runOpponentAI().then(() => { window.aiDone = true; });
  });
  await expect.poll(() => page.evaluate(() => window.aiDone), { timeout: 18000 }).toBe(true);
  expect(await page.evaluate(() => state.currentSide)).toBe('player');
});

for (const env of ['academic_move', 'full_lock', 'no_late_time', 'shogi_duel_field']) {
  test(`環境の配置時効果 ${env} は次のターンを待たずに発動する`, async ({ page }) => {
    await page.goto(url);
    await page.evaluate(env => {
      startCardTest('general_student'); scheduleOpponentAI = () => {};
      state.currentSide = 'opponent'; state.environment = null;
      for (const owner of ['player', 'opponent']) {
        const p = state.players[owner]; p.life = 20;
        p.board.seats.fill(null); p.board.teacher = null;
        const card = makeBoardCard(createCardFromBase('general_student', owner));
        card.attendanceEvent = { turn: state.actionTurn };
        p.board.seats[4] = card;
        p.late = [{ card: createCardFromBase('scout_student', owner), owner, zone: 'seat', index: 0, remaining: 2 }];
      }
      const card = createCardFromBase(env, 'opponent');
      state.players.opponent.hand = [card]; render();
      placeCardFromHand('opponent', card.instanceId, 'environment', 'opponent', null, false); render();
    }, env);
    await expect.poll(() => page.evaluate(() => state.pendingCardPlay)).toBeNull();
    await expect(page.locator('#environmentSlot')).toContainText(await page.evaluate(env => CARD_BASES[env].name, env));
    const result = await page.evaluate(() => ({
      boosted: ['player', 'opponent'].every(side => hasKeyword(state.players[side].board.seats[4], '超陽気')),
      blocked: ['player', 'opponent'].every(side => !isBoardSlotOpen(side, 'seat', 1)),
      arrived: ['player', 'opponent'].every(side => !state.players[side].late.length && state.players[side].board.seats[0]?.baseId === 'scout_student'),
      life: ['player', 'opponent'].map(side => state.players[side].life)
    }));
    if (env === 'academic_move') expect(result.boosted).toBe(true);
    if (env === 'full_lock') expect(result.blocked).toBe(true);
    if (env === 'no_late_time') {
      expect(result.arrived).toBe(true);
      await expect(page.locator('#playerLateZone')).toContainText('0人');
      await expect(page.locator('#opponentLateZone')).toContainText('0人');
    }
    if (env === 'shogi_duel_field') expect(result.life).toEqual([10, 10]);
  });
}
