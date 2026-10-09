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
  expect(result.enemyText).toContain("デッキに戻してシャッフルする");
});

test("敵系統7枚の数値と表示文が改装内容に一致する", async ({ page }) => {
  const cards = await page.evaluate(() => {
    const api = window.__chibattle;
    return Object.fromEntries(["enemy_boss", "proliferating_enemy", "true_enemy", "enemy_horde",
      "enemy_enemy", "enemy_revive", "triple_enemy"].map((id) => {
      const card = api.createCardFromBase(id, "player");
      return [id, { stats: [card.cost, card.attack, card.hp], text: api.cardRulesText(card) }];
    }));
  });
  expect(Object.fromEntries(Object.entries(cards).map(([id, card]) => [id, card.stats]))).toEqual({
    enemy_boss: [4, 1, 2], proliferating_enemy: [5, 1, 2], true_enemy: [6, 1, 2],
    enemy_horde: [4, 1, 2], enemy_enemy: [2, 1, 2], enemy_revive: [5, 1, 2],
    triple_enemy: [3, 1, 2]
  });
  expect(cards.enemy_boss.text).toBe("このカードを手札から出席させたとき、自分の講義室に「敵」とつく出席者が2人以上いる場合、自分の空いている席マスに「敵」を2人出席させる。");
  expect(cards.proliferating_enemy.text).toBe("このカードが自分の講義室にいるかぎり、相手の講義室に出席者が出席するたび、自分の空いている席マス1つをランダムに選び、「敵」1人を出席させる。");
  expect(cards.true_enemy.text).toBe("[超陽気]\nこのカードが攻撃するとき、自分のデッキからカードを1枚引く。\nそれが「敵」とつく出席者カードなら、このカードはもう一度攻撃できる。\n自分の空いている席マスがあるなら、そのカードを手札から出席させ、[超陽気]を付与する。");
  expect(cards.enemy_horde.text).toBe("このカードを手札から出席させたとき、自分の手札に「敵」1枚を生成する。その後、自分の空いている席マスに「敵」1人をランダムに出席させる。");
  expect(cards.enemy_enemy.text).toBe("このカードを手札から出席させたとき、自分の講義室にいる「敵」とつく出席者の人数だけカードを引く。その後、このカード以外の自分の講義室にいる「敵」とつく出席者すべてをデッキに戻してシャッフルする。");
  expect(cards.enemy_revive.text).toBe("このカードを手札から出席させたとき、自分の校外エリアにある「敵」を好きな人数だけ選び、自分の空いている席マスへ出席させる。");
  expect(cards.triple_enemy.text).toBe("このカードを手札から出席させたとき、自分のデッキの上から3枚を見る。\nその中の「敵」とつく出席者カードすべてを手札に加え、残りをデッキの下に置く。その後、加えたカードの中から好きな人数を選び、選んだ順に自分のランダムな空き席マスへ手札から出席させてもよい。\n出席させなかったカードは手札に残す。");
});

test("増殖する敵は相手の出席に反応して空席に敵を出す", async ({ page }) => {
  const result = await page.evaluate(async () => {
    const api = window.__chibattle;
    const source = api.makeBoardCard(api.createCardFromBase("proliferating_enemy", "player"));
    api.state.players.player.board.seats[0] = source;
    const attendee = api.makeBoardCard(api.createCardFromBase("general_student", "opponent"));
    api.attendCard("opponent", attendee, "seat", 0, { attendanceSource: api.ATTENDANCE_SOURCE.GENERATED });
    await api.waitForOrderedAttendance();
    return { source: api.state.players.player.board.seats[0]?.baseId,
      summoned: api.state.players.player.board.seats.filter((card) => card?.baseId === "enemy_student").length };
  });
  expect(result).toEqual({ source: "proliferating_enemy", summoned: 1 });
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
  expect(result).toEqual({ cost7: 4, cost3: 4, own: 3, opponent: 3, itemInTrash: true });
});

test("敵の敵は自分を含めて引き、他の敵を山札へ戻してシャッフルする", async ({ page }) => {
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
    const played = api.placeCardFromHand("player", card.instanceId, "seat", "player", 4, false);
    return { played, hand: state.players.player.hand.length, deckSize: state.players.player.deck.length,
      returned: [enemy, trueEnemy].every((entry) => state.players.player.deck.some((card) => card.instanceId === entry.instanceId)),
      ownBoard: state.players.player.board.seats[4]?.baseId, otherSlotsEmpty: !state.players.player.board.seats[0] && !state.players.player.board.seats[1] };
  });
  expect(result).toEqual({ played: true, hand: 3, deckSize: 4, returned: true,
    ownBoard: "enemy_enemy", otherSlotsEmpty: true });
});

test("敵の敵は順番選択なしで出席できる", async ({ page }) => {
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
    return { choice: state.pendingCardChoice?.mode || null,
      board: state.players.player.board.seats[4]?.baseId,
      returned: [first, second].every((entry) => state.players.player.deck.some((card) => card.instanceId === entry.instanceId)) };
  });
  expect(result).toEqual({ choice: null, board: "enemy_enemy", returned: true });
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

