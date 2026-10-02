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

test("37枚の定義とカード文が揃い、席制約と戦意軽減が働く", async ({ page }) => {
  const result = await page.evaluate(() => {
    const api = window.__chibattle;
    const ids = ["hat_man", "academic_move", "confucius_says", "gesture_student", "diligent_student",
      "plump_student", "aggro_princess", "aggro_walk", "red_ideology", "illness", "sick_yuta",
      "recovered_dark_yuta", "igidakatta", "contrarian_portal", "stress_hair", "laser_beam",
      "attitude", "folder_galaxy", "variable_student", "sweet_curry", "spoon_wizard",
      "adjective_vs_cynical", "suffix_sugi", "yakitori_harassment", "starbucks_student",
      "overfitting_student", "loud_typing_student", "tiny_rhythm_student", "apprentice_best_friend",
      "white_student", "true_enemy", "enemy_horde", "rear_queen", "enemy_enemy",
      "enemy_revive", "triple_enemy", "salt_to_enemy"];
    const missing = ids.filter((id) => !api.CARD_BASES[id] || !api.cardRulesText(api.createCardFromBase(id, "player")));
    const enemy = api.makeBoardCard(api.createCardFromBase("general_student", "opponent"));
    api.state.players.opponent.board.seats[0] = enemy;
    api.state.players.opponent.board.seats[3] = api.makeBoardCard(api.createCardFromBase("general_student", "opponent"));
    const hat = api.createCardFromBase("hat_man", "player");
    const diligent = api.createCardFromBase("diligent_student", "player");
    const plump = api.createCardFromBase("plump_student", "player");
    const wizard = api.createCardFromBase("spoon_wizard", "player");
    api.state.players.opponent.trash.push(api.createCardFromBase("green_curry", "opponent"));
    return { count: ids.length, missing, hatCol1: api.effectiveCardCost(hat, "seat", 6),
      hatCol2: api.effectiveCardCost(hat, "seat", 7),
      diligentFront: api.canPlaceCard("player", diligent, "seat", "player", 0),
      diligentBack: api.canPlaceCard("player", diligent, "seat", "player", 3),
      diligentTeacher: api.canPlaceCard("player", diligent, "teacher", "player", null),
      plumpTwo: api.canPlaceCard("player", plump, "seat", "player", 1),
      plumpOverflow: api.canPlaceCard("player", plump, "seat", "player", 2),
      wizardCost: api.effectiveCardCost(wizard) };
  });
  expect(result).toEqual({ count: 37, missing: [], hatCol1: 2, hatCol2: 5,
    diligentFront: true, diligentBack: false, diligentTeacher: false,
    plumpTwo: true, plumpOverflow: false, wizardCost: 0 });
});

test("アカデミックムーブは出席者に超陽気とターン終了時退場を付与する", async ({ page }) => {
  const result = await page.evaluate(() => {
    const api = window.__chibattle;
    api.state.environment = api.createCardFromBase("academic_move", "player");
    const card = api.makeBoardCard(api.createCardFromBase("general_student", "player"));
    api.attendCard("player", card, "seat", 0, { attendanceSource: api.ATTENDANCE_SOURCE.HAND });
    const cheerful = api.hasKeyword(card, "超陽気");
    api.resolveStudentEndTurnEffects("player");
    return { cheerful, removed: !api.state.players.player.board.seats[0],
      trashed: api.state.players.player.trash.some((entry) => entry.baseId === "general_student") };
  });
  expect(result).toEqual({ cheerful: true, removed: true, trashed: true });
});

test("アカデミックムーブはこのターンの出席者だけに付与し、各自のターン終了時に退場させる", async ({ page }) => {
  const result = await page.evaluate(() => {
    const api = window.__chibattle;
    const state = api.state;
    const oldCard = api.makeBoardCard(api.createCardFromBase("general_student", "player"));
    oldCard.attendanceEvent = { turn: state.actionTurn - 1 };
    state.players.player.board.seats[0] = oldCard;
    const ownEarlier = api.makeBoardCard(api.createCardFromBase("general_student", "player"));
    const opponentEarlier = api.makeBoardCard(api.createCardFromBase("general_student", "opponent"));
    api.attendCard("player", ownEarlier, "seat", 1, { attendanceSource: api.ATTENDANCE_SOURCE.HAND });
    api.attendCard("opponent", opponentEarlier, "seat", 0, { attendanceSource: api.ATTENDANCE_SOURCE.GENERATED });
    api.attendCard("player", api.createCardFromBase("academic_move", "player"), "environment", null,
      { attendanceSource: api.ATTENDANCE_SOURCE.HAND });
    const ownLater = api.makeBoardCard(api.createCardFromBase("general_student", "player"));
    api.attendCard("player", ownLater, "seat", 2, { attendanceSource: api.ATTENDANCE_SOURCE.HAND });
    const rules = api.cardRulesText(api.createCardFromBase("academic_move", "player"));
    const marked = [oldCard, ownEarlier, opponentEarlier, ownLater]
      .map((card) => Boolean(card.academicMoveMarked && api.hasKeyword(card, "超陽気")));
    api.resolveStudentEndTurnEffects("player");
    const afterPlayer = {
      old: state.players.player.board.seats[0]?.baseId,
      ownEarlier: state.players.player.board.seats[1]?.baseId || null,
      ownLater: state.players.player.board.seats[2]?.baseId || null,
      opponentEarlier: state.players.opponent.board.seats[0]?.baseId || null
    };
    api.resolveStudentEndTurnEffects("opponent");
    return { rules, marked, afterPlayer, opponentAfterOwnTurn: state.players.opponent.board.seats[0]?.baseId || null };
  });
  expect(result.rules).toBe("お互いの講義室にこのターン出席した出席者すべては[超陽気]を持つ。それらは自分のターン終了時、校外エリアへ送られる。");
  expect(result.marked).toEqual([false, true, true, true]);
  expect(result.afterPlayer).toEqual({ old: "general_student", ownEarlier: null, ownLater: null, opponentEarlier: "general_student" });
  expect(result.opponentAfterOwnTurn).toBeNull();
});

