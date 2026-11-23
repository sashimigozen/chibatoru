const { test, expect } = require('@playwright/test');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const url = pathToFileURL(path.join(__dirname, '..', 'index.html')).href;

async function setup(page) {
  await page.goto(url);
  await page.evaluate(() => {
    startCardTest('scout_student'); scheduleOpponentAI = () => {};
    state.training.skipAnimations = true; render();
  });
  await expect.poll(() => page.evaluate(() => battlePresentationBusy()), { timeout: 15000 }).toBe(false);
}

test('通常のカードテストで陽気の出席者攻撃から超陽気の本体攻撃まで試せる', async ({ page }) => {
  await setup(page);
  const initial = await page.evaluate(() => ({
    count: state.players.player.hand.filter(c => c.baseId === 'scout_student').length,
    enemy: state.players.opponent.board.seats[0].baseId
  }));
  expect(initial).toEqual({ count: 2, enemy: 'general_student' });
  expect(await page.evaluate(() => cardRulesText(state.players.player.hand[0])))
    .toBe('[陽気]\nこのカードが出席したとき、相手の講義室に出席者がいないなら、[超陽気]を持つ。');
  await page.evaluate(() => placeCardFromHand('player', state.players.player.hand.find(c => c.baseId === 'scout_student').instanceId, 'seat', 'player', 0, true));
  await expect.poll(() => page.evaluate(() => battlePresentationBusy()), { timeout: 15000 }).toBe(false);
  const normal = await page.evaluate(async () => {
    const card = state.players.player.board.seats[0];
    const before = state.players.opponent.life;
    state.selectedAttacker = { owner: 'player', zone: 'seat', index: 0 };
    await attackLifeForCurrentSide('opponent');
    return { cheerful: hasKeyword(card, '陽気'), super: hasKeyword(card, '超陽気'), canAttack: canAttack(card), used: cardAttacksUsedThisTurn(card), damage: before - state.players.opponent.life };
  });
  expect(normal).toEqual({ cheerful: true, super: false, canAttack: true, used: 0, damage: 0 });
  await page.evaluate(async () => {
    state.selectedAttacker = { owner: 'player', zone: 'seat', index: 0 };
    await attackCard('opponent', 'seat', 0);
  });
  await expect.poll(() => page.evaluate(() => listBoardRefs('opponent').length)).toBe(0);
  await expect.poll(() => page.evaluate(() => battlePresentationBusy()), { timeout: 15000 }).toBe(false);
  await page.evaluate(() => placeCardFromHand('player', state.players.player.hand.find(c => c.baseId === 'scout_student').instanceId, 'seat', 'player', 1, true));
  await expect.poll(() => page.evaluate(() => battlePresentationBusy()), { timeout: 15000 }).toBe(false);
  const promoted = await page.evaluate(async () => {
    const card = state.players.player.board.seats[1], before = state.players.opponent.life;
    const superCheerful = hasKeyword(card, '超陽気');
    state.selectedAttacker = { owner: 'player', zone: 'seat', index: 1 };
    await attackLifeForCurrentSide('opponent');
    const once = before - state.players.opponent.life;
    state.selectedAttacker = { owner: 'player', zone: 'seat', index: 1 };
    await attackLifeForCurrentSide('opponent');
    return { superCheerful, once, total: before - state.players.opponent.life, used: cardAttacksUsedThisTurn(card) };
  });
  expect(promoted).toEqual({ superCheerful: true, once: 2, total: 2, used: 1 });
  await page.screenshot({ path: test.info().outputPath('scout-cheerful.png') });
});

