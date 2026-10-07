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
    for (const side of ["player", "opponent"]) {
      api.state.players[side].board = { teacher: null, seats: Array(9).fill(null) };
      api.state.players[side].hand = [];
      api.state.players[side].attendancesThisTurn = 0;
      api.state.players[side].will = 20;
    }
  });
});

test("ベストフレンドはバカでかいカードに隣接すると強化され、その効果ダメージを受けない", async ({ page }) => {
  const result = await page.evaluate(() => {
    const api = window.__chibattle;
    const friend = api.makeBoardCard(api.createCardFromBase("best_friend", "player"));
    const big = api.makeBoardCard(api.createCardFromBase("loud_members", "player"));
    const target = api.makeBoardCard(api.createCardFromBase("general_student", "opponent"));
    api.state.players.player.board.seats[0] = friend;
    api.state.players.player.board.seats[1] = big;
    api.state.players.opponent.board.seats[0] = target;
    api.applyBoardAuras();
    const buffed = { attack: friend.attack, hp: friend.maxHp };
    const damage = api.dealDamageToCard(friend, 2, big);
    const hpAfterDamage = friend.currentHp;
    api.resolveEndTurnEffects("player");
    return {
      buffed,
      damage,
      hpAfterDamage,
      targetHpAfterTurn: target.currentHp,
      rules: api.cardRulesText(api.createCardFromBase("best_friend", "player"))
    };
  });

  expect(result.buffed).toEqual({ attack: 3, hp: 4 });
  expect(result.damage).toBe(0);
  expect(result.hpAfterDamage).toBe(4);
  expect(result.targetHpAfterTurn).toBe(2);
  expect(result.rules).toContain("自分のデッキから「バカでかい」とつくカード1枚を手札に加える");
  expect(result.rules).toContain("「バカでかい」とつくカードの効果によるダメージを受けない");
  expect(result.rules).not.toContain("名前に「バカでかい」を含む");
  expect(result.rules).not.toContain("3ダメージ");
});

test("ベストフレンドは手札から出席した場合だけバカでかいカードを1枚引く", async ({ page }) => {
  const result = await page.evaluate(() => {
    const api = window.__chibattle;
    const first = api.createCardFromBase("loud_student", "player");
    const second = api.createCardFromBase("loud_typing_student", "player");
    api.state.players.player.deck = [api.createCardFromBase("ruler", "player"), first, second];
    const friend = api.makeBoardCard(api.createCardFromBase("best_friend", "player"));
    api.attendCard("player", friend, "seat", 0, { attendanceSource: api.ATTENDANCE_SOURCE.HAND });
    const handAfterFirst = api.state.players.player.hand.map((card) => card.instanceId);
    const generated = api.makeBoardCard(api.createCardFromBase("best_friend", "player"));
    api.attendCard("player", generated, "seat", 3, { attendanceSource: api.ATTENDANCE_SOURCE.GENERATED });
    return { drewFirst: handAfterFirst.includes(first.instanceId), drewSecond: handAfterFirst.includes(second.instanceId),
      handSizeAfterGenerated: api.state.players.player.hand.length,
      secondStillInDeck: api.state.players.player.deck.some((card) => card.instanceId === second.instanceId) };
  });
  expect(result).toEqual({ drewFirst: true, drewSecond: false, handSizeAfterGenerated: 1, secondStillInDeck: true });
});

test("敵はTRPGサークルメンバーがいても戦意2のまま攻撃力+5と陽気を得て、4枚以上入れられる", async ({ page }) => {
  const result = await page.evaluate(() => {
    const api = window.__chibattle;
    const enemy = api.makeBoardCard(api.createCardFromBase("enemy_student", "player"));
    const inHand = api.createCardFromBase("enemy_student", "player");
    api.state.players.player.hand = [inHand];
    api.state.players.player.board.seats[0] = enemy;
    const before = api.effectiveCardCost(inHand);
    api.state.players.opponent.board.seats[0] = api.makeBoardCard(api.createCardFromBase("trpg_member", "opponent"));
    api.applyBoardAuras();
    const active = { cost: api.effectiveCardCost(inHand), attack: enemy.attack, cheerful: api.hasKeyword(enemy, "陽気") };
    api.state.players.opponent.board.seats[0] = null;
    api.applyBoardAuras();
    return { before, active, after: api.effectiveCardCost(inHand), limit: api.maxCopiesForCard("enemy_student") };
  });

  expect(result).toEqual({ before: 2, active: { cost: 2, attack: 6, cheerful: true }, after: 2, limit: 60 });
});