test("アカデミックムーブの戦意は5で、対戦とデッキ編成に反映される", async ({ page }) => {
  const result = await page.evaluate(() => {
    const api = window.__chibattle;
    const card = api.createCardFromBase("academic_move", "player");
    api.state.testMode = false;
    api.state.players.player.hand = [card];
    api.state.players.player.will = 4;
    const blocked = api.placeCardFromHand("player", card.instanceId, "environment", "player", null, false);
    api.state.players.player.will = 5;
    const played = api.placeCardFromHand("player", card.instanceId, "environment", "player", null, false);
    return { cost: card.cost, blocked, played, remainingWill: api.state.players.player.will };
  });
  expect(result).toEqual({ cost: 5, blocked: false, played: true, remainingWill: 0 });

  await page.goto(gameUrl);
  await page.locator("#homeNavDeckButton").click();
  await page.locator("#deckLibraryGrid .new-deck").click();
  await expect(page.locator('#deckEditorList [data-card-test="academic_move"] .deck-row-meta')).toContainText("C5");
});

test("病はU太を変化させ、別の学生へ新しい病を拡散する", async ({ page }) => {
  const result = await page.evaluate(() => {
    const api = window.__chibattle;
    const yuta = api.makeBoardCard(api.createCardFromBase("yuta", "player"));
    api.state.players.player.board.seats[0] = yuta;
    api.equipIllness("player", yuta, api.createCardFromBase("illness", "player"));
    const transformed = api.state.players.player.board.seats[0]?.baseId;
    const student = api.makeBoardCard(api.createCardFromBase("general_student", "player"));
    api.state.players.player.board.seats[1] = student;
    api.equipIllness("player", student, api.createCardFromBase("illness", "opponent"));
    const previousRandom = Math.random;
    Math.random = () => 0.99;
    api.resolveIllnessTurnStart("player");
    Math.random = previousRandom;
    return { transformed, studentIllness: student.illnessEquipments.length,
      yutaTrash: api.state.players.player.trash.some((card) => card.baseId === "yuta"),
      illnessTrash: api.state.players.player.trash.some((card) => card.baseId === "illness") };
  });
  expect(result).toEqual({ transformed: "sick_yuta", studentIllness: 2, yutaTrash: true, illnessTrash: true });
});

test("ver.0.23.8のお知らせに病に臥すU太の特殊進化条件を表示する", async ({ page }) => {
  await page.evaluate(() => document.querySelector("#homeUpdatesButton").click());
  const entry = page.locator(".update-entry").filter({ has: page.locator("summary", { hasText: "ver.0.23.8" }) });
  const group = entry.locator(".update-change").filter({ has: page.locator("strong", { hasText: /^新カード：病とU太$/ }) });
  await expect(group.locator(".update-after")).toContainText("このカードに「病」が装備されたとき、その「病」を校外エリアへ送り、このカードを「病に打ち勝った裏U太」に特殊進化させる。");
});

test("ぃぎだかったぁ...は病1枚ごとにダメージか回復を抽選する", async ({ page }) => {
  const result = await page.evaluate(() => {
    const api = window.__chibattle;
    const card = api.makeBoardCard(api.createCardFromBase("general_student", "player"));
    api.state.players.player.board.seats[0] = card;
    api.equipIllness("player", card, api.createCardFromBase("illness", "player"));
    api.equipIllness("player", card, api.createCardFromBase("illness", "opponent"));
    const item = api.createCardFromBase("igidakatta", "player");
    api.state.players.player.hand.push(item);
    const previousRandom = Math.random;
    Math.random = () => 0;
    api.castImmediateItem("player", item, false);
    Math.random = previousRandom;
    return { enemyLife: api.state.players.opponent.life, equipment: card.illnessEquipments.length,
      ownTrash: api.state.players.player.trash.filter((entry) => entry.baseId === "illness").length,
      enemyTrash: api.state.players.opponent.trash.filter((entry) => entry.baseId === "illness").length };
  });
  expect(result).toEqual({ enemyLife: 28, equipment: 0, ownTrash: 1, enemyTrash: 1 });
});

test("子曰くは宣言タイプだけを手札へ加え、残りを山札へ戻す", async ({ page }) => {
  const result = await page.evaluate(() => {
    const api = window.__chibattle;
    const first = api.createCardFromBase("general_student", "player");
    const second = api.createCardFromBase("ruler", "player");
    const third = api.createCardFromBase("hat_man", "player");
    api.state.players.player.deck = [first, second, third];
    const item = api.createCardFromBase("confucius_says", "player");
    api.state.players.player.hand = [item];
    const used = api.resolveConfuciusSays("player", item, "student", [first.instanceId, third.instanceId], false);
    return { used, hand: api.state.players.player.hand.map((card) => card.baseId).sort(),
      deck: api.state.players.player.deck.map((card) => card.baseId),
      trash: api.state.players.player.trash.map((card) => card.baseId) };
  });
  expect(result).toEqual({ used: true, hand: ["general_student", "hat_man"], deck: ["ruler"], trash: ["confucius_says"] });
});