test("三敵は0人を選んで敵をすべて手札に残せる", async ({ page }) => {
  const ids = await page.evaluate(() => {
    const api = window.__chibattle;
    const enemy = api.createCardFromBase("enemy_student", "player");
    const horde = api.createCardFromBase("enemy_horde", "player");
    const other = api.createCardFromBase("general_student", "player");
    api.state.players.player.deck = [enemy, horde, other];
    const triple = api.createCardFromBase("triple_enemy", "player");
    api.state.players.player.hand = [triple];
    api.playCard(triple.instanceId, "seat", "player", 4);
    return { enemy: enemy.instanceId, horde: horde.instanceId };
  });
  await expect(page.locator("#threeGesturesConfirmButton")).toBeEnabled();
  await page.locator("#threeGesturesConfirmButton").click();
  const result = await page.evaluate(() => {
    const api = window.__chibattle;
    return { board: api.state.players.player.board.seats.filter(Boolean).map((card) => card.baseId),
      hand: api.state.players.player.hand.map((card) => card.instanceId),
      deck: api.state.players.player.deck.map((card) => card.baseId),
      rules: api.cardRulesText(api.createCardFromBase("triple_enemy", "player")) };
  });
  expect(result.board).toEqual(["triple_enemy"]);
  expect(result.hand).toEqual([ids.enemy, ids.horde]);
  expect(result.deck).toEqual(["general_student"]);
  expect(result.rules).toBe("このカードを手札から出席させたとき、自分のデッキの上から3枚を見る。\nその中の「敵」とつく出席者カードすべてを手札に加え、残りをデッキの下に置く。その後、加えたカードの中から好きな人数を選び、選んだ順に自分のランダムな空き席マスへ手札から出席させてもよい。\n出席させなかったカードは手札に残す。");
});

test("三敵は選んだ敵だけ出席させ、残りを手札に残せる", async ({ page }) => {
  const ids = await page.evaluate(() => {
    const api = window.__chibattle;
    const enemy = api.createCardFromBase("enemy_student", "player");
    const horde = api.createCardFromBase("enemy_horde", "player");
    api.state.players.player.deck = [enemy, horde];
    const triple = api.createCardFromBase("triple_enemy", "player");
    api.state.players.player.hand = [triple];
    api.playCard(triple.instanceId, "seat", "player", 4);
    return { enemy: enemy.instanceId, horde: horde.instanceId };
  });
  await page.locator(`#threeGesturesHand [data-card-id="${ids.enemy}"]`).click();
  await page.locator("#threeGesturesConfirmButton").click();
  const result = await page.evaluate(() => {
    const api = window.__chibattle;
    return { board: api.state.players.player.board.seats.filter(Boolean).map((card) => card.baseId),
      hand: api.state.players.player.hand.map((card) => card.instanceId) };
  });
  expect(result.board).toContain("enemy_student");
  expect(result.board).not.toContain("enemy_horde");
  expect(result.hand).toEqual([ids.horde]);
});