test("アクティングアウトマンは相手の出席を制限しない", async ({ page }) => {
  const result = await page.evaluate(() => {
    const api = window.__chibattle;
    const actor = api.makeBoardCard(api.createCardFromBase("acting_out_man", "opponent"));
    api.state.players.opponent.board.seats[0] = actor;
    const first = api.attendCard("player", api.makeBoardCard(api.createCardFromBase("general_student", "player")), "seat", 0);
    const secondCard = api.makeBoardCard(api.createCardFromBase("general_student", "player"));
    const available = api.canPlaceCard("player", secondCard, "seat", "player", 1);
    const second = api.attendCard("player", secondCard, "seat", 1);
    return { first: Boolean(first), available, second: Boolean(second) };
  });

  expect(result).toEqual({ first: true, available: true, second: true });
});

test("アクティングアウトマンは環境を戦意なしで上書きし、環境の出したときの効果を使う", async ({ page }) => {
  const result = await page.evaluate(() => {
    const api = window.__chibattle;
    const { state } = api;
    const actor = api.createCardFromBase("acting_out_man", "player");
    const environment = api.createCardFromBase("shogi_duel_field", "player");
    const previous = api.makeBoardCard(api.createCardFromBase("classroom", "opponent"));
    state.players.player.hand = [actor, environment];
    state.players.player.will = 6;
    state.players.player.life = 20;
    state.players.opponent.life = 20;
    state.environment = previous;
    const text = api.cardRulesText(actor);
    const placed = api.placeCardFromHand("player", actor.instanceId, "seat", "player", 0, false,
      { actingOutEnvironmentId: environment.instanceId });
    return {
      text, placed, will: state.players.player.will,
      actor: { attack: state.players.player.board.seats[0]?.attack, hp: state.players.player.board.seats[0]?.currentHp },
      environment: state.environment?.baseId,
      previousTrashed: state.players.opponent.trash.some((card) => card.instanceId === previous.instanceId),
      remainingHand: state.players.player.hand.length,
      life: [state.players.player.life, state.players.opponent.life]
    };
  });
  expect(result).toEqual({
    text: "このカードを手札から出席させたとき、自分の手札にある環境カード1枚を、戦意を払わずに環境マスへ出してよい。",
    placed: true, will: 0, actor: { attack: 2, hp: 2 }, environment: "shogi_duel_field",
    previousTrashed: true, remainingHand: 0, life: [10, 10]
  });
});

test("アクティングアウトマンは環境を選ばずに出席でき、不正な環境は選べない", async ({ page }) => {
  const result = await page.evaluate(() => {
    const api = window.__chibattle;
    const { state } = api;
    const actor = api.createCardFromBase("acting_out_man", "player");
    const environment = api.createCardFromBase("cafeteria", "player");
    const opponentEnvironment = api.createCardFromBase("classroom", "opponent");
    state.players.player.hand = [actor, environment];
    state.players.opponent.hand = [opponentEnvironment];
    api.playCard(actor.instanceId, "seat", "player", 0);
    const choice = { mode: state.pendingCardChoice?.mode, min: state.pendingCardChoice?.min,
      max: state.pendingCardChoice?.max, cards: state.pendingCardChoice?.cards.map((card) => card.baseId) };
    state.pendingCardChoice.selectedIds = [];
    api.confirmCardChoiceSelection();
    const skipped = { actor: state.players.player.board.seats[0]?.baseId,
      environment: state.environment?.baseId || null, hand: state.players.player.hand.map((card) => card.baseId) };
    const secondActor = api.createCardFromBase("acting_out_man", "player");
    state.players.player.hand.push(secondActor);
    const invalid = api.placeCardFromHand("player", secondActor.instanceId, "seat", "player", 1, false,
      { actingOutEnvironmentId: opponentEnvironment.instanceId });
    return { choice, skipped, invalid, secondStillInHand: state.players.player.hand.includes(secondActor) };
  });
  expect(result).toEqual({
    choice: { mode: "acting_out_environment", min: 0, max: 1, cards: ["cafeteria"] },
    skipped: { actor: "acting_out_man", environment: null, hand: ["cafeteria"] },
    invalid: false, secondStillInHand: true
  });
});