test("スプーンの魔術師と復活の敵は選択したカードだけを処理する", async ({ page }) => {
  const result = await page.evaluate(() => {
    const api = window.__chibattle;
    const ally = api.makeBoardCard(api.createCardFromBase("general_student", "player"));
    api.state.players.player.board.seats[2] = ally;
    api.state.players.opponent.board.seats[0] = api.makeBoardCard(api.createCardFromBase("general_student", "opponent"));
    const spoon = api.createCardFromBase("spoon_wizard", "player");
    api.state.players.player.hand.push(spoon);
    api.placeCardFromHand("player", spoon.instanceId, "seat", "player", 0, false, { spoonDestroyIds: [ally.instanceId] });
    const spoonResult = { allyGone: !api.state.players.player.board.seats[2],
      enemyGone: !api.state.players.opponent.board.seats[0] };
    const enemy = api.createCardFromBase("enemy_student", "player");
    api.state.players.player.trash.push(enemy);
    const revive = api.createCardFromBase("enemy_revive", "player");
    api.state.players.player.hand.push(revive);
    api.placeCardFromHand("player", revive.instanceId, "seat", "player", 3, false, { enemyReviveIds: [enemy.instanceId] });
    return { ...spoonResult, revived: api.state.players.player.board.seats.some((card) => card?.instanceId === enemy.instanceId),
      reviveCost: api.effectiveCardCost(revive),
      leftTrash: api.state.players.player.trash.some((card) => card.instanceId === enemy.instanceId) };
  });
  expect(result).toEqual({ allyGone: true, enemyGone: true, revived: true, reviveCost: 6, leftTrash: false });
});

test("真の敵は敵を引いた場合に追加攻撃を得て出席させる", async ({ page }) => {
  const result = await page.evaluate(() => {
    const api = window.__chibattle;
    const attacker = api.makeBoardCard(api.createCardFromBase("true_enemy", "player"));
    attacker.playedOnTurn = api.state.actionTurn - 1;
    api.state.players.player.board.seats[0] = attacker;
    api.state.players.player.deck = [api.createCardFromBase("enemy_student", "player")];
    api.markCardAttackUsed(attacker);
    return { limit: api.cardAttackLimit(attacker), used: api.cardAttacksUsedThisTurn(attacker),
      summoned: api.state.players.player.board.seats.filter((card) => card?.baseId === "enemy_student").length,
      canAttackAgain: api.canAttackSilently(attacker) };
  });
  expect(result).toEqual({ limit: 2, used: 1, summoned: 1, canAttackAgain: true });
});

test("真の敵は敵とつく持ち物を引いても追加攻撃を得ない", async ({ page }) => {
  const result = await page.evaluate(() => {
    const api = window.__chibattle;
    const attacker = api.makeBoardCard(api.createCardFromBase("true_enemy", "player"));
    attacker.playedOnTurn = api.state.actionTurn - 1;
    api.state.players.player.board.seats[0] = attacker;
    api.state.players.player.deck = [api.createCardFromBase("salt_to_enemy", "player")];
    api.markCardAttackUsed(attacker);
    return {
      limit: api.cardAttackLimit(attacker),
      used: api.cardAttacksUsedThisTurn(attacker),
      hand: api.state.players.player.hand.map((card) => card.baseId),
      canAttackAgain: api.canAttackSilently(attacker),
      rules: api.cardRulesText(attacker)
    };
  });
  expect(result).toEqual({
    limit: 1,
    used: 1,
    hand: ["salt_to_enemy"],
    canAttackAgain: false,
    rules: "このカードが攻撃するとき、自分のデッキからカードを1枚引く。\nそれが「敵」とつく出席者カードなら、このカードはもう一度攻撃できる。\n自分の空いている席マスがあるなら、その出席者を出席させ、[超陽気]を付与する。"
  });
});

test("見習いベストフレンドは手札から出席した本人だけが2人まで出席させる", async ({ page }) => {
  const result = await page.evaluate(() => {
    const api = window.__chibattle;
    api.state.players.player.board.seats[0] = api.makeBoardCard(api.createCardFromBase("loud_student", "player"));
    const apprentice = api.createCardFromBase("apprentice_best_friend", "player");
    api.state.players.player.hand = [apprentice];
    const played = api.placeCardFromHand("player", apprentice.instanceId, "seat", "player", 1, false);
    const apprentices = api.state.players.player.board.seats
      .filter((card) => card?.baseId === "apprentice_best_friend");
    return {
      played,
      count: apprentices.length,
      handSourceCount: apprentices.filter((card) => card.lastAttendanceSource === api.ATTENDANCE_SOURCE.HAND).length,
      generatedSourceCount: apprentices.filter((card) => card.lastAttendanceSource === api.ATTENDANCE_SOURCE.GENERATED).length
    };
  });
  expect(result).toEqual({ played: true, count: 3, handSourceCount: 1, generatedSourceCount: 2 });
});

test("形容詞学生vs冷笑学生の表示文を既存文体へ統一する", async ({ page }) => {
  const rules = await page.evaluate(() => {
    const api = window.__chibattle;
    return api.cardRulesText(api.createCardFromBase("adjective_vs_cynical", "player"));
  });
  expect(rules).toContain("このカードを手札から出席させるとき、次の効果から1つを選ぶ。");
  expect(rules).toContain("50%の確率で、この効果を繰り返す。");
  expect(rules).not.toContain("50%の確率でもう一度");
});

