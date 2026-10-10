const { test, expect } = require('@playwright/test');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const gameUrl = pathToFileURL(path.join(__dirname, '..', 'index.html')).href;

test.beforeEach(async ({ page }) => {
  await page.goto(gameUrl);
  await page.evaluate(() => {
    const api = window.__chibattle;
    api.startCardTest('general_student');
    Object.assign(api.state, { screen: 'battle', phase: 'battle', currentSide: 'player', actionTurn: 5, environment: null });
    for (const side of ['player', 'opponent']) Object.assign(api.state.players[side], {
      board: { teacher: null, seats: Array(9).fill(null) }, hand: [], deck: [], trash: [], late: [],
      will: 20, maxWill: 20, life: 30, attendancesThisTurn: 0
    });
  });
});

test('U太＋病の特殊進化は両講義室に1人ずつ病を装備させる', async ({ page }) => {
  const result = await page.evaluate(() => {
    const api = window.__chibattle;
    const yuta = api.makeBoardCard(api.createCardFromBase('yuta', 'player'));
    const friend = api.makeBoardCard(api.createCardFromBase('strong_student', 'player'));
    const enemy = api.makeBoardCard(api.createCardFromBase('general_teacher', 'opponent'));
    api.state.players.player.board.seats[0] = yuta;
    api.state.players.player.board.seats[1] = friend;
    api.state.players.opponent.board.teacher = enemy;
    const random = Math.random; Math.random = () => 0.99;
    const used = api.equipIllness('player', yuta, api.createCardFromBase('illness', 'player'));
    Math.random = random;
    const sick = api.state.players.player.board.seats[0];
    return { used, id: sick.baseId, source: sick.evolvedFrom.baseId,
      friends: friend.illnessEquipments?.length, enemies: enemy.illnessEquipments?.length,
      attends: api.state.players.player.attendancesThisTurn };
  });
  expect(result).toEqual({ used: true, id: 'sick_yuta', source: 'yuta', friends: 1, enemies: 1, attends: 0 });
});

test('病に臥すU太の終了時効果は感染済みを避け、装備とは独立に発動する', async ({ page }) => {
  const result = await page.evaluate(() => {
    const api = window.__chibattle;
    const sick = api.makeBoardCard(api.createCardFromBase('sick_yuta', 'player'));
    api.state.players.player.board.seats[0] = sick;
    const targets = [0, 1].map(index => {
      const card = api.makeBoardCard(api.createCardFromBase('strong_student', 'opponent'));
      api.state.players.opponent.board.seats[index] = card; return card;
    });
    api.equipIllness('opponent', targets[0], api.createCardFromBase('illness', 'player'));
    api.resolveStudentEndTurnEffects('opponent');
    const before = targets[1].illnessEquipments?.length || 0;
    api.resolveStudentEndTurnEffects('player');
    return { before, after: targets[1].illnessEquipments?.length, sourceInfected: api.isIllnessInfected(sick) };
  });
  expect(result).toEqual({ before: 0, after: 1, sourceInfected: false });
});

for (const side of ['player', 'opponent']) {
  test(`${side}の裏U太を病に臥すU太に重ねると4/4の克服後に進化する`, async ({ page }) => {
    const result = await page.evaluate(owner => {
      const api = window.__chibattle;
      api.state.currentSide = owner;
      const sick = api.makeBoardCard(api.createCardFromBase('sick_yuta', owner));
      sick.playedOnTurn = 5;
      api.state.players[owner].board.seats[0] = sick;
      const dark = api.createCardFromBase('dark_yuta', owner);
      const sameTurn = api.canPlaceCard(owner, dark, 'seat', owner, 0);
      sick.playedOnTurn = 3; sick.evolvedOnTurn = 3;
      const allowed = api.canPlaceCard(owner, dark, 'seat', owner, 0);
      const evolved = evolveCard(owner, dark, owner, 'seat', 0, { skipEvolutionAnimation: true });
      return { sameTurn, allowed, id: evolved.baseId, attack: evolved.attack, hp: evolved.maxHp,
        source: evolved.evolvedFrom.baseId, material: api.state.players[owner].trash.some(card => card.instanceId === dark.instanceId),
        generatedYuta: api.state.players[owner].hand.some(card => card.baseId === 'yuta') };
    }, side);
    expect(result).toEqual({ sameTurn: false, allowed: true, id: 'recovered_dark_yuta', attack: 4, hp: 4,
      source: 'sick_yuta', material: true, generatedYuta: false });
  });
}