test("アクティングアウトマンは効果出席では環境を出さず、AIは使える環境を選ぶ", async ({ page }) => {
  const result = await page.evaluate(() => {
    const api = window.__chibattle;
    const { state } = api;
    const generated = api.makeBoardCard(api.createCardFromBase("acting_out_man", "player"));
    const held = api.createCardFromBase("cafeteria", "player");
    generated.actingOutEnvironmentId = held.instanceId;
    state.players.player.hand = [held];
    api.attendCard("player", generated, "seat", 0, { attendanceSource: "generated" });
    const generatedResult = { environment: state.environment?.baseId || null, hand: state.players.player.hand.length };
    state.currentSide = "opponent";
    const actor = api.createCardFromBase("acting_out_man", "opponent");
    const environment = api.createCardFromBase("cafeteria", "opponent");
    state.players.opponent.hand = [actor, environment];
    state.players.opponent.will = 6;
    const aiPlaced = api.placeCardFromHand("opponent", actor.instanceId, "seat", "opponent", 0, false);
    return { generatedResult, aiPlaced, aiEnvironment: state.environment?.baseId || null,
      aiWill: state.players.opponent.will };
  });
  expect(result).toEqual({
    generatedResult: { environment: null, hand: 1 },
    aiPlaced: true, aiEnvironment: "cafeteria", aiWill: 0
  });
});

test("手札から出席させた扱いなら相手ターン中でも環境を無料で出す", async ({ page }) => {
  const result = await page.evaluate(() => {
    const api = window.__chibattle;
    const { state } = api;
    state.currentSide = "opponent";
    const actor = api.makeBoardCard(api.createCardFromBase("acting_out_man", "player"));
    const environment = api.createCardFromBase("cafeteria", "player");
    actor.actingOutEnvironmentId = environment.instanceId;
    state.players.player.hand = [environment];
    state.players.player.will = 0;
    const placed = api.attendCard("player", actor, "seat", 0, { attendanceSource: "hand" });
    return { placed: Boolean(placed), environment: state.environment?.baseId,
      will: state.players.player.will, hand: state.players.player.hand.length };
  });
  expect(result).toEqual({ placed: true, environment: "cafeteria", will: 0, hand: 0 });
});

test("アクティングアウトマンのカードテストには上書き元と環境の選択肢がある", async ({ page }) => {
  const result = await page.evaluate(() => {
    const api = window.__chibattle;
    api.startCardTest("acting_out_man");
    return { hand: api.state.players.player.hand.map((card) => card.baseId),
      environment: api.state.environment?.baseId };
  });
  expect(result.hand).toEqual(expect.arrayContaining(["acting_out_man", "cafeteria", "aggro_dome"]));
  expect(result.environment).toBe("classroom");
});

test("スマホ幅でもアクティングアウトマンの環境選択を表示して確定できる", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => {
    const api = window.__chibattle;
    const actor = api.createCardFromBase("acting_out_man", "player");
    const environment = api.createCardFromBase("cafeteria", "player");
    api.state.players.player.hand = [actor, environment];
    api.playCard(actor.instanceId, "seat", "player", 0);
  });
  const stage = page.locator("#threeGesturesStage");
  await expect(stage).toBeVisible();
  await expect(stage.locator(".mulligan-card")).toHaveCount(1);
  await expect(page.locator("#threeGesturesConfirmButton")).toBeEnabled();
});

test("バカでかい声の学生は他の出席者へ1ダメージを与え、ベストフレンドと隣接すると超陽気を持つ", async ({ page }) => {
  const result = await page.evaluate(() => {
    const api = window.__chibattle;
    const friend = api.makeBoardCard(api.createCardFromBase("best_friend", "player"));
    const ally = api.makeBoardCard(api.createCardFromBase("general_student", "player"));
    const opponent = api.makeBoardCard(api.createCardFromBase("general_student", "opponent"));
    api.state.players.player.board.seats[0] = friend;
    api.state.players.player.board.seats[3] = ally;
    api.state.players.opponent.board.seats[0] = opponent;
    const loud = api.makeBoardCard(api.createCardFromBase("loud_student", "player"));
    api.attendCard("player", loud, "seat", 1, { attendanceSource: api.ATTENDANCE_SOURCE.HAND });
    api.applyBoardAuras();
    return {
      friendHp: friend.currentHp,
      allyHp: ally.currentHp,
      opponentHp: opponent.currentHp,
      loudHp: loud.currentHp,
      hyperCheerful: api.hasKeyword(loud, "超陽気")
    };
  });

  expect(result).toEqual({ friendHp: 4, allyHp: 1, opponentHp: 1, loudHp: 9, hyperCheerful: true });
});