test("三敵は山札上3枚から選んだ敵だけをランダムな空席に出席させる", async ({ page }) => {
  const result = await page.evaluate(() => {
    const api = window.__chibattle;
    const first = api.createCardFromBase("enemy_student", "player");
    const chosen = api.createCardFromBase("true_enemy", "player");
    const item = api.createCardFromBase("salt_to_enemy", "player");
    api.state.players.player.deck = [first, chosen, item];
    const triple = api.createCardFromBase("triple_enemy", "player");
    api.state.players.player.hand = [triple];
    api.playCard(triple.instanceId, "seat", "player", 0);
    const mode = api.state.pendingCardChoice?.mode;
    const candidates = api.state.pendingCardChoice?.cards.map((card) => card.instanceId);
    const selectableIds = api.state.pendingCardChoice?.selectableIds;
    api.state.pendingCardChoice.selectedIds = [chosen.instanceId];
    const previousRandom = Math.random;
    Math.random = () => 0.99;
    api.confirmCardChoiceSelection();
    Math.random = previousRandom;
    const summoned = api.state.players.player.board.seats[8];
    return { mode, candidates, selectableIds, summoned: summoned?.baseId, source: summoned?.lastAttendanceSource,
      deck: api.state.players.player.deck.map((card) => card.instanceId),
      firstRemains: api.state.players.player.deck.includes(first), itemRemains: api.state.players.player.deck.includes(item),
      hand: api.state.players.player.hand.map((card) => card.instanceId),
      rules: api.cardRulesText(triple), bossName: api.CARD_BASES.enemy_boss.name };
  });
  expect(result.mode).toBe("triple_enemy");
  expect(result.candidates).toHaveLength(3);
  expect(result.selectableIds).toHaveLength(2);
  expect(result.summoned).toBe("true_enemy");
  expect(result.source).toBe("deck");
  expect(result.deck).toHaveLength(2);
  expect(result.firstRemains).toBe(true);
  expect(result.itemRemains).toBe(true);
  expect(result.hand).toHaveLength(0);
  expect(result.rules).toContain("出席者カード1枚を選び");
  expect(result.rules).toContain("「敵」とつく出席者カード1枚");
  expect(result.rules).not.toContain("名前に「敵」を含む");
  expect(result.bossName).toBe("敵の幹部");
});

test("三敵は候補以外の指定を拒否し、空席がなければ山札を変えない", async ({ page }) => {
  const result = await page.evaluate(() => {
    const api = window.__chibattle;
    const enemy = api.createCardFromBase("enemy_student", "player");
    api.state.players.player.deck = [enemy];
    const triple = api.createCardFromBase("triple_enemy", "player");
    api.state.players.player.hand = [triple];
    const willBefore = api.state.players.player.will;
    const forged = api.placeCardFromHand("player", triple.instanceId, "seat", "player", 0, false,
      { tripleEnemyChoiceId: "not-in-deck" });
    const rejectedWithoutPayment = api.state.players.player.hand.includes(triple)
      && api.state.players.player.will === willBefore;
    for (let index = 1; index < 9; index += 1) {
      api.state.players.player.board.seats[index] = api.makeBoardCard(api.createCardFromBase("general_student", "player"));
    }
    const played = api.placeCardFromHand("player", triple.instanceId, "seat", "player", 0, false,
      { tripleEnemyChoiceId: enemy.instanceId });
    return { forged, rejectedWithoutPayment, played,
      deck: api.state.players.player.deck.map((card) => card.instanceId),
      board: api.state.players.player.board.seats.filter((card) => card?.instanceId === enemy.instanceId).length };
  });
  expect(result.forged).toBe(false);
  expect(result.rejectedWithoutPayment).toBe(true);
  expect(result.played).toBe(true);
  expect(result.deck).toHaveLength(1);
  expect(result.board).toBe(0);
});

test("敵に塩は戦意2のまま相手の指定空席へTRPGサークルメンバーを出席させ、その出席時効果を発動する", async ({ page }) => {
  const result = await page.evaluate(() => {
    const api = window.__chibattle;
    const item = api.createCardFromBase("salt_to_enemy", "player");
    api.state.players.player.hand.push(item);
    api.state.players.opponent.deck = [
      api.createCardFromBase("general_student", "opponent"),
      api.createCardFromBase("enemy_student", "opponent"),
      api.createCardFromBase("aggro_student", "opponent"),
      api.createCardFromBase("ruler", "opponent")
    ];
    const used = api.castCaptureOnSlot("player", item, "opponent", "seat", 7, false);
    return {
      used,
      cost: api.effectiveCardCost(item),
      rules: api.cardRulesText(item),
      placed: api.state.players.opponent.board.seats[7]?.baseId,
      opponentHand: api.state.players.opponent.hand.map((card) => card.baseId).sort(),
      opponentDeck: api.state.players.opponent.deck.map((card) => card.baseId),
      discarded: api.state.players.player.trash.some((card) => card.baseId === "salt_to_enemy")
    };
  });
  expect(result).toEqual({
    used: true,
    cost: 2,
    rules: "相手の講義室の空いている席マス1つを選び、そこに「TRPGサークルメンバー」1人を出席させる。\nその出席時効果は発動する。",
    placed: "trpg_member",
    opponentHand: ["aggro_student", "enemy_student", "general_student"],
    opponentDeck: ["ruler"],
    discarded: true
  });
});

