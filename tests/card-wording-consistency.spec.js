const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const root = path.join(__dirname, '..');
const url = pathToFileURL(path.join(root, 'index.html')).href;
const rules = Object.fromEntries(fs.readFileSync(path.join(root, 'card_rules.txt'), 'utf8')
  .split('\n').flatMap(line => {
    const match = line.match(/^\s*(\w+): (".*"),?$/);
    return match ? [[match[1], JSON.parse(match[2])]] : [];
  }));

test('現在の表示本文・原稿・管理台帳と今回の更新情報が一致する', async ({ page }) => {
  await page.goto(url);
  const result = await page.evaluate(rules => {
    const release = UPDATE_HISTORY.find(entry => entry.version === 'ver.0.45.4');
    const rows = Object.entries(CARD_BASES).map(([id, base]) => {
      const card = createCardFromBase(id, 'player');
      return { id, name: base.name, text: cardRulesText(card),
        raw: formatCardRulesDisplayText(card, attendanceRuleText(card, rules[id])) };
    });
    return { rows, changes: release.changes.filter(change => change.before && change.after) };
  }, rules);
  for (const row of result.rows) {
    expect(row.text.replace(/\n出席数：0人$/, ''), row.name).toBe(row.raw);
    expect(row.text, row.name).not.toContain('と名のつく');
  }
  await page.goto(pathToFileURL(path.join(root, 'カード管理台帳.html')).href);
  const ledger = await page.evaluate(() => CARDS.map(card => ({ id: card.id, text: card.effect })));
  await page.goto(url);
  for (const change of result.changes.filter(change => change.title !== '斥候学生')) {
    const row = result.rows.find(row => row.name === change.title);
    expect(row, change.title).toBeTruthy();
    expect(change.after.slice(change.after.indexOf('\n') + 1), change.title).toBe(row.text);
    const entry = ledger.find(entry => entry.id === row.id);
    expect(entry, change.title).toBeTruthy();
    const text = await page.evaluate(({ id, raw }) => {
      const card = createCardFromBase(id, 'player');
      return formatCardRulesDisplayText(card, attendanceRuleText(card, raw));
    }, { id: row.id, raw: entry.text });
    expect(text, change.title).toBe(row.text);
  }
});

test('人物の指名とカード・マスの選択を区別し、出席と進化も分ける', async ({ page }) => {
  await page.goto(url);
  const text = await page.evaluate(() => Object.fromEntries(Object.keys(CARD_BASES)
    .map(id => [id, cardRulesText(createCardFromBase(id, 'player'))])));
  for (const id of ['short_sleeve_student', 'secretly_mocked_student', 'pinige',
    'sports_spectator_student', 'could_not_escape_student', 'wonton_fever', 'two_achievers', 'door_war']) {
    expect(text[id], id).toContain('ランダムに指名し');
  }
  expect(text.hapa_english).toContain('出席者カード1枚をランダムに選び');
  expect(text.proliferating_enemy).toContain('空いている席マス1つをランダムに選び');
  expect(text.scary_question).toContain('自分のデッキからカードを1枚引く。');
  expect(text.pinige).toContain('自分のデッキから[点数]を持つ学生2枚を手札に加える。');
  expect(text.pinige).toContain('自分のデッキから「ピニゲ」1枚を手札に加える。');
  for (const id of ['sports_spectator_student', 'gecko_carrier_student', 'adjective_vs_cynical',
    'cornering_lecturer', 'two_achievers', 'environment_setup', 'amphisbaena_sofa']) {
    expect(text[id], id).toContain('2つの効果から1つを選んで使用する。');
  }
  expect(text.adjective_vs_cynical).toContain('このカードを手札から出席させたとき、');
  expect(text.loud_members).toContain('手札から出席させた時、');
  expect(text.sick_yuta).toContain('進化時、');
  expect(text.recovered_dark_yuta).toContain('進化時、');
});

test('通常ドローは上から取り、サーチは対象だけを加えてシャッフルする', async ({ page }) => {
  await page.goto(url);
  const result = await page.evaluate(() => {
    startCardTest('short_sleeve_student');
    scheduleOpponentAI = () => {};
    state.training.skipAnimations = true;
    state.deckToHandLocks = [];
    const own = state.players.player;
    own.hand = [];
    own.deck = ['general_student', 'general_teacher', 'yuta', 'onigiri_draw']
      .map(id => createCardFromBase(id, 'player'));
    state.deckVisualEvents = [];
    drawOne('player', false);
    const drawn = own.hand.map(card => card.baseId);
    const eventsAfterDraw = state.deckVisualEvents.map(event => event.type);
    pullCardsFromDeck('player', 'yuta', 1);
    return { drawn, eventsAfterDraw, hand: own.hand.map(card => card.baseId),
      deck: own.deck.map(card => card.baseId).sort(), events: state.deckVisualEvents.map(event => event.type) };
  });
  expect(result).toEqual({ drawn: ['general_student'], eventsAfterDraw: ['draw'],
    hand: ['general_student', 'yuta'], deck: ['general_teacher', 'onigiri_draw'],
    events: ['draw', 'draw', 'shuffle'] });
});

test('ランダムな人物への指名は超注目を優先し、手動選択に変わらない', async ({ page }) => {
  await page.goto(url);
  await page.evaluate(() => {
    startCardTest('short_sleeve_student');
    scheduleOpponentAI = () => {};
    state.training.skipAnimations = true;
  });
  await expect.poll(() => page.evaluate(() => battlePresentationBusy())).toBe(false);
  await page.evaluate(() => {
    state.phase = 'battle'; state.currentSide = 'player'; state.actionTurn = 8;
    state.players.player.pointScore = 0;
    state.players.player.board = { seats: Array(9).fill(null), teacher: null };
    state.players.opponent.board = { seats: Array(9).fill(null), teacher: null };
    state.players.opponent.trash = [];
    state.players.opponent.board.seats[0] = makeBoardCard(createCardFromBase('general_student', 'opponent'));
    state.players.opponent.board.seats[8] = makeBoardCard(createCardFromBase('super_ae_student', 'opponent'));
    attendCard('player', makeBoardCard(createCardFromBase('short_sleeve_student', 'player')),
      'seat', 4, { attendanceSource: 'hand' });
  });
  await expect.poll(() => page.evaluate(() => fusionTasksBusy())).toBe(false);
  expect(await page.evaluate(() => ({ pending: state.pendingCardChoice,
    normalHp: state.players.opponent.board.seats[0].currentHp,
    destroyed: state.players.opponent.trash.map(card => card.baseId) })))
    .toEqual({ pending: null, normalHp: 2, destroyed: ['super_ae_student'] });
});
