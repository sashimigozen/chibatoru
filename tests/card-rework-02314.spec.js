const { test, expect } = require("@playwright/test");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const gameUrl = pathToFileURL(path.join(__dirname, "..", "index.html")).href;

test.beforeEach(async ({ page }) => {
  await page.goto(gameUrl);
  await page.evaluate(() => {
    const api = window.__chibattle;
    api.startCardTest("general_student");
    api.state.screen = "battle";
    api.state.phase = "battle";
    api.state.currentSide = "player";
    api.state.environment = null;
    for (const side of ["player", "opponent"]) {
      const player = api.state.players[side];
      player.board = { teacher: null, seats: Array(9).fill(null) };
      player.hand = [];
      player.deck = [];
      player.trash = [];
      player.will = 20;
      player.maxWill = 20;
      player.life = 30;
      player.attendancesThisTurn = 0;
    }
  });
});

test("カード定義と表示文を更新し、アグロドームをデッキに登録する", async ({ page }) => {
  const result = await page.evaluate(() => {
    const api = window.__chibattle;
    const card = (id) => api.createCardFromBase(id, "player");
    return {
      scaredCost: card("scared_me").cost,
      plumpCost: card("plump_student").cost,
      trueEnemyHaste: api.hasKeyword(card("true_enemy"), "超陽気"),
      enemyEnemyStats: [card("enemy_enemy").cost, card("enemy_enemy").attack, card("enemy_enemy").hp],
      reviveCost: card("enemy_revive").cost,
      dome: [card("aggro_dome").cost, card("aggro_dome").category, api.cardRulesText(card("aggro_dome")),
        api.specialtyAllowedCardIds("common").has("aggro_dome")],
      scaredText: api.cardRulesText(card("scared_me")),
      enemyText: api.cardRulesText(card("enemy_enemy"))
    };
  });
  expect(result.scaredCost).toBe(4);
  expect(result.plumpCost).toBe(5);
  expect(result.trueEnemyHaste).toBe(true);
  expect(result.enemyEnemyStats).toEqual([2, 1, 2]);
  expect(result.reviveCost).toBe(5);
  expect(result.dome).toEqual([2, "common", "このカードが環境マスにあるかぎり、お互いの「アグロ」とつく出席者は[超陽気]を持つ。", true]);
  expect(result.scaredText).toContain("体力が最も高い1人");
  expect(result.enemyText).toContain("デッキの上に戻す");
});

test("ケっ！びびらせやがっては最高体力の教師も破壊できる", async ({ page }) => {
  const result = await page.evaluate(() => {
    const api = window.__chibattle;
    const state = api.state;
    state.players.opponent.board.teacher = api.makeBoardCard(api.createCardFromBase("general_teacher", "opponent"));
    state.players.opponent.board.teacher.currentHp = 9;
    state.players.opponent.board.seats[0] = api.makeBoardCard(api.createCardFromBase("general_student", "opponent"));
    const item = api.createCardFromBase("scared_me", "player");
    state.players.player.hand = [item];
    const played = api.castImmediateItem("player", item, false);
    return { played, teacher: state.players.opponent.board.teacher, student: state.players.opponent.board.seats[0]?.baseId };
  });
  expect(result.played).toBe(true);
  expect(result.teacher).toBeNull();
  expect(result.student).toBe("general_student");
});

test("細いの戦意とちがうよのドロー枚数は手札枚数で決まる", async ({ page }) => {
  const result = await page.evaluate(() => {
    const api = window.__chibattle;
    const state = api.state;
    const thin = api.createCardFromBase("thin_item", "player");
    const chigauyo = api.createCardFromBase("chigauyo", "player");
    state.players.opponent.hand = Array.from({ length: 7 }, () => api.createCardFromBase("ruler", "opponent"));
    const cost7 = api.effectiveCardCost(thin);
    state.players.opponent.hand = Array.from({ length: 3 }, () => api.createCardFromBase("ruler", "opponent"));
    const cost3 = api.effectiveCardCost(thin);
    state.players.player.hand = [chigauyo, api.createCardFromBase("ruler", "player"), api.createCardFromBase("bento", "player")];
    state.players.opponent.hand = Array.from({ length: 4 }, () => api.createCardFromBase("ruler", "opponent"));
    state.players.player.deck = Array.from({ length: 10 }, () => api.createCardFromBase("general_student", "player"));
    state.players.opponent.deck = Array.from({ length: 10 }, () => api.createCardFromBase("general_student", "opponent"));
    api.castImmediateItem("player", chigauyo, false);
    return { cost7, cost3, own: state.players.player.hand.length, opponent: state.players.opponent.hand.length,
      itemInTrash: state.players.player.trash.some((entry) => entry.baseId === "chigauyo") };
  });
  expect(result).toEqual({ cost7: 3, cost3: 0, own: 3, opponent: 3, itemInTrash: true });
});