test("ver.0.23.10の更新情報に同日分のカード調整をまとめて表示する", async ({ page }) => {
  await page.evaluate(() => {
    window.__chibattle.state.screen = "home";
    window.__chibattle.render();
  });
  await page.locator("#homeUpdatesButton").click();
  const entry = page.locator(".update-entry").filter({ has: page.locator("summary", { hasText: "ver.0.23.10" }) });
  await expect(entry).toHaveCount(1);
  await expect(entry).toContainText("出席時効果が発動するように変更");
  await expect(entry).toContainText("戦意2は維持");
  await expect(entry).toContainText("手札に「敵」1枚を生成");
  await expect(entry).toContainText("デッキと校外エリアには生成しません");
  await expect(entry).toContainText("復活の敵");
  await expect(entry).toContainText("戦意6");
  await expect(entry).toContainText("スタディアブローダー");
  await expect(entry).toContainText("手札から教卓マスに出席させたとき");
  await expect(entry).toContainText("相手の講義室にいる出席者すべてに2ダメージ");
});

test("子曰くの二段階UIでタイプを宣言してカードを選べる", async ({ page }) => {
  const result = await page.evaluate(() => {
    const api = window.__chibattle;
    const student = api.createCardFromBase("hat_man", "player");
    api.state.players.player.deck = [student, api.createCardFromBase("ruler", "player")];
    const item = api.createCardFromBase("confucius_says", "player");
    api.state.players.player.hand = [item];
    api.beginItemUse(item);
    const firstMode = api.state.pendingCardChoice?.mode;
    api.state.pendingCardChoice.selectedIds = ["confucius_student"];
    api.confirmCardChoiceSelection();
    const secondMode = api.state.pendingCardChoice?.mode;
    const selectableIds = api.state.pendingCardChoice?.selectableIds;
    api.state.pendingCardChoice.selectedIds = [student.instanceId];
    api.confirmCardChoiceSelection();
    return { firstMode, secondMode, selectableIds,
      added: api.state.players.player.hand.some((card) => card.instanceId === student.instanceId) };
  });
  expect(result).toEqual({ firstMode: "confucius_type", secondMode: "confucius_pick",
    selectableIds: expect.any(Array), added: true });
  expect(result.selectableIds).toHaveLength(1);
});

test("形容詞学生vs冷笑学生は出席前の選択UIから弱体化を実行する", async ({ page }) => {
  const result = await page.evaluate(() => {
    const api = window.__chibattle;
    const card = api.createCardFromBase("adjective_vs_cynical", "player");
    api.state.players.player.hand = [card];
    const enemy = api.makeBoardCard(api.createCardFromBase("general_student", "opponent"));
    api.state.players.opponent.board.seats[0] = enemy;
    api.playCard(card.instanceId, "seat", "player", 0);
    const mode = api.state.pendingCardChoice?.mode;
    api.state.pendingCardChoice.selectedIds = ["adjective_weaken"];
    api.confirmCardChoiceSelection();
    return { mode, placed: api.state.players.player.board.seats[0]?.baseId,
      secondSeat: api.state.players.player.board.seats[1]?.baseId,
      enemyAttack: enemy.attack };
  });
  expect(result).toEqual({ mode: "adjective_choice", placed: "adjective_vs_cynical",
    secondSeat: "adjective_vs_cynical", enemyAttack: 0 });
});

test("形容詞学生vs冷笑学生の盤面名はPCとスマホの横2席カード内に収まる", async ({ page }) => {
  await page.evaluate(() => {
    const api = window.__chibattle;
    const card = api.makeBoardCard(api.createCardFromBase("adjective_vs_cynical", "player"));
    api.attendCard("player", card, "seat", 0, { attendanceSource: api.ATTENDANCE_SOURCE.GENERATED });
    api.render();
  });

  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    const name = page.locator('.multi-seat-board-card[data-base-id="adjective_vs_cynical"] .field-card-art-name');
    const metrics = await name.evaluate((element) => ({
      text: element.textContent.trim(),
      height: element.clientHeight,
      contentHeight: element.scrollHeight,
      width: element.clientWidth,
      contentWidth: element.scrollWidth
    }));
    expect(metrics.text).toBe("形容詞学生vs冷笑学生");
    expect(metrics.contentHeight, `${width}pxでカード名が縦にはみ出しています`).toBeLessThanOrEqual(metrics.height);
    expect(metrics.contentWidth, `${width}pxでカード名が横にはみ出しています`).toBeLessThanOrEqual(metrics.width);
  }
});

test("負荷カード、敵の群れ、ジェスチャー学生の手札・山札効果", async ({ page }) => {
  const result = await page.evaluate(() => {
    const api = window.__chibattle;
    api.state.players.opponent.hand = [api.createCardFromBase("ruler", "opponent")];
    api.attendCard("player", api.makeBoardCard(api.createCardFromBase("white_student", "player")), "seat", 0,
      { attendanceSource: api.ATTENDANCE_SOURCE.HAND });
    const load = api.state.players.opponent.hand[0].handLoadLevel;
    api.attendCard("player", api.makeBoardCard(api.createCardFromBase("gesture_student", "player")), "seat", 1,
      { attendanceSource: api.ATTENDANCE_SOURCE.HAND });
    const gestures = api.state.players.player.hand.filter((card) => card.baseId === "three_gestures").length;
    api.attendCard("player", api.makeBoardCard(api.createCardFromBase("enemy_horde", "player")), "seat", 2,
      { attendanceSource: api.ATTENDANCE_SOURCE.HAND });
    return { load, gestures, enemyRules: api.cardRulesText(api.createCardFromBase("enemy_horde", "player")),
      enemyHand: api.state.players.player.hand.filter((card) => card.baseId === "enemy_student").length,
      enemyDeck: api.state.players.player.deck.filter((card) => card.baseId === "enemy_student").length,
      enemyTrash: api.state.players.player.trash.filter((card) => card.baseId === "enemy_student").length,
      enemyBoard: api.state.players.player.board.seats.filter((card) => card?.baseId === "enemy_student").length };
  });
  expect(result).toEqual({
    load: 1,
    gestures: 2,
    enemyRules: "このカードを手札から出席させたとき、自分の手札に「敵」1枚を生成する。その後、自分の空いている席マスに「敵」1人をランダムに出席させる。",
    enemyHand: 1,
    enemyDeck: 0,
    enemyTrash: 0,
    enemyBoard: 1
  });
});