test('両側の病を枚数で数え、攻撃力と体力を強化して解除対象を攻撃力0・体力1にする', async ({ page }) => {
  const result = await page.evaluate(() => {
    const api = window.__chibattle;
    const source = api.makeBoardCard(api.createCardFromBase('recovered_dark_yuta', 'player'));
    api.state.players.player.board.seats[0] = source;
    const infected = ['player', 'opponent'].map((owner, index) => {
      const card = api.makeBoardCard(api.createCardFromBase('strong_student', owner));
      api.state.players[owner].board.seats[1] = card;
      api.equipIllness(owner, card, api.createCardFromBase('illness', owner));
      // 旧セーブの複数装備も、人ではなく送った枚数として扱う。
      if (index === 1) card.illnessEquipments.push(api.createCardFromBase('illness', owner));
      card.currentHp = 1;
      return card;
    });
    const unaffected = api.makeBoardCard(api.createCardFromBase('strong_student', 'opponent'));
    api.state.players.opponent.board.seats[2] = unaffected;
    const before = [unaffected.attack, unaffected.maxHp, unaffected.currentHp];
    api.resolveEvolutionEffect('player', source);
    api.applyBoardAuras();
    const snapshot = api.onlineCreateSnapshot();
    return { source: [source.attack, source.maxHp, source.currentHp],
      targets: infected.map(card => [card.attack, card.maxHp, card.currentHp, card.illnessEquipments.length, api.canEquipIllness(card)]),
      trash: ['player', 'opponent'].map(owner => api.state.players[owner].trash.filter(card => card.baseId === 'illness').length),
      unchanged: JSON.stringify(before) === JSON.stringify([unaffected.attack, unaffected.maxHp, unaffected.currentHp]),
      syncedHp: snapshot.state.players.player.board.seats[0].maxHp, choice: api.state.pendingCardChoice };
  });
  expect(result).toEqual({ source: [7, 7, 7], targets: [[0, 1, 1, 0, false], [0, 1, 1, 0, false]],
    trash: [1, 2], unchanged: true, syncedHp: 7, choice: null });
});

test('通常のU太には今までどおり裏U太へ進化できる', async ({ page }) => {
  const result = await page.evaluate(() => {
    const api = window.__chibattle;
    const yuta = api.makeBoardCard(api.createCardFromBase('yuta', 'player'));
    yuta.playedOnTurn = 1;
    api.state.players.player.board.seats[0] = yuta;
    const evolved = evolveCard('player', api.createCardFromBase('dark_yuta', 'player'), 'player', 'seat', 0, { skipEvolutionAnimation: true });
    return { id: evolved.baseId, yuta: api.state.players.player.hand[0]?.baseId };
  });
  expect(result).toEqual({ id: 'dark_yuta', yuta: 'yuta' });
});

test('カード本文は最新の合意文面で表示する', async ({ page }) => {
  const texts = await page.evaluate(() => ['sick_yuta', 'recovered_dark_yuta'].map(id => window.__chibattle.cardRulesText(window.__chibattle.createCardFromBase(id, 'player'))));
  expect(texts[0]).toBe('[特殊進化]：「U太」に「病」を装備させる。\n進化時、お互いの講義室にいる出席者をランダムに1人ずつ指名し、「病」を装備させる。\n自分のターン終了時、相手の出席者1人をランダムに指名し、「病」を装備させる。');
  expect(texts[1]).toBe('[特殊進化]：「病に臥すU太」に「裏U太」を進化させる。\n進化時、お互いの出席者に装備されている「病」すべてを校外エリアへ送る。その後、送った枚数分、このカードの攻撃力と体力を上昇させる。\n「病」を送られた出席者の攻撃力を0、体力を1にする。');
});
