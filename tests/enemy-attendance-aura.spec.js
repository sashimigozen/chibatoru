const { test, expect } = require('@playwright/test');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const gameUrl = pathToFileURL(path.join(__dirname, '..', 'index.html')).href;

test.beforeEach(async ({ page }) => {
  await page.goto(gameUrl);
  await page.evaluate(() => startCardTest('enemy_student'));
  await page.waitForFunction(() => !battleNewActionBlocked());
  await page.evaluate(() => {
    state.training.skipAnimations = true;
    state.environment = null;
    window.clearAuraFixture = () => {
      for (const side of ['player', 'opponent']) {
        state.players[side].board = { teacher: null, seats: Array(9).fill(null) };
        state.players[side].hand = []; state.players[side].deck = [];
        state.players[side].trash = []; state.players[side].attendancesThisTurn = 0;
      }
    };
    clearAuraFixture();
  });
});

for (const owner of ['player', 'opponent']) for (const zone of ['seat', 'teacher']) {
  test(`敵の出席直後にTRPGを反映する：${owner}・${zone}・全出席元`, async ({ page }) => {
    const results = await page.evaluate(({ owner, zone }) => {
      const opponent = oppositeSide(owner);
      return Object.values(ATTENDANCE_SOURCE).map(attendanceSource => {
        clearAuraFixture();
        const trpg = makeBoardCard(createCardFromBase('trpg_member', opponent));
        state.players[opponent].board.teacher = trpg;
        const enemy = makeBoardCard(createCardFromBase('enemy_student', owner));
        attendCard(owner, enemy, zone, zone === 'seat' ? 0 : null, { attendanceSource, skipLocalAttendEffects: true });
        const immediate = { attack: enemy.attack, cheerful: hasKeyword(enemy, '陽気') };
        applyBoardAuras(); applyBoardAuras();
        return { source: attendanceSource, immediate, repeated: enemy.attack, base: enemy.baseAttack };
      });
    }, { owner, zone });
    for (const result of results) expect(result).toMatchObject({
      immediate: { attack: 6, cheerful: true }, repeated: 6, base: 1
    });
  });
}

test('真の敵が出席させた敵も直後から攻撃力6になり、TRPGが離れると1へ戻る', async ({ page }) => {
  const results = await page.evaluate(() => ['player', 'opponent'].map(owner => {
    clearAuraFixture();
    const opponent = oppositeSide(owner);
    state.currentSide = owner;
    state.players[opponent].board.seats[0] = makeBoardCard(createCardFromBase('trpg_member', opponent));
    const source = makeBoardCard(createCardFromBase('true_enemy', owner));
    state.players[owner].board.seats[0] = source;
    state.players[owner].deck = [createCardFromBase('enemy_student', owner)];
    markCardAttackUsed(source);
    const enemy = state.players[owner].board.seats.find(card => card?.baseId === 'enemy_student');
    const immediate = { attack: enemy?.attack, cheerful: hasKeyword(enemy, '陽気'), haste: hasKeyword(enemy, '超陽気') };
    state.players[opponent].board.seats[0] = null;
    applyBoardAuras();
    return { immediate, removed: { attack: enemy?.attack, trpgAura: enemyStudentTrpgAuraActive(enemy), haste: hasKeyword(enemy, '超陽気') } };
  }));
  for (const result of results) expect(result).toEqual({
    immediate: { attack: 6, cheerful: true, haste: true }, removed: { attack: 1, trpgAura: false, haste: true }
  });
});

test('自分側だけにTRPGがいても敵は強化されない', async ({ page }) => {
  expect(await page.evaluate(() => {
    state.players.player.board.seats[0] = makeBoardCard(createCardFromBase('trpg_member', 'player'));
    const enemy = makeBoardCard(createCardFromBase('enemy_student', 'player'));
    attendCard('player', enemy, 'seat', 1, { attendanceSource: ATTENDANCE_SOURCE.GENERATED });
    return { attack: enemy.attack, cheerful: hasKeyword(enemy, '陽気') };
  })).toEqual({ attack: 1, cheerful: false });
});

test('TRPGが後から出席した場合も、席・教卓の敵へ即時に反映する', async ({ page }) => {
  const results = await page.evaluate(() => ['player', 'opponent'].flatMap(owner => ['seat', 'teacher'].map(zone => {
    clearAuraFixture();
    const enemy = makeBoardCard(createCardFromBase('enemy_student', owner));
    state.players[owner].board.seats[0] = enemy;
    const trpg = makeBoardCard(createCardFromBase('trpg_member', oppositeSide(owner)));
    attendCard(oppositeSide(owner), trpg, zone, zone === 'seat' ? 0 : null, {
      attendanceSource: ATTENDANCE_SOURCE.GENERATED, skipLocalAttendEffects: true
    });
    return { attack: enemy.attack, cheerful: hasKeyword(enemy, '陽気') };
  })));
  for (const result of results) expect(result).toEqual({ attack: 6, cheerful: true });
});