test("レーザービーム、アグロ散歩、焼き鳥ハラスメントは対象にだけ作用する", async ({ page }) => {
  const result = await page.evaluate(() => {
    const api = window.__chibattle;
    const aggro = api.makeBoardCard(api.createCardFromBase("aggro_princess", "player"));
    api.state.players.player.board.seats[0] = aggro;
    const walk = api.createCardFromBase("aggro_walk", "player");
    api.state.players.player.hand.push(walk);
    api.castItemOnCard("player", walk, "player", "seat", 0, false);
    const buff = { attack: aggro.attack, hp: aggro.maxHp };
    aggro.currentHp = 1;
    const yakitori = api.createCardFromBase("yakitori_harassment", "player");
    api.state.players.player.hand.push(yakitori);
    const beforeWill = api.state.players.player.will;
    api.castItemOnCard("player", yakitori, "player", "seat", 0, false);
    const enemy = api.makeBoardCard(api.createCardFromBase("loud_student", "opponent"));
    api.state.players.opponent.board.seats[6] = enemy;
    const enemyBefore = enemy.currentHp;
    const laser = api.createCardFromBase("laser_beam", "player");
    api.state.players.player.hand.push(laser);
    const hit = api.castItemOnCard("player", laser, "opponent", "seat", 6, false);
    return { buff, healedHp: aggro.currentHp, willGain: api.state.players.player.will - beforeWill,
      hit, enemyBefore, enemyHp: enemy.currentHp };
  });
  expect(result.buff).toEqual({ attack: 3, hp: 3 });
  expect(result.healedHp).toBe(3);
  expect(result.willGain).toBeGreaterThanOrEqual(-3);
  expect(result.hit).toBe(true);
  expect(result.enemyHp).toBe(result.enemyBefore - 5);
});

test("ストレスヘアーは次の相手ターン終了時に外れて+4/+4になる", async ({ page }) => {
  const result = await page.evaluate(() => {
    const api = window.__chibattle;
    const yuta = api.makeBoardCard(api.createCardFromBase("yuta", "player"));
    api.state.players.player.board.seats[0] = yuta;
    const before = { attack: yuta.attack, hp: yuta.maxHp };
    const hair = api.createCardFromBase("stress_hair", "player");
    api.state.players.player.hand.push(hair);
    api.castItemOnCard("player", hair, "player", "seat", 0, false);
    api.state.actionTurn += 1;
    api.resolveEndTurnEffects("opponent");
    return { attackGain: yuta.attack - before.attack, hpGain: yuta.maxHp - before.hp,
      removed: !yuta.stressHairEquipment,
      hairTrash: api.state.players.player.trash.some((card) => card.baseId === "stress_hair") };
  });
  expect(result).toEqual({ attackGain: 4, hpGain: 4, removed: true, hairTrash: true });
});

test("ストレスヘアーと従来のU太装備は同じ1枚枠を使う", async ({ page }) => {
  const result = await page.evaluate(() => {
    const api = window.__chibattle;
    const yuta = api.makeBoardCard(api.createCardFromBase("yuta", "player"));
    api.state.players.player.board.seats[0] = yuta;
    const hair = api.createCardFromBase("stress_hair", "player");
    const happi = api.createCardFromBase("red_happi", "player");
    api.state.players.player.hand.push(hair, happi);
    const first = api.castItemOnCard("player", hair, "player", "seat", 0, false);
    const secondHair = api.canUseItemOnBoardTarget(api.createCardFromBase("stress_hair", "player"), "player", "seat", 0);
    const conventional = api.canUseItemOnBoardTarget(happi, "player", "seat", 0);
    const dark = api.makeBoardCard(api.createCardFromBase("dark_yuta", "player"));
    api.state.players.player.board.seats[1] = dark;
    const darkHair = api.createCardFromBase("stress_hair", "player");
    api.state.players.player.hand.push(darkHair);
    api.castItemOnCard("player", darkHair, "player", "seat", 1, false);
    return { first, secondHair, conventional, detail: api.equipmentDetailText(yuta),
      darkCheerful: api.hasKeyword(dark, "陽気"),
      darkSecondBlocked: !api.canUseItemOnBoardTarget(happi, "player", "seat", 1) };
  });
  expect(result.first).toBe(true);
  expect(result.secondHair).toBe(false);
  expect(result.conventional).toBe(false);
  expect(result.detail).toContain("ストレスヘアー");
  expect(result.darkCheerful).toBe(true);
  expect(result.darkSecondBlocked).toBe(true);
});

test("従来の装備が先についていてもストレスヘアーを重ねられない", async ({ page }) => {
  const result = await page.evaluate(() => {
    const api = window.__chibattle;
    const yuta = api.makeBoardCard(api.createCardFromBase("yuta", "player"));
    api.state.players.player.board.seats[0] = yuta;
    const happi = api.createCardFromBase("red_happi", "player");
    const hair = api.createCardFromBase("stress_hair", "player");
    api.state.players.player.hand.push(happi, hair);
    const first = api.castItemOnCard("player", happi, "player", "seat", 0, false);
    const canTarget = api.canUseItemOnBoardTarget(hair, "player", "seat", 0);
    const second = api.castItemOnCard("player", hair, "player", "seat", 0, false);
    return { first, canTarget, second, hairStillInHand: api.state.players.player.hand.includes(hair),
      equipment: api.equipmentDetailText(yuta) };
  });
  expect(result).toEqual({ first: true, canTarget: false, second: false, hairStillInHand: true,
    equipment: "装備：赤はっぴ" });
});