test("三敵から復活の敵を出席させても校外の敵を選べて残りの出席が続く", async ({ page }) => {
  const ids = await page.evaluate(() => {
    const api = window.__chibattle;
    const player = api.state.players.player;
    const revive = api.createCardFromBase("enemy_revive", "player");
    const horde = api.createCardFromBase("enemy_horde", "player");
    const trashEnemy = api.createCardFromBase("enemy_student", "player");
    player.deck = [revive, horde, api.createCardFromBase("general_student", "player")];
    player.trash = [trashEnemy];
    const triple = api.createCardFromBase("triple_enemy", "player");
    player.hand = [triple];
    api.playCard(triple.instanceId, "seat", "player", 4);
    return { revive: revive.instanceId, horde: horde.instanceId, trashEnemy: trashEnemy.instanceId };
  });
  await page.locator(`#threeGesturesHand [data-card-id="${ids.revive}"]`).click();
  await page.locator(`#threeGesturesHand [data-card-id="${ids.horde}"]`).click();
  await page.locator("#threeGesturesConfirmButton").click();
  await expect.poll(() => page.evaluate(() => window.__chibattle.state.pendingCardChoice?.mode))
    .toBe("enemy_revive_resolution");
  await expect(page.locator("#threeGesturesConfirmButton")).toBeEnabled();
  await page.locator(`#threeGesturesHand [data-card-id="${ids.trashEnemy}"]`).click();
  await page.locator("#threeGesturesConfirmButton").click();
  const result = await page.evaluate((trashId) => {
    const api = window.__chibattle;
    const player = api.state.players.player;
    return { board: player.board.seats.filter(Boolean).map((card) => card.baseId),
      revived: player.board.seats.some((card) => card?.instanceId === trashId),
      inTrash: player.trash.some((card) => card.instanceId === trashId),
      pending: api.state.pendingCardChoice?.mode || null };
  }, ids.trashEnemy);
  expect(result.board).toContain("enemy_revive");
  expect(result.board).toContain("enemy_horde");
  expect(result.revived).toBe(true);
  expect(result.inTrash).toBe(false);
  expect(result.pending).toBeNull();
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

test("真の敵から出た三敵も0人を選んで全員を手札に残せる", async ({ page }) => {
  const result = await page.evaluate(() => {
    const api = window.__chibattle;
    const state = api.state;
    const attacker = api.makeBoardCard(api.createCardFromBase("true_enemy", "player"));
    state.players.player.board.seats[0] = attacker;
    const horde = api.createCardFromBase("enemy_horde", "player");
    const enemy = api.createCardFromBase("enemy_student", "player");
    state.players.player.deck = [api.createCardFromBase("triple_enemy", "player"), horde, enemy];
    api.markCardAttackUsed(attacker);
    const choice = state.pendingCardChoice;
    const mode = choice?.mode;
    const min = choice?.min;
    api.confirmCardChoiceSelection();
    return { mode, min, board: state.players.player.board.seats.filter(Boolean).map((card) => card.baseId),
      hand: state.players.player.hand.map((card) => card.instanceId), pending: state.pendingCardChoice };
  });
  expect(result.mode).toBe("triple_enemy_resolution");
  expect(result.min).toBe(0);
  expect(result.board).toContain("triple_enemy");
  expect(result.board).not.toContain("enemy_horde");
  expect(result.hand).toHaveLength(2);
  expect(result.pending).toBeNull();
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

test("アグロキングは出席ターンから2回数えて1度だけ強化する", async ({ page }) => {
  const result = await page.evaluate(() => {
    const api = window.__chibattle;
    const { state } = api;
    const king = api.makeBoardCard(api.createCardFromBase("aggro_king", "player"));
    king.playedOnTurn = state.actionTurn;
    state.players.player.board.seats[6] = king;
    const initial = { attack: king.attack, hp: king.currentHp, maxHp: king.maxHp };
    const text = api.cardRulesText(king);
    api.resolveStudentEndTurnEffects("player");
    const first = { count: king.aggroKingTurns, attack: king.attack, hp: king.currentHp };
    state.actionTurn += 2;
    api.resolveStudentEndTurnEffects("player");
    const second = { count: king.aggroKingTurns, attack: king.attack, hp: king.currentHp, maxHp: king.maxHp };
    state.actionTurn += 2;
    api.resolveStudentEndTurnEffects("player");
    return { initial, text, first, second, third: { attack: king.attack, maxHp: king.maxHp } };
  });
  expect(result).toEqual({
    initial: { attack: 1, hp: 1, maxHp: 1 },
    text: "このカードが3行1列にいる状態で自分のターンを2回終了したとき、1度だけこのカードの攻撃力を+2、体力を+1する。",
    first: { count: 1, attack: 1, hp: 1 },
    second: { count: 2, attack: 3, hp: 2, maxHp: 2 },
    third: { attack: 3, maxHp: 2 }
  });
});

test("アグロキングは席を離れると数え直し、キングダム中は自己強化しない", async ({ page }) => {
  const result = await page.evaluate(() => {
    const api = window.__chibattle;
    const { state } = api;
    const king = api.makeBoardCard(api.createCardFromBase("aggro_king", "player"));
    state.players.player.board.seats[6] = king;
    api.resolveStudentEndTurnEffects("player");
    const first = king.aggroKingTurns;
    const red = api.createCardFromBase("red_ideology", "player");
    state.players.player.hand.push(red);
    api.castImmediateItem("player", red, false);
    const stayed = king.aggroKingTurns;
    const portal = api.createCardFromBase("contrarian_portal", "player");
    state.players.player.hand.push(portal);
    api.castImmediateItem("player", portal, false);
    const left = { index: state.players.player.board.seats.indexOf(king), count: king.aggroKingTurns };
    const returnPortal = api.createCardFromBase("contrarian_portal", "player");
    state.players.player.hand.push(returnPortal);
    api.castImmediateItem("player", returnPortal, false);
    api.resolveStudentEndTurnEffects("player");
    const returned = { count: king.aggroKingTurns, attack: king.attack };
    state.players.player.board.seats[5] = api.makeBoardCard(api.createCardFromBase("aggro_queen", "player"));
    state.players.player.board.seats[4] = api.makeBoardCard(api.createCardFromBase("aggro_student", "player"));
    state.environment = api.createCardFromBase("aggro_kingdom", "player");
    api.resolveStudentEndTurnEffects("player");
    return { first, stayed, left, returned, kingdom: { count: king.aggroKingTurns, attack: king.attack } };
  });
  expect(result).toEqual({
    first: 1, stayed: 1, left: { index: 0, count: 0 },
    returned: { count: 1, attack: 1 }, kingdom: { count: 0, attack: 1 }
  });
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