test("スタディアブローダーは手札から教卓マスに出席したときだけ全体ダメージと負荷を与える", async ({ page }) => {
  const result = await page.evaluate(() => {
    const api = window.__chibattle;
    const player = api.state.players.player;
    const opponent = api.state.players.opponent;
    const loaded = api.createCardFromBase("general_student", "opponent");
    opponent.hand = [loaded];
    const seatTarget = api.makeBoardCard(api.createCardFromBase("general_student", "opponent"));
    seatTarget.maxHp = 10;
    seatTarget.currentHp = 10;
    opponent.board.seats[8] = seatTarget;
    const teacherTarget = api.makeBoardCard(api.createCardFromBase("general_teacher", "opponent"));
    teacherTarget.maxHp = 10;
    teacherTarget.currentHp = 10;
    opponent.board.teacher = teacherTarget;
    const first = api.makeBoardCard(api.createCardFromBase("signal_professor_m", "player"));
    api.attendCard("player", first, "teacher", null, { attendanceSource: api.ATTENDANCE_SOURCE.HAND });
    const oneLoad = loaded.handLoadLevel;
    const oneLoadCost = api.effectiveCardCost(loaded);
    const afterTeacherDamage = { seat: seatTarget.currentHp, teacher: teacherTarget.currentHp };
    const seatOnly = api.makeBoardCard(api.createCardFromBase("signal_professor_m", "player"));
    api.attendCard("player", seatOnly, "seat", 0, { attendanceSource: api.ATTENDANCE_SOURCE.HAND });
    const afterSeatLoad = loaded.handLoadLevel;
    const afterSeatDamage = { seat: seatTarget.currentHp, teacher: teacherTarget.currentHp };
    player.board.teacher = null;
    const second = api.makeBoardCard(api.createCardFromBase("signal_professor_m", "player"));
    api.attendCard("player", second, "teacher", null, { attendanceSource: api.ATTENDANCE_SOURCE.HAND });
    const highLoad = loaded.handLoadLevel;
    const highLoadCost = api.effectiveCardCost(loaded);
    player.board.teacher = null;
    const third = api.makeBoardCard(api.createCardFromBase("signal_professor_m", "player"));
    api.attendCard("player", third, "teacher", null, { attendanceSource: api.ATTENDANCE_SOURCE.HAND });
    const cappedLoad = loaded.handLoadLevel;
    const text = api.cardRulesText(loaded);
    const professorText = api.cardRulesText(api.createCardFromBase("signal_professor_m", "player"));
    const professorCost = api.effectiveCardCost(api.createCardFromBase("signal_professor_m", "player"));
    api.state.currentSide = "opponent";
    opponent.life = 20;
    api.resolveEndTurnEffects("opponent");
    const life = opponent.life;
    const discardAllowed = api.moveHandCardToTrash("opponent", loaded, { effectDiscard: true });
    const stillInHand = opponent.hand.some((card) => card.instanceId === loaded.instanceId);
    const stillOutOfTrash = !opponent.trash.some((card) => card.instanceId === loaded.instanceId);
    opponent.will = 1;
    const insufficient = api.placeCardFromHand("opponent", loaded.instanceId, "seat", "opponent", 0, false);
    opponent.will = 3;
    const played = api.placeCardFromHand("opponent", loaded.instanceId, "seat", "opponent", 0, false);
    return { oneLoad, oneLoadCost, afterTeacherDamage, afterSeatLoad, afterSeatDamage,
      highLoad, highLoadCost, cappedLoad, text, professorText, professorCost, life, discardAllowed,
      stillInHand, stillOutOfTrash, insufficient, played, remainingWill: opponent.will,
      boardLoad: opponent.board.seats[0]?.handLoadLevel ?? null, playerLife: player.life };
  });

  expect(result.oneLoad).toBe(1);
  expect(result.oneLoadCost).toBe(2);
  expect(result.afterTeacherDamage).toEqual({ seat: 8, teacher: 8 });
  expect(result.afterSeatLoad).toBe(1);
  expect(result.afterSeatDamage).toEqual({ seat: 8, teacher: 8 });
  expect(result.highLoad).toBe(2);
  expect(result.highLoadCost).toBe(3);
  expect(result.cappedLoad).toBe(2);
  expect(result.text).toContain("[高負荷]");
  expect(result.professorText).toBe("このカードを手札から教卓マスに出席させたとき、相手の講義室にいる出席者すべてに2ダメージを与える。その後、相手の手札すべてに[負荷]を付与する。");
  expect(result.professorCost).toBe(10);
  expect(result.life).toBe(18);
  expect(result.discardAllowed).toBe(false);
  expect(result.stillInHand).toBe(true);
  expect(result.stillOutOfTrash).toBe(true);
  expect(result.insufficient).toBe(false);
  expect(result.played).toBe(true);
  expect(result.remainingWill).toBe(0);
  expect(result.boardLoad).toBe(0);
});