test("赤色の思想と逆張りポータルは席配置を変更する", async ({ page }) => {
  const result = await page.evaluate(() => {
    const api = window.__chibattle;
    const first = api.makeBoardCard(api.createCardFromBase("general_student", "player"));
    const third = api.makeBoardCard(api.createCardFromBase("hat_man", "player"));
    api.state.players.player.board.seats[2] = first;
    api.state.players.player.board.seats[8] = third;
    const red = api.createCardFromBase("red_ideology", "player");
    api.state.players.player.hand.push(red);
    api.castImmediateItem("player", red, false);
    const packed = [api.state.players.player.board.seats[0]?.baseId, api.state.players.player.board.seats[6]?.baseId];
    const portal = api.createCardFromBase("contrarian_portal", "player");
    api.state.players.player.hand.push(portal);
    api.castImmediateItem("player", portal, false);
    return { packed, swapped: [api.state.players.player.board.seats[0]?.baseId,
      api.state.players.player.board.seats[6]?.baseId] };
  });
  expect(result).toEqual({ packed: ["general_student", "hat_man"],
    swapped: ["hat_man", "general_student"] });
});

test("横2席の出席者も左詰めと1・3行入れ替えで占有マスを保つ", async ({ page }) => {
  const result = await page.evaluate(() => {
    const api = window.__chibattle;
    const plump = api.makeBoardCard(api.createCardFromBase("plump_student", "player"));
    api.attendCard("player", plump, "seat", 1);
    const red = api.createCardFromBase("red_ideology", "player");
    api.state.players.player.hand.push(red);
    api.castImmediateItem("player", red, false);
    const afterRed = [0, 1, 2].map((index) => api.state.players.player.board.seats[index]?.instanceId || null);
    const portal = api.createCardFromBase("contrarian_portal", "player");
    api.state.players.player.hand.push(portal);
    api.castImmediateItem("player", portal, false);
    const afterPortal = [6, 7, 8].map((index) => api.state.players.player.board.seats[index]?.instanceId || null);
    return { id: plump.instanceId, afterRed, afterPortal, anchor: plump.seatAnchorIndex };
  });
  expect(result.afterRed).toEqual([result.id, result.id, null]);
  expect(result.afterPortal).toEqual([result.id, result.id, null]);
  expect(result.anchor).toBe(6);
});

test("熱心な学生は相手教師の講義を回復に変え、変数学生は出席後の席を動かす", async ({ page }) => {
  const result = await page.evaluate(() => {
    const api = window.__chibattle;
    const diligent = api.makeBoardCard(api.createCardFromBase("diligent_student", "player"));
    diligent.currentHp = 2;
    api.state.players.player.board.seats[0] = diligent;
    const teacher = api.makeBoardCard(api.createCardFromBase("general_teacher", "opponent"));
    api.state.players.opponent.board.teacher = teacher;
    const dealt = api.dealDamageToCard(diligent, 1, teacher, { damageKind: "lecture" });
    api.state.players.opponent.board.seats[0] = api.makeBoardCard(api.createCardFromBase("variable_student", "opponent"));
    const moved = api.makeBoardCard(api.createCardFromBase("general_student", "player"));
    const previousRandom = Math.random;
    Math.random = () => 0;
    api.attendCard("player", moved, "seat", 3, { attendanceSource: api.ATTENDANCE_SOURCE.HAND });
    Math.random = previousRandom;
    return { dealt, diligentHp: diligent.currentHp, sourceEmpty: !api.state.players.player.board.seats[3],
      movedSeat: api.state.players.player.board.seats.findIndex((card) => card?.instanceId === moved.instanceId) };
  });
  expect(result).toEqual({ dealt: 0, diligentHp: 3, sourceEmpty: true, movedSeat: 1 });
});

test("変数学生のテキストは席マスの出席者だけを移動させることを明記する", async ({ page }) => {
  const rules = await page.evaluate(() => {
    const api = window.__chibattle;
    return api.cardRulesText(api.createCardFromBase("variable_student", "player"));
  });
  expect(rules).toBe("このカードが講義室にいるかぎり、相手の席マスに出席者が出席するたび、その出席者を相手の空いている席マス1つへランダムに移動させる。");
});

test("バカでかいタイピング音は周囲8方向と相手学生にダメージ", async ({ page }) => {
  const result = await page.evaluate(() => {
    const api = window.__chibattle;
    const ally = api.makeBoardCard(api.createCardFromBase("loud_student", "player"));
    const enemy = api.makeBoardCard(api.createCardFromBase("loud_student", "opponent"));
    api.state.players.player.board.seats[0] = ally;
    api.state.players.opponent.board.seats[0] = enemy;
    api.attendCard("player", api.makeBoardCard(api.createCardFromBase("loud_typing_student", "player")),
      "seat", 4, { attendanceSource: api.ATTENDANCE_SOURCE.HAND });
    return { allyHp: ally.currentHp, enemyHp: enemy.currentHp };
  });
  expect(result).toEqual({ allyHp: 8, enemyHp: 4 });
});

