const { test, expect } = require('@playwright/test');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const root = path.join(__dirname, '..');
const url = pathToFileURL(path.join(root, 'index.html')).href;

async function setup(page) {
  await page.goto(url);
  await page.evaluate(() => {
    startCardTest('fire_touch');
    scheduleOpponentAI = () => {};
    state.training.skipAnimations = true;
  });
  await expect.poll(() => page.evaluate(() => battlePresentationBusy())).toBe(false);
  await page.evaluate(() => {
    state.preBattleToken += 1;
    Object.assign(state, { phase: 'battle', currentSide: 'player', actionTurn: 8,
      testMode: false, environment: null, gameOver: false, gameWinner: null, message: 'そのまま' });
    for (const side of ['player', 'opponent']) Object.assign(state.players[side], {
      hand: [], trash: [], life: 20, will: 10, maxWill: 10,
      board: { seats: Array(9).fill(null), teacher: null },
      deck: Array.from({ length: 8 }, () => createCardFromBase('general_student', side))
    });
  });
}

test('全カードの場所・支払量と6種類のドロー本文を現在の用語で表示する', async ({ page }) => {
  await page.goto(url);
  const texts = await page.evaluate(() => Object.fromEntries(Object.keys(CARD_BASES)
    .map(id => [id, cardRulesText(createCardFromBase(id, 'player'))])));
  for (const [id, text] of Object.entries(texts)) {
    expect(text, id).not.toMatch(/コスト|教師マス|(?:自分|相手|お互い)の場|場の出席者|本体に\d+ダメージ|気力を\d+失/);
  }
  for (const [id, expected] of Object.entries({
    angry_maker: '自分のデッキからカードを2枚引く。',
    elite_open_chatter: '相手はデッキからカードを3枚引く。',
    word_increaser: 'デッキの上からカードを7枚まで引く。',
    fire_touch: '自分の気力に4ダメージ。その後、自分のデッキからカードを3枚引く。',
    deck_without: '自分のデッキの上からカードを2枚引く。',
    gamma: 'デッキの上からカードを3枚引く。'
  })) expect(texts[id], id).toContain(expected);
  expect(texts.forbidden_book).toContain('自分の気力に3ダメージ。その後、相手の気力に5ダメージ。');
  expect(texts.ruler).toContain('出席者なら1ダメージを与え、相手本体なら相手の気力に1ダメージ。');
  expect(texts.double_diamond).toContain('相手本体を指名した場合、相手の気力に4ダメージ。');
  expect(texts.group_sniper).toContain('相手本体なら相手の気力に2ダメージ。');
});

test('戦意不足では警告を追加せず、手札・戦意・盤面を維持して使用を止める', async ({ page }) => {
  await setup(page);
  const rows = await page.evaluate(() => {
    const own = state.players.player;
    own.will = 0;
    return ['item', 'attendee', 'choice', 'threeGestures'].map(kind => {
      const id = { item: 'fire_touch', attendee: 'general_student', choice: 'king_ghidorah_bed', threeGestures: 'three_gestures' }[kind];
      const card = createCardFromBase(id, 'player'); own.hand = [card];
      state.message = 'そのまま'; state.pendingCardChoice = null;
      const snapshot = () => JSON.stringify({ hand: own.hand.map(c => c.instanceId), will: own.will, board: own.board, life: own.life, deck: own.deck.map(c => c.instanceId), log: state.log, message: state.message });
      const before = snapshot();
      if (kind === 'item') payForItem('player', card);
      if (kind === 'attendee') placeCardFromHand('player', card.instanceId, 'seat', 'player', 0, false);
      if (kind === 'choice') openKingGhidorahBedChoice(card);
      if (kind === 'threeGestures') openThreeGesturesSelection(card);
      return { kind, unchanged: snapshot() === before, choice: state.pendingCardChoice };
    });
  });
  await expect(page.locator('.slot[data-zone="teacher"][data-owner="player"]')).toHaveAttribute('data-label', '自分 教卓マス');
  expect(rows).toEqual(['item', 'attendee', 'choice', 'threeGestures'].map(kind => ({ kind, unchanged: true, choice: null })));
});

for (const shielded of [false, true]) test(`火に触れてしまう：自傷後に3枚を引く、ダメージ無効=${shielded}`, async ({ page }) => {
  await setup(page);
  const result = await page.evaluate(shielded => {
    const own = state.players.player;
    own.lifeShieldUntilTurn = shielded ? state.actionTurn + 2 : 0;
    own.lifeShieldUntilSide = shielded ? 'player' : null;
    const item = createCardFromBase('fire_touch', 'player'); own.hand = [item];
    const used = castImmediateItem('player', item, false);
    return { used, life: own.life, will: own.will, drawn: own.hand.map(c => c.baseId),
      remaining: own.deck.length, trash: own.trash.map(c => c.baseId) };
  }, shielded);
  expect(result).toEqual({ used: true, life: shielded ? 20 : 16, will: 7,
    drawn: Array(3).fill('general_student'), remaining: 5, trash: ['fire_touch'] });
});

for (const id of ['ruler', 'double_diamond']) test(`${id}：本体への指名と出席者への指名のダメージ量を維持する`, async ({ page }) => {
  await setup(page);
  const result = await page.evaluate(id => {
    const own = state.players.player, foe = state.players.opponent;
    const first = createCardFromBase(id, 'player'); own.hand = [first];
    const lifeUsed = castItemOnLife('player', first, 'opponent', false);
    const life = foe.life;
    const target = makeBoardCard(createCardFromBase('general_student', 'opponent'));
    target.currentHp = target.maxHp = target.baseMaxHp = 10;
    foe.board.seats[0] = target;
    const second = createCardFromBase(id, 'player'); own.hand = [second];
    const cardUsed = castItemOnCard('player', second, 'opponent', 'seat', 0, false);
    return { lifeUsed, cardUsed, life, hp: target.currentHp };
  }, id);
  expect(result).toEqual({ lifeUsed: true, cardUsed: true,
    life: id === 'ruler' ? 19 : 16, hp: id === 'ruler' ? 9 : 6 });
});
