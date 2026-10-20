const { test, expect } = require('@playwright/test');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
test.beforeEach(async ({ page }) => {
  await page.goto(pathToFileURL(path.join(__dirname, '..', 'index.html')).href);
  await page.evaluate(() => {
    startCardTest('hearty_grandma'); scheduleOpponentAI = () => {};
    state.training.skipAnimations = true; state.phase = 'battle'; state.actionTurn = 8;
    state.currentSide = 'player'; state.environment = null;
    for (const side of ['player', 'opponent']) Object.assign(state.players[side], {
      board: { teacher: null, seats: Array(9).fill(null) }, hand: [], deck: [], trash: [],
      will: 20, maxWill: 20, life: 10, attendancesThisTurn: 0
    });
  });
});
test('全文・能力値・食堂分類・デッキ登録・用語説明が一致する', async ({ page }) => {
  const result = await page.evaluate(() => {
    const card = createCardFromBase('hearty_grandma', 'player');
    return { text: cardRulesText(card), stats: [card.cost, card.attack, card.hp],
      type: card.type, zones: card.allowedZones,
      specialty: SPECIALTY_CARD_IDS.cafeteria.includes(card.baseId),
      deck: DIRECT_DECK_CARD_IDS.has(card.baseId),
      help: BATTLE_CARD_TERM_DESCRIPTIONS['超吸血'],
      markup: battleCardRulesMarkup(card) };
  });
  expect(result.text).toBe('[超吸血]\n環境が「食堂」であるかぎり、このカードの戦意を-2し、[陽気]を持つ。');
  expect(result.stats).toEqual([3, 2, 2]);
  expect(result.type).toBe('vampire');
  expect(result.zones).toEqual(['teacher', 'seat']);
  expect(result.specialty && result.deck).toBe(true);
  expect(result.help).toContain('自分本体の気力を回復');
  expect(result.markup).toContain('超吸血');
});
for (const side of ['player', 'opponent']) {
  test('食堂の設置・張り替えに戦意と陽気が追従 ' + side, async ({ page }) => {
    const result = await page.evaluate(side => {
      const card = createCardFromBase('hearty_grandma', side);
      state.players[side].hand = [card];
      const inspect = () => [effectiveCardCost(card), hasKeyword(card, '陽気'), hasKeyword(card, '超吸血')];
      const before = inspect();
      state.environment = createCardFromBase('cafeteria', side);
      const cafeteria = inspect();
      const board = makeBoardCard(card);
      state.players[side].board.seats[0] = board;
      const canAttackNow = canAttackSilently(board);
      state.environment = createCardFromBase('classroom', side);
      return { before, cafeteria, after: inspect(), boardCheerful: hasKeyword(board, '陽気'), canAttackNow };
    }, side);
    expect(result).toMatchObject({ before: [3, false, true], cafeteria: [1, true, true],
      after: [3, false, true], boardCheerful: false });
  });
  test('出席者への攻撃は本体だけ回復 ' + side, async ({ page }) => {
    const result = await page.evaluate(side => {
      const card = makeBoardCard(createCardFromBase('hearty_grandma', side));
      state.players[side].board.seats[0] = card;
      const target = makeBoardCard(createCardFromBase('general_student', oppositeSide(side)));
      target.attack = 0; state.players[oppositeSide(side)].board.seats[0] = target;
      card.currentHp = 1;
      resolveCardAttack(card, target);
      return { life: state.players[side].life, hp: card.currentHp };
    }, side);
    expect(result).toEqual({ life: 12, hp: 1 });
  });
  test('本体攻撃・回復上限・0ダメージ ' + side, async ({ page }) => {
    const result = await page.evaluate(side => {
      const card = makeBoardCard(createCardFromBase('hearty_grandma', side));
      state.players[side].board.seats[0] = card;
      card.currentHp = 1; state.players[side].life = 19;
      resolveLifeAttack(card, oppositeSide(side));
      const capped = state.players[side].life;
      state.players[side].life = 10; card.attack = 0;
      resolveLifeAttack(card, oppositeSide(side));
      return { capped, life: state.players[side].life, hp: card.currentHp };
    }, side);
    expect(result).toEqual({ capped: 20, life: 10, hp: 1 });
  });
  test('実ダメージ分だけ回復し、通常の吸血は維持 ' + side, async ({ page }) => {
    const result = await page.evaluate(side => {
      const card = makeBoardCard(createCardFromBase('hearty_grandma', side));
      const target = makeBoardCard(createCardFromBase('general_student', oppositeSide(side)));
      state.players[side].board.seats[0] = card;
      state.players[oppositeSide(side)].board.seats[0] = target;
      target.currentHp = 1; target.attack = 0; card.currentHp = 1;
      resolveCardAttack(card, target);
      const superLife = state.players[side].life;
      const normal = makeBoardCard(createCardFromBase('cafeteria_lady', side));
      normal.currentHp = 1; healVampireFromDamage(normal, 2);
      return { superLife, superHp: card.currentHp, normalHp: normal.currentHp, lifeAfter: state.players[side].life };
    }, side);
    expect(result).toEqual({ superLife: 11, superHp: 1, normalHp: 2, lifeAfter: 11 });
  });
}
test('反撃で倒れる前に超吸血が働き、南京錠中は通常吸血にも戻らない', async ({ page }) => {
  const result = await page.evaluate(() => {
    const card = makeBoardCard(createCardFromBase('hearty_grandma', 'player'));
    const target = makeBoardCard(createCardFromBase('general_student', 'opponent'));
    state.players.player.board.seats[0] = card;
    state.players.opponent.board.seats[0] = target;
    card.currentHp = 1; target.attack = 1;
    resolveCardAttack(card, target);
    const combat = [state.players.player.life, card.currentHp];
    const locked = makeBoardCard(createCardFromBase('hearty_grandma', 'player'));
    locked.currentHp = 1; locked.padlockEquipment = { baseId: 'padlock' };
    const healed = healVampireFromDamage(locked, 2);
    return { combat, healed, hp: locked.currentHp, life: state.players.player.life };
  });
  expect(result).toEqual({ combat: [12, 0], healed: 0, hp: 1, life: 12 });
});
test('オンライン視点変換後も回復先は自分本体', async ({ page }) => {
  const result = await page.evaluate(() => {
    const card = makeBoardCard(createCardFromBase('hearty_grandma', 'player'));
    state.players.player.board.seats[0] = card;
    const guest = makeBoardCard(onlineSwapOwnersDeep(onlineCreateSnapshot().state.players.player.board.seats[0]));
    guest.currentHp = 1; state.players.opponent.board.seats[0] = guest;
    healVampireFromDamage(guest, 2);
    return { owner: guest.owner, player: state.players.player.life, opponent: state.players.opponent.life, hp: guest.currentHp };
  });
  expect(result).toEqual({ owner: 'opponent', player: 10, opponent: 12, hp: 1 });
});