test("ア↑ティ↓テュードは相手学生を空の教卓へ移し、甘いカレーはヴァンパイアを破壊", async ({ page }) => {
  const result = await page.evaluate(() => {
    const api = window.__chibattle;
    const target = api.makeBoardCard(api.createCardFromBase("general_student", "opponent"));
    api.state.players.opponent.board.seats[0] = target;
    api.state.players.player.board.seats[0] = api.makeBoardCard(api.createCardFromBase("variable_student", "player"));
    const attitude = api.createCardFromBase("attitude", "player");
    api.state.players.player.hand.push(attitude);
    const cost = api.effectiveCardCost(attitude);
    const moved = api.castItemOnCard("player", attitude, "opponent", "seat", 0, false);
    const vampire = api.makeBoardCard(api.createCardFromBase("apprentice_vampire", "opponent"));
    api.state.players.opponent.board.seats[1] = vampire;
    const curry = api.createCardFromBase("sweet_curry", "player");
    api.state.players.player.hand.push(curry);
    api.castImmediateItem("player", curry, false);
    return { cost, moved, teacher: api.state.players.opponent.board.teacher?.instanceId === target.instanceId,
      seatEmpty: !api.state.players.opponent.board.seats[0],
      vampireGone: !api.state.players.opponent.board.seats[1] };
  });
  expect(result).toEqual({ cost: 2, moved: true, teacher: true, seatEmpty: true, vampireGone: true });
});

test("スタバ学生は自分の学生へ1ダメージ後に校外の教師を手札出席扱いで教卓へ戻す", async ({ page }) => {
  const result = await page.evaluate(() => {
    const api = window.__chibattle;
    const teacher = api.createCardFromBase("general_teacher", "player");
    api.state.players.player.trash.push(teacher);
    const student = api.makeBoardCard(api.createCardFromBase("loud_student", "player"));
    api.state.players.player.board.seats[2] = student;
    const starbucks = api.createCardFromBase("starbucks_student", "player");
    api.state.players.player.hand.push(starbucks);
    api.placeCardFromHand("player", starbucks.instanceId, "seat", "player", 0, false,
      { starbucksTeacherId: teacher.instanceId });
    return { studentHp: student.currentHp, teacher: api.state.players.player.board.teacher?.baseId,
      source: api.state.players.player.board.teacher?.lastAttendanceSource,
      teacherRemovedFromTrash: !api.state.players.player.trash.some((card) => card.instanceId === teacher.instanceId) };
  });
  expect(result).toEqual({ studentHp: 8, teacher: "general_teacher", source: "hand", teacherRemovedFromTrash: true });
});

test("任意枚数と校外カードの選択UIから出席を確定できる", async ({ page }) => {
  const result = await page.evaluate(() => {
    const api = window.__chibattle;
    const spoon = api.createCardFromBase("spoon_wizard", "player");
    api.state.players.player.hand.push(spoon);
    api.playCard(spoon.instanceId, "seat", "player", 0);
    const spoonMode = api.state.pendingCardChoice?.mode;
    api.confirmCardChoiceSelection();
    const spoonPlaced = api.state.players.player.board.seats[0]?.baseId === "spoon_wizard";

    const enemy = api.createCardFromBase("enemy_student", "player");
    api.state.players.player.trash.push(enemy);
    const revive = api.createCardFromBase("enemy_revive", "player");
    api.state.players.player.hand.push(revive);
    api.playCard(revive.instanceId, "seat", "player", 3);
    const reviveMode = api.state.pendingCardChoice?.mode;
    api.state.pendingCardChoice.selectedIds = [enemy.instanceId];
    api.confirmCardChoiceSelection();
    const revived = api.state.players.player.board.seats.some((card) => card?.instanceId === enemy.instanceId);

    const teacher = api.createCardFromBase("general_teacher", "player");
    api.state.players.player.trash.push(teacher);
    const starbucks = api.createCardFromBase("starbucks_student", "player");
    api.state.players.player.hand.push(starbucks);
    api.playCard(starbucks.instanceId, "seat", "player", 6);
    const teacherMode = api.state.pendingCardChoice?.mode;
    api.state.pendingCardChoice.selectedIds = [teacher.instanceId];
    api.confirmCardChoiceSelection();
    return { spoonMode, spoonPlaced, reviveMode, revived, teacherMode,
      teacherPlaced: api.state.players.player.board.teacher?.instanceId === teacher.instanceId };
  });
  expect(result).toEqual({ spoonMode: "spoon_destroy", spoonPlaced: true,
    reviveMode: "enemy_revive", revived: true, teacherMode: "starbucks_teacher", teacherPlaced: true });
});

test("裏U太の進化で相手全員に病を付与し、後ろにいるクイーンは終了時に4ダメージ", async ({ page }) => {
  const result = await page.evaluate(() => {
    const api = window.__chibattle;
    const evolved = api.makeBoardCard(api.createCardFromBase("recovered_dark_yuta", "player"));
    api.state.players.player.board.seats[0] = evolved;
    const student = api.makeBoardCard(api.createCardFromBase("loud_student", "opponent"));
    api.state.players.opponent.board.seats[0] = student;
    api.resolveEvolutionEffect("player", evolved);
    const illnessCount = student.illnessEquipments?.length || 0;
    api.state.players.player.board.seats[1] = api.makeBoardCard(api.createCardFromBase("rear_queen", "player"));
    const hpBefore = student.currentHp;
    api.resolveStudentEndTurnEffects("player");
    return { illnessCount, queenDamage: hpBefore - student.currentHp };
  });
  expect(result).toEqual({ illnessCount: 1, queenDamage: 4 });
});
