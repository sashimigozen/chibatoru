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
  }
  const affected = ['footkiri', 'wonton_ki', 'pinige', 'two_achievers', 'best_friend',
    'trpg_member', 'lightning_n', 'curry_treater', 'think_so', 'environment_setup',
    'iv_pack', 'dry_meal_ticket', 'pure_destruction', 'childhood_memory_tutuapp',
    'efficient_experiment_method', 'sexual_eye', 'dorm_council', 'shukii',
    'course_registration_party', 'yamanashi_minimum_wage'];
  for (const id of affected) {
    const row = result.rows.find(row => row.id === id);
    const entry = ledger.find(entry => entry.id === id);
    expect(entry, row.name).toBeTruthy();
    const text = await page.evaluate(({ id, raw }) => {
      const card = createCardFromBase(id, 'player');
      return formatCardRulesDisplayText(card, attendanceRuleText(card, raw));
    }, { id, raw: entry.text });
    expect(text, row.name).toBe(row.text);
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
  expect(text.pinige).toContain('自分のデッキから[点数]を持つ学生2枚を引く。');
  expect(text.pinige).toContain('自分のデッキから「ピニゲ」1枚を引く。');
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

test('内容を見ずに取るサーチは引く、確認した候補からは手札に加えると表記する', async ({ page }) => {
  await page.goto(url);
  const text = await page.evaluate(() => Object.fromEntries(Object.keys(CARD_BASES)
    .map(id => [id, cardRulesText(createCardFromBase(id, 'player'))])));
  for (const id of ['footkiri', 'wonton_ki', 'pinige', 'two_achievers', 'best_friend',
    'trpg_member', 'lightning_n', 'curry_treater', 'think_so', 'environment_setup',
    'iv_pack', 'dry_meal_ticket', 'pure_destruction', 'childhood_memory_tutuapp',
    'efficient_experiment_method', 'sexual_eye', 'dorm_council', 'shukii']) {
    expect(text[id], id).not.toMatch(/手札[にへ]加え/);
    expect(text[id], id).toContain('引く');
  }
  for (const id of ['habayose', 'confucius_says', 'triple_enemy', 'sage_legacy',
    'three_gestures', 'music_detergent', 'course_registration_party']) {
    expect(text[id], id).toContain('手札に加え');
  }
  expect(text.habayose).toContain('カード1枚を選び、手札に加える。');
  expect(text.triple_enemy).toContain('残りをデッキの下に置く。');
  expect(text.course_registration_party).toContain('ターン開始時の通常ドローの代わりに');
  expect(text.yamanashi_minimum_wage).toContain('引くことも、手札に加えることもできない。');
  expect(text.yutakun_yutakun).toContain('校外エリアから「U太」を1枚手札に加える。');
  expect(text.alpha).toContain('「ベータ」を手札に加え');
  expect(text.lightning_n).toContain('「定規」1枚を手札に生成する。');
  expect(text.environment_setup).toContain('校外エリアから環境カードをランダムに1枚手札に戻す。');
});

test('履修登録中も効果ドロー・サーチは予約列を消費せず、通常ドローだけを置き換える', async ({ page }) => {
  await page.goto(url);
  const result = await page.evaluate(() => {
    startCardTest('short_sleeve_student'); scheduleOpponentAI = () => {};
    state.training.skipAnimations = true; state.deckToHandLocks = [];
    const own = state.players.player;
    own.hand = [];
    own.deck = ['general_student', 'yuta'].map(id => createCardFromBase(id, 'player'));
    state.courseRegistration = {
      drawQueues: { player: [createCardFromBase('general_teacher', 'player')], opponent: [] },
      remainingTurns: { player: 5, opponent: 5 }
    };
    drawOne('player', false);
    pullCardsFromDeck('player', 'yuta', 1);
    const afterEffects = { hand: own.hand.map(card => card.baseId),
      queue: state.courseRegistration.drawQueues.player.map(card => card.baseId),
      remaining: state.courseRegistration.remainingTurns.player };
    const normal = resolveCourseRegistrationDrawSelection('player');
    return { afterEffects, handled: normal.handled, drawn: normal.drawn.baseId,
      hand: own.hand.map(card => card.baseId), remaining: state.courseRegistration.remainingTurns.player };
  });
  expect(result).toEqual({ afterEffects: { hand: ['general_student', 'yuta'],
    queue: ['general_teacher'], remaining: 5 }, handled: true, drawn: 'general_teacher',
    hand: ['general_student', 'yuta', 'general_teacher'], remaining: 4 });
});

test('対象なしのサーチ・効果ドローは敗北せず、通常ドローだけがデッキ切れ敗北になる', async ({ page }) => {
  await page.goto(url);
  const result = await page.evaluate(() => {
    startCardTest('short_sleeve_student'); scheduleOpponentAI = () => {};
    state.training.skipAnimations = true; state.deckToHandLocks = [];
    state.players.player.deck = []; state.players.player.hand = [];
    const searched = pullCardsFromDeck('player', 'yuta', 1);
    const afterSearch = state.gameOver;
    const effectDraw = drawOne('player', false);
    const afterEffect = state.gameOver;
    const normalDraw = drawOne('player', true);
    return { searched, afterSearch, effectDraw, afterEffect, normalDraw, afterNormal: state.gameOver };
  });
  expect(result).toEqual({ searched: 0, afterSearch: false, effectDraw: false,
    afterEffect: false, normalDraw: false, afterNormal: true });
});


test('表記統一のお知らせは書き方の一覧とし、実際の能力調整だけ全文比較する', async ({ page }) => {
  await page.goto(url);
  const release = await page.evaluate(() => UPDATE_HISTORY.find(entry => entry.version === 'ver.0.45.4'));
  const comparisons = release.changes.filter(change => change.before && change.after);
  expect(comparisons.map(change => change.title)).toEqual(['斥候学生', 'ハバヨセ!']);
  const wording = release.changes.find(change => change.title === 'カード本文の表記統一');
  expect(wording.after).toContain('指定カードを手札に加える → 指定カードを引く');
  expect(wording.after).toContain('公開・確認した候補から取る場合は「手札に加える」を維持');
  expect(wording).not.toHaveProperty('before');
  await page.locator('#homeUpdatesButton').click();
  const latest = page.locator('.update-entry').filter({ has: page.locator('summary', { hasText: 'ver.0.45.4（' }) });
  await latest.locator('summary').click();
  await expect(latest.locator('.update-before')).toHaveCount(2);
  const overview = latest.locator('.update-change').filter({ hasText: 'カード本文の表記統一' });
  await expect(overview).toContainText('指定カードを手札に加える → 指定カードを引く');
  await overview.scrollIntoViewIfNeeded();
  await overview.screenshot({ path: test.info().outputPath('wording-overview.png') });
});
