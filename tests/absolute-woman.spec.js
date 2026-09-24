const { test, expect } = require("@playwright/test");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const gameUrl = pathToFileURL(path.join(__dirname, "..", "index.html")).href;

test.beforeEach(async ({ page }) => {
  await page.goto(gameUrl);
  await page.evaluate(() => {
    const api = window.__chibattle;
    api.startCardTest("absolute_woman");
    api.state.screen = "battle";
    api.state.phase = "battle";
    api.state.currentSide = "player";
    api.state.firstSide = "player";
    api.state.actionTurn = 3;
    api.state.players.player.turnsTaken = 2;
    for (const side of ["player", "opponent"]) {
      api.state.players[side].board = { teacher: null, seats: Array(9).fill(null) };
    }
  });
});

test("「絶対」女は戦意7・1/3・陽気で、1ターンに3回攻撃できる", async ({ page }) => {
  const definition = await page.evaluate(() => {
    const api = window.__chibattle;
    const card = api.createCardFromBase("absolute_woman", "player");
    return {
      cost: card.cost,
      attack: card.attack,
      hp: card.hp,
      attackLimit: card.attackLimit,
      cheerful: api.hasKeyword(card, "陽気"),
      rules: api.cardRulesText(card)
    };
  });

  expect(definition).toEqual({
    cost: 7,
    attack: 1,
    hp: 3,
    attackLimit: 3,
    cheerful: true,
    rules: "[陽気]\nこのカードが出席者を攻撃したとき、その出席者を破壊する。\nこのカードは1ターンに3回まで攻撃できる。"
  });
});

test("「絶対」女の本文をチバトルの文体で全参照先に揃える", () => {
  const expected = "陽気を持つ。このカードが出席者を攻撃したとき、その出席者を破壊する。このカードは1ターンに3回まで攻撃できる。";
  const indexSource = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  const rulesSource = fs.readFileSync(path.join(__dirname, "..", "card_rules.txt"), "utf8");

  expect(indexSource).toContain(`absolute_woman: "${expected}"`);
  expect(rulesSource).toContain(`absolute_woman: "${expected}"`);
});

test("3回の攻撃で相手を破壊し、4回目は不可、次ターンに攻撃回数が戻る", async ({ page }) => {
  const result = await page.evaluate(async () => {
    const api = window.__chibattle;
    const attacker = api.makeBoardCard(api.createCardFromBase("absolute_woman", "player"));
    attacker.playedOnTurn = api.state.actionTurn;
    api.state.players.player.board.seats[0] = attacker;
    for (let index = 0; index < 3; index += 1) {
      const target = api.makeBoardCard(api.createCardFromBase("protein_drinker", "opponent"));
      target.currentHp = 99;
      api.state.players.opponent.board.seats[index] = target;
    }

    const afterAttacks = [];
    for (let index = 0; index < 3; index += 1) {
      api.state.selectedAttacker = { owner: "player", zone: "seat", index: 0 };
      await api.attackCard("opponent", "seat", index);
      afterAttacks.push({
        targetRemoved: api.state.players.opponent.board.seats[index] === null,
        used: api.cardAttacksUsedThisTurn(attacker),
        canAttack: api.canAttackSilently(attacker),
        hasAttacked: attacker.hasAttacked
      });
    }

    const fourthTarget = api.makeBoardCard(api.createCardFromBase("protein_drinker", "opponent"));
    fourthTarget.currentHp = 99;
    api.state.players.opponent.board.seats[3] = fourthTarget;
    api.state.selectedAttacker = { owner: "player", zone: "seat", index: 0 };
    await api.attackCard("opponent", "seat", 3);
    const fourthAttackBlocked = api.state.players.opponent.board.seats[3]?.instanceId === fourthTarget.instanceId;

    api.resetAttackFlags("player");
    return {
      afterAttacks,
      fourthAttackBlocked,
      afterReset: {
        used: api.cardAttacksUsedThisTurn(attacker),
        canAttack: api.canAttackSilently(attacker),
        hasAttacked: attacker.hasAttacked
      }
    };
  });

  expect(result.afterAttacks).toEqual([
    { targetRemoved: true, used: 1, canAttack: true, hasAttacked: false },
    { targetRemoved: true, used: 2, canAttack: true, hasAttacked: false },
    { targetRemoved: true, used: 3, canAttack: false, hasAttacked: true }
  ]);
  expect(result.fourthAttackBlocked).toBe(true);
  expect(result.afterReset).toEqual({ used: 0, canAttack: true, hasAttacked: false });
});

test("AIも「絶対」女の3回攻撃を使い切る", async ({ page }) => {
  const result = await page.evaluate(async () => {
    const api = window.__chibattle;
    api.state.currentSide = "opponent";
    api.state.actionTurn = 4;
    api.state.players.opponent.turnsTaken = 2;
    const attacker = api.makeBoardCard(api.createCardFromBase("absolute_woman", "opponent"));
    attacker.playedOnTurn = api.state.actionTurn;
    api.state.players.opponent.board.seats[0] = attacker;
    for (let index = 0; index < 3; index += 1) {
      const target = api.makeBoardCard(api.createCardFromBase("protein_drinker", "player"));
      target.currentHp = 99;
      api.state.players.player.board.seats[index] = target;
    }

    await api.aiAttackWithReadyCards();
    return {
      targets: api.state.players.player.board.seats.slice(0, 3).map((card) => card?.baseId || null),
      used: api.cardAttacksUsedThisTurn(attacker),
      hasAttacked: attacker.hasAttacked
    };
  });

  expect(result).toEqual({ targets: [null, null, null], used: 3, hasAttacked: true });
});

test("オンライン同期データに使用済み攻撃回数を含める", async ({ page }) => {
  const result = await page.evaluate(async () => {
    const api = window.__chibattle;
    const attacker = api.makeBoardCard(api.createCardFromBase("absolute_woman", "player"));
    attacker.playedOnTurn = api.state.actionTurn;
    api.state.players.player.board.seats[0] = attacker;
    const target = api.makeBoardCard(api.createCardFromBase("protein_drinker", "opponent"));
    target.currentHp = 99;
    api.state.players.opponent.board.seats[0] = target;

    api.state.selectedAttacker = { owner: "player", zone: "seat", index: 0 };
    await api.attackCard("opponent", "seat", 0);
    const synced = api.onlineCreateSnapshot().state.players.player.board.seats[0];
    return {
      attacksUsedThisTurn: synced.attacksUsedThisTurn,
      hasAttacked: synced.hasAttacked,
      canAttackAgain: api.canAttackSilently(attacker)
    };
  });

  expect(result).toEqual({
    attacksUsedThisTurn: 1,
    hasAttacked: false,
    canAttackAgain: true
  });
});