test("高負荷は手札からの効果破棄を防ぐが、山札から校外エリアへは送れる", async ({ page }) => {
  const result = await page.evaluate(() => {
    const api = window.__chibattle;
    const card = api.createCardFromBase("general_student", "player");
    card.handLoadLevel = 2;
    api.state.players.player.hand = [card];
    const blocked = api.moveToTrash("player", card);
    api.state.players.player.hand = [];
    api.state.players.player.deck = [card];
    api.state.players.player.deck.shift();
    const moved = Boolean(api.moveToTrash("player", card, { sourceZone: "deck" }));
    return { blocked, moved, inTrash: api.state.players.player.trash.some((entry) => entry.instanceId === card.instanceId) };
  });

  expect(result).toEqual({ blocked: false, moved: true, inTrash: true });
});

test("手札の負荷は紫、高負荷は赤の透過色で表示し、手札を離れると解除する", async ({ page }) => {
  const cardIds = await page.evaluate(() => {
    const api = window.__chibattle;
    const loaded = api.createCardFromBase("general_student", "player");
    const highLoaded = api.createCardFromBase("general_teacher", "player");
    loaded.handLoadLevel = 1;
    highLoaded.handLoadLevel = 2;
    api.state.players.player.hand = [loaded, highLoaded];
    api.render();
    return { loaded: loaded.instanceId, highLoaded: highLoaded.instanceId };
  });

  const loaded = page.locator(`.player-hand .hand-card[data-card-id="${cardIds.loaded}"]`);
  const highLoaded = page.locator(`.player-hand .hand-card[data-card-id="${cardIds.highLoaded}"]`);
  await expect(loaded).toHaveClass(/\bhand-load\b/);
  await expect(highLoaded).toHaveClass(/\bhand-high-load\b/);
  await expect(loaded.locator(".stat-cost").first()).toHaveText("2");
  await expect(highLoaded.locator(".stat-cost").first()).toHaveText("4");

  const overlayColors = await page.evaluate(({ loadedId, highLoadedId }) => {
    const color = (id) => getComputedStyle(document.querySelector(`[data-card-id="${id}"] .card-face`), "::after").backgroundColor;
    return { loaded: color(loadedId), highLoaded: color(highLoadedId) };
  }, { loadedId: cardIds.loaded, highLoadedId: cardIds.highLoaded });
  expect(overlayColors.loaded).toBe("rgba(119, 62, 181, 0.24)");
  expect(overlayColors.highLoaded).toBe("rgba(211, 47, 61, 0.24)");

  await page.evaluate((instanceId) => {
    const api = window.__chibattle;
    const card = api.state.players.player.hand.find((entry) => entry.instanceId === instanceId);
    api.state.players.player.hand = api.state.players.player.hand.filter((entry) => entry.instanceId !== instanceId);
    api.state.players.player.board.seats[0] = api.makeBoardCard(card);
    api.render();
  }, cardIds.loaded);
  await expect(page.locator(`.board-card[data-card-id="${cardIds.loaded}"]`)).not.toHaveClass(/hand-load|hand-high-load/);
});

test("ver.0.23.8のお知らせにカード変更、新カード、負荷のルールを表示する", async ({ page }) => {
  await page.goto(gameUrl);
  await page.locator("#homeUpdatesButton").click();
  const entry = page.locator(".update-entry").filter({ has: page.locator("summary", { hasText: "ver.0.23.8" }) });
  await expect(entry).toHaveCount(1);
  await expect(entry.locator(".update-change")).toHaveCount(16);
  for (const name of ["ベストフレンド", "敵", "アクティングアウトマン", "バカでかい声の学生", "パチンウニー", "スタディアブローダー"]) {
    await expect(entry.locator(".update-before strong").filter({ hasText: new RegExp(`^${name}$`) })).toHaveCount(1);
  }
  await expect(entry.locator(".update-change").filter({ has: page.locator(".update-before strong", { hasText: /^敵$/ }) }).locator(".update-after"))
    .toContainText("戦意2／攻撃力1／体力2");
  await expect(entry.locator(".update-after", { hasText: "スタディアブローダー" })).toContainText("戦意10／攻撃力2／体力4");
  await expect(entry.locator(".update-after", { hasText: "[高負荷]" })).toContainText("手札から校外エリアへ送れず");
  await expect(entry.locator(".update-after", { hasText: "ストレスヘアー" })).toContainText("装備カードは通常、1人につき1枚まで");
  await expect(entry.locator(".update-after", { hasText: "帽子男" })).toContainText("学生／共通カード／戦意5／攻撃力3／体力3");
  await expect(entry.locator(".update-after", { hasText: "三敵" })).toContainText("学生／展開・敵増殖／戦意3／攻撃力1／体力2");
});