for (const side of ['player', 'opponent']) test(`${side}は出席時だけ条件を判定し、以後の盤面変化では能力が変わらない`, async ({ page }) => {
  await setup(page);
  const result = await page.evaluate(side => {
    const enemy = oppositeSide(side);
    for (const owner of [side, enemy]) state.players[owner].board = { seats: Array(9).fill(null), teacher: null };
    state.currentSide = side;
    const inHand = createCardFromBase('scout_student', side);
    const hand = { cheerful: hasKeyword(inHand, '陽気'), super: hasKeyword(inHand, '超陽気'), aiFace: aiCardCanAttackLifeOnAttendance(inHand, side) };
    state.players[enemy].board.teacher = makeBoardCard(createCardFromBase('general_teacher', enemy));
    const aiOccupied = aiCardCanAttackLifeOnAttendance(inHand, side);
    const normal = makeBoardCard(inHand);
    attendCard(side, normal, 'seat', 0, { attendanceSource: ATTENDANCE_SOURCE.HAND });
    const normalReady = canAttack(normal) && hasKeyword(normal, '陽気') && !hasKeyword(normal, '超陽気');
    state.players[enemy].board.teacher = null;
    const noLatePromotion = !hasKeyword(normal, '超陽気');
    const promoted = makeBoardCard(createCardFromBase('scout_student', side));
    attendCard(side, promoted, 'seat', 1, { attendanceSource: ATTENDANCE_SOURCE.HAND });
    const gained = hasKeyword(promoted, '超陽気');
    state.players[enemy].board.seats[4] = makeBoardCard(createCardFromBase('general_student', enemy));
    const retained = hasKeyword(promoted, '超陽気');
    return { hand, aiOccupied, normalReady, noLatePromotion, gained, retained };
  }, side);
  expect(result).toEqual({ hand: { cheerful: true, super: false, aiFace: true }, aiOccupied: false, normalReady: true, noLatePromotion: true, gained: true, retained: true });
});

test('効果による出席も出席時に判定し、移動では判定し直さない', async ({ page }) => {
  await setup(page);
  const result = await page.evaluate(() => {
    for (const side of ['player', 'opponent']) state.players[side].board = { seats: Array(9).fill(null), teacher: null };
    const outcomes = [];
    for (const [index, source] of [ATTENDANCE_SOURCE.GENERATED, ATTENDANCE_SOURCE.COPY, ATTENDANCE_SOURCE.TRASH].entries()) {
      const card = makeBoardCard(createCardFromBase('scout_student', 'player'));
      attendCard('player', card, 'seat', index, { attendanceSource: source });
      outcomes.push(hasKeyword(card, '超陽気'));
    }
    state.players.opponent.board.teacher = makeBoardCard(createCardFromBase('general_teacher', 'opponent'));
    const normal = makeBoardCard(createCardFromBase('scout_student', 'player'));
    attendCard('player', normal, 'seat', 4, {attendanceSource: ATTENDANCE_SOURCE.EFFECT});
    state.players.opponent.board.teacher = null;
    const moved = moveAttendee(movementEntryAt({owner:'player',zone:'seat',index:4}),
      {owner:'player',zone:'seat',index:5}, createCardFromBase('physical_sky','player'));
    return { outcomes, moved, notPromotedByMove: !hasKeyword(normal,'超陽気') };
  });
  expect(result).toEqual({ outcomes: [true, true, true], moved:true, notPromotedByMove: true });
});

test('オンラインのゲストにも出席時に獲得した超陽気を保持して同期する', async ({ page }) => {
  await setup(page);
  const result = await page.evaluate(() => {
    state.online.role = 'host'; state.online.enabled = true; state.online.started = true;
    state.players.player.board = { seats: Array(9).fill(null), teacher: null };
    state.players.opponent.board = { seats: Array(9).fill(null), teacher: null };
    const promoted = makeBoardCard(createCardFromBase('scout_student', 'opponent'));
    attendCard('opponent', promoted, 'seat', 0, { attendanceSource: ATTENDANCE_SOURCE.HAND });
    state.players.player.board.teacher = makeBoardCard(createCardFromBase('general_teacher', 'player'));
    const normal = makeBoardCard(createCardFromBase('scout_student', 'opponent'));
    attendCard('opponent', normal, 'seat', 1, { attendanceSource: ATTENDANCE_SOURCE.HAND });
    const occupied = onlineCreateSnapshot();
    state.players.player.board.teacher = null;
    const empty = onlineCreateSnapshot(); state.online.role = 'guest';
    const snapshots = [];
    for (const snapshot of [occupied, empty, occupied]) {
      onlineHandleMessage({ type: 'gameState', protocol: 1, snapshot: { ...snapshot, seq: state.online.lastSnapshotSeq + 1 } });
      snapshots.push(state.players.player.board.seats.slice(0,2).map(card => ({ cheerful: hasKeyword(card, '陽気'), super: hasKeyword(card, '超陽気'), attack: card.attack, hp: card.currentHp })));
    }
    return snapshots;
  });
  expect(result).toEqual(Array.from({length:3},()=>[
    {cheerful:true, super:true, attack:2, hp:1}, {cheerful:true, super:false, attack:2, hp:1}
  ]));
});
