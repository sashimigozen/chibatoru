const { test, expect } = require('@playwright/test');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const gameUrl = pathToFileURL(path.join(__dirname, '..', 'index.html')).href;

test.beforeEach(async ({ page }) => {
  await page.goto(gameUrl);
  await page.evaluate(() => {
    const api = window.__chibattle;
    api.startCardTest('general_student');
    api.state.screen = 'battle'; api.state.phase = 'battle';
    api.state.currentSide = 'player'; api.state.environment = null;
    for (const side of ['player', 'opponent']) {
      Object.assign(api.state.players[side], {
        board: { teacher: null, seats: Array(9).fill(null) },
        hand: [], deck: [], trash: [], late: [], will: 20, maxWill: 20, life: 30
      });
    }
  });
});

test('装備時は体力だけ減り、感染済み・装備済みの出席者には使用できない', async ({ page }) => {
  const result = await page.evaluate(() => {
    const api = window.__chibattle;
    const target = api.makeBoardCard(api.createCardFromBase('general_student', 'player'));
    api.state.players.player.board.seats[0] = target;
    const before = { attack: target.attack, hp: target.currentHp };
    const first = api.equipIllness('player', target, api.createCardFromBase('illness', 'player'));
    const repeated = api.equipIllness('player', target, api.createCardFromBase('illness', 'player'));
    const item = api.createCardFromBase('illness', 'player');
    api.state.players.player.hand.push(item);
    const will = api.state.players.player.will;
    const cast = api.castItemOnCard('player', item, 'player', 'seat', 0, false);
    const occupied = api.makeBoardCard(api.createCardFromBase('general_student', 'player'));
    occupied.padlockEquipment = api.createCardFromBase('padlock', 'player');
    return { first, repeated, cast, attackLoss: before.attack - target.attack,
      hpLoss: before.hp - target.currentHp, count: target.illnessEquipments.length,
      willSpent: will - api.state.players.player.will, itemRemains: api.state.players.player.hand.includes(item),
      occupiedAllowed: api.canEquipIllness(occupied) };
  });
  expect(result).toEqual({ first: true, repeated: false, cast: false, attackLoss: 0, hpLoss: 1,
    count: 1, willSpent: 0, itemRemains: true, occupiedAllowed: false });
});

for (const endingSide of ['player', 'opponent']) {
  test(`${endingSide}の終了時に両講義室で感染し、教師・ヴァンパイアも対象になる`, async ({ page }) => {
    const result = await page.evaluate((side) => {
      const api = window.__chibattle;
      const sources = [], targets = [];
      for (const owner of ['player', 'opponent']) {
        const source = api.makeBoardCard(api.createCardFromBase('general_student', owner));
        const target = api.makeBoardCard(api.createCardFromBase(owner === 'player' ? 'general_teacher' : 'vampire', owner));
        source.attack = 8; source.baseAttack = 8;
        api.state.players[owner].board.seats[0] = source;
        if (owner === 'player') api.state.players[owner].board.teacher = target;
        else api.state.players[owner].board.seats[1] = target;
        api.equipIllness(owner, source, api.createCardFromBase('illness', owner));
        sources.push({ card: source, hp: source.currentHp, attack: source.attack });
        targets.push({ card: target, hp: target.currentHp, attack: target.attack });
      }
      api.resolveEndTurnEffects(side);
      return { sources: sources.map(({card, hp, attack}) => ({ attackLoss: attack-card.attack, hpLoss: hp-card.currentHp })),
        targets: targets.map(({card, hp, attack}) => ({ infected: api.isIllnessInfected(card), hpLoss: hp-card.currentHp, attackLoss: attack-card.attack })) };
    }, endingSide);
    expect(result).toEqual({ sources: [{attackLoss:1,hpLoss:0},{attackLoss:1,hpLoss:0}],
      targets: [{infected:true,hpLoss:1,attackLoss:0},{infected:true,hpLoss:1,attackLoss:0}] });
  });
}

test('装備解除後も感染は残り、再感染せず、毎終了時に攻撃力だけ減る', async ({ page }) => {
  const result = await page.evaluate(() => {
    const api = window.__chibattle;
    const card = api.makeBoardCard(api.createCardFromBase('general_student', 'player'));
    api.state.players.player.board.seats[0] = card;
    api.equipIllness('player', card, api.createCardFromBase('illness', 'player'));
    api.removeIllnessEquipment(card, 'player', card.illnessEquipments[0]);
    const attack = card.attack, hp = card.currentHp;
    const allowed = api.canEquipIllness(card);
    api.resolveEndTurnEffects('player'); api.resolveEndTurnEffects('opponent');
    const copy = JSON.parse(JSON.stringify(card));
    return { allowed, infected: api.isIllnessInfected(copy), equipment: card.illnessEquipments.length,
      attackLoss: attack-card.attack, hpLoss: hp-card.currentHp };
  });
  expect(result).toEqual({ allowed:false, infected:true, equipment:0, attackLoss:2, hpLoss:0 });
});

test('感染は同じ講義室だけに広がり、その終了時には連鎖しない', async ({ page }) => {
  const result = await page.evaluate(() => {
    const api = window.__chibattle;
    for (const owner of ['player', 'opponent']) {
      for (let i=0; i<3; i++) api.state.players[owner].board.seats[i] =
        api.makeBoardCard(api.createCardFromBase('general_student', owner));
    }
    api.equipIllness('player', api.state.players.player.board.seats[0], api.createCardFromBase('illness', 'opponent'));
    api.resolveIllnessEndTurn();
    return ['player','opponent'].map(owner=>api.state.players[owner].board.seats.filter(api.isIllnessInfected).length);
  });
  expect(result).toEqual([2,0]);
});

test('ターン開始時には発動せず、オンライン同期データにも感染状態が残る', async ({ page }) => {
  const result = await page.evaluate(() => {
    const api = window.__chibattle;
    const card = api.makeBoardCard(api.createCardFromBase('general_student', 'player'));
    const target = api.makeBoardCard(api.createCardFromBase('general_student', 'player'));
    api.state.players.player.board.seats[0] = card;
    api.state.players.player.board.seats[1] = target;
    api.equipIllness('player', card, api.createCardFromBase('illness', 'player'));
    const attack = card.attack, hp = card.currentHp;
    api.startTurn('player');
    const snapshot = api.onlineCreateSnapshot();
    return { attackLoss: attack-card.attack, hpLoss: hp-card.currentHp,
      targetInfected: api.isIllnessInfected(target),
      synced: snapshot.state.players.player.board.seats[0].illnessInfected };
  });
  expect(result).toEqual({ attackLoss:0, hpLoss:0, targetInfected:false, synced:true });
});

test('病の表示本文は合意した文面と一致する', async ({ page }) => {
  const text = await page.evaluate(() => window.__chibattle.cardRulesText(window.__chibattle.createCardFromBase('illness', 'player')));
  expect(text).toBe('[装備]\nお互いの講義室にいる出席者1人に装備する。\n装備者の体力を-1する。\nお互いのターン終了時、装備者の攻撃力を-1する。その後、その講義室にいる出席者1人をランダムに指名し、「病」を装備させる。');
});