test("敵の敵は自分を含めて引き、指定順で山札の上に戻す", async ({ page }) => {
  const result = await page.evaluate(() => {
    const api = window.__chibattle;
    const state = api.state;
    const enemy = api.makeBoardCard(api.createCardFromBase("enemy_student", "player"));
    const trueEnemy = api.makeBoardCard(api.createCardFromBase("true_enemy", "player"));
    state.players.player.board.seats[0] = enemy;
    state.players.player.board.seats[1] = trueEnemy;
    state.players.player.deck = Array.from({ length: 5 }, () => api.createCardFromBase("general_student", "player"));
    const card = api.createCardFromBase("enemy_enemy", "player");
    state.players.player.hand = [card];
    const played = api.placeCardFromHand("player", card.instanceId, "seat", "player", 4, false,
      { enemyEnemyTopOrderIds: [trueEnemy.instanceId, enemy.instanceId] });
    return { played, hand: state.players.player.hand.length, deckTop: state.players.player.deck.slice(0, 2).map((entry) => entry.baseId),
      ownBoard: state.players.player.board.seats[4]?.baseId, otherSlotsEmpty: !state.players.player.board.seats[0] && !state.players.player.board.seats[1] };
  });
  expect(result).toEqual({ played: true, hand: 3, deckTop: ["true_enemy", "enemy_student"],
    ownBoard: "enemy_enemy", otherSlotsEmpty: true });
});

test("敵の敵はプレイ前の選択画面で山札上の順番を指定できる", async ({ page }) => {
  const result = await page.evaluate(() => {
    const api = window.__chibattle;
    const state = api.state;
    const first = api.makeBoardCard(api.createCardFromBase("enemy_student", "player"));
    const second = api.makeBoardCard(api.createCardFromBase("true_enemy", "player"));
    state.players.player.board.seats[0] = first;
    state.players.player.board.seats[1] = second;
    state.players.player.deck = Array.from({ length: 4 }, () => api.createCardFromBase("general_student", "player"));
    const card = api.createCardFromBase("enemy_enemy", "player");
    state.players.player.hand = [card];
    api.playCard(card.instanceId, "seat", "player", 4);
    const choice = state.pendingCardChoice;
    const mode = choice?.mode;
    const count = choice?.max;
    choice.selectedIds = [second.instanceId, first.instanceId];
    api.confirmCardChoiceSelection();
    return { mode, count, top: state.players.player.deck.slice(0, 2).map((entry) => entry.baseId) };
  });
  expect(result).toEqual({ mode: "enemy_enemy_order", count: 2, top: ["true_enemy", "enemy_student"] });
});

test("三敵は上3枚の敵を選択順で手札から出席させ、残りを山札の下へ置く", async ({ page }) => {
  const result = await page.evaluate(() => {
    const api = window.__chibattle;
    const state = api.state;
    const horde = api.createCardFromBase("enemy_horde", "player");
    const plain = api.createCardFromBase("general_student", "player");
    const enemy = api.createCardFromBase("enemy_student", "player");
    state.players.player.deck = [horde, plain, enemy, api.createCardFromBase("ruler", "player")];
    const card = api.createCardFromBase("triple_enemy", "player");
    state.players.player.hand = [card];
    const played = api.placeCardFromHand("player", card.instanceId, "seat", "player", 4, false,
      { tripleEnemyOrderIds: [enemy.instanceId, horde.instanceId] });
    const board = [...new Set(state.players.player.board.seats.filter(Boolean).map((entry) => entry.instanceId))]
      .map((id) => state.players.player.board.seats.find((entry) => entry?.instanceId === id)?.baseId);
    return { played, board, deck: state.players.player.deck.map((entry) => entry.baseId),
      enemyInHand: state.players.player.hand.filter((entry) => entry.baseId === "enemy_student").length };
  });
  expect(result.played).toBe(true);
  expect(result.board).toContain("triple_enemy");
  expect(result.board).toContain("enemy_horde");
  expect(result.board.filter((id) => id === "enemy_student").length).toBe(2);
  expect(result.deck).toEqual(["ruler", "general_student"]);
  expect(result.enemyInHand).toBe(1);
});

test("真の敵が引いた敵の群れは手札からの出席時効果を発動する", async ({ page }) => {
  const result = await page.evaluate(() => {
    const api = window.__chibattle;
    const state = api.state;
    const attacker = api.makeBoardCard(api.createCardFromBase("true_enemy", "player"));
    state.players.player.board.seats[0] = attacker;
    state.players.player.deck = [api.createCardFromBase("enemy_horde", "player")];
    api.markCardAttackUsed(attacker);
    const horde = state.players.player.board.seats.find((entry) => entry?.baseId === "enemy_horde");
    return { hordeSource: horde?.lastAttendanceSource, generatedOnBoard: state.players.player.board.seats.some((entry) => entry?.baseId === "enemy_student"),
      generatedInHand: state.players.player.hand.some((entry) => entry.baseId === "enemy_student"),
      attackLimit: api.cardAttackLimit(attacker) };
  });
  expect(result).toEqual({ hordeSource: "hand", generatedOnBoard: true, generatedInHand: true, attackLimit: 2 });
});

test("真の敵が出した三敵でも複数の敵の発動順を選べる", async ({ page }) => {
  const result = await page.evaluate(() => {
    const api = window.__chibattle;
    const state = api.state;
    const attacker = api.makeBoardCard(api.createCardFromBase("true_enemy", "player"));
    state.players.player.board.seats[0] = attacker;
    const horde = api.createCardFromBase("enemy_horde", "player");
    const enemy = api.createCardFromBase("enemy_student", "player");
    state.players.player.deck = [api.createCardFromBase("triple_enemy", "player"), horde, enemy,
      api.createCardFromBase("general_student", "player")];
    api.markCardAttackUsed(attacker);
    const choice = state.pendingCardChoice;
    const mode = choice?.mode;
    const candidates = choice?.selectableIds;
    choice.selectedIds = [enemy.instanceId, horde.instanceId];
    api.confirmCardChoiceSelection();
    const board = state.players.player.board.seats.filter(Boolean).map((entry) => entry.baseId);
    return { mode, candidates, board, hordeInHand: state.players.player.hand.some((entry) => entry.instanceId === horde.instanceId) };
  });
  expect(result.mode).toBe("triple_enemy_resolution");
  expect(result.candidates).toHaveLength(2);
  expect(result.board).toContain("triple_enemy");
  expect(result.board).toContain("enemy_horde");
  expect(result.board.filter((id) => id === "enemy_student").length).toBe(2);
  expect(result.hordeInHand).toBe(false);
});

test("アグロキングダムは三種がそろった間だけ強化し、ドームは超陽気を与える", async ({ page }) => {
  const result = await page.evaluate(() => {
    const api = window.__chibattle;
    const state = api.state;
    const king = api.makeBoardCard(api.createCardFromBase("aggro_king", "player"));
    const queen = api.makeBoardCard(api.createCardFromBase("aggro_queen", "player"));
    const student = api.makeBoardCard(api.createCardFromBase("aggro_student", "player"));
    const other = api.makeBoardCard(api.createCardFromBase("general_student", "player"));
    state.players.player.board.seats[6] = king;
    state.players.player.board.seats[5] = queen;
    state.players.player.board.seats[4] = student;
    state.players.player.board.seats[0] = other;
    state.environment = api.createCardFromBase("aggro_kingdom", "player");
    api.applyBoardAuras();
    const active = { attack: other.attack, hp: other.maxHp, attention: api.hasKeyword(student, "超注目"),
      kingText: api.cardRulesText(king) };
    state.players.player.board.seats[5] = null;
    api.applyBoardAuras();
    const inactive = { attack: other.attack, hp: other.maxHp, attention: api.hasKeyword(student, "超注目") };
    state.environment = api.createCardFromBase("aggro_dome", "player");
    const dome = api.hasKeyword(student, "超陽気");
    return { active, inactive, dome };
  });
  expect(result.active.attack).toBe(4);
  expect(result.active.hp).toBe(3);
  expect(result.active.attention).toBe(true);
  expect(result.active.kingText).toContain("すべての攻撃力を+2");
  expect(result.inactive).toEqual({ attack: 2, hp: 2, attention: false });
  expect(result.dome).toBe(true);
});

test("アグロキングダム中のクイーンは学生がいなければ相手本体に2ダメージ", async ({ page }) => {
  const result = await page.evaluate(() => {
    const api = window.__chibattle;
    const state = api.state;
    state.players.player.board.seats[6] = api.makeBoardCard(api.createCardFromBase("aggro_king", "player"));
    state.players.player.board.seats[5] = api.makeBoardCard(api.createCardFromBase("aggro_queen", "player"));
    state.players.player.board.seats[4] = api.makeBoardCard(api.createCardFromBase("aggro_student", "player"));
    state.environment = api.createCardFromBase("aggro_kingdom", "player");
    api.resolveStudentEndTurnEffects("player");
    const activeLife = state.players.opponent.life;
    state.environment = api.createCardFromBase("aggro_dome", "player");
    api.resolveStudentEndTurnEffects("player");
    return { activeLife, afterDome: state.players.opponent.life };
  });
  expect(result).toEqual({ activeLife: 28, afterDome: 28 });
});
