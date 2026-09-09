const { test, expect } = require("@playwright/test");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const gameUrl = pathToFileURL(path.join(__dirname, "..", "index.html")).href;

async function setup(page, options = {}) {
  await page.goto(gameUrl);
  await page.evaluate((options) => {
    const api = window.__chibattle;
    const { state } = api;
    state.preBattleToken += 1000;
    state.screen = "battle";
    state.testMode = false;
    state.phase = "battle";
    state.currentSide = "opponent";
    state.actionTurn = options.actionTurn ?? 16;
    state.firstSide = options.firstSide || "player";
    state.environment = null;
    state.noAttackUntilActionTurn = 0;
    state.gameOver = false;
    for (const side of ["player", "opponent"]) {
      Object.assign(state.players[side], {
        life: 20,
        will: 10,
        maxWill: 10,
        hand: [],
        deck: Array.from({ length: 20 }, () => api.createCardFromBase("general_student", side)),
        trash: [],
        late: [],
        turnsTaken: side === "opponent" ? (options.turn ?? 8) : 8
      });
      state.players[side].board = { teacher: null, seats: Array(9).fill(null) };
    }
    Object.assign(state.players.opponent.originalDeckCounts, {
      yocchan: 3,
      trpg_member: 3,
      king_ghidorah_bed: 3,
      alpha: 3,
      onigiri_draw: 3,
      fire_touch: 3,
      sage_legacy: 3
    });
  }, options);
}

test("専用デッキを判別し、マリガンで中核とサーチを優先する", async ({ page }) => {
  await setup(page);
  const result = await page.evaluate(() => {
    const api = window.__chibattle;
    const ids = ["trpg_member", "trpg_member", "sage_legacy", "general_teacher", "king_ghidorah_bed"];
    const hand = ids.map((id) => api.createCardFromBase(id, "opponent"));
    const returned = new Set(api.chooseAiMulliganReturnIds(hand));
    return {
      active: api.isAiYocchanHyperCarryStrategyActive(),
      kept: hand.filter((card) => !returned.has(card.instanceId)).map((card) => card.baseId),
      returned: hand.filter((card) => returned.has(card.instanceId)).map((card) => card.baseId)
    };
  });
  expect(result.active).toBe(true);
  expect(result.kept).toEqual(["trpg_member", "sage_legacy"]);
  expect(result.returned).toEqual(["trpg_member", "general_teacher", "king_ghidorah_bed"]);
});

test("デッキ名や固定構成ではなく、よっちゃんを採用していれば手札育成と攻め時を判断する", async ({ page }) => {
  await setup(page, { turn: 6, actionTurn: 11 });
  const result = await page.evaluate(() => {
    const api = window.__chibattle;
    const ai = api.state.players.opponent;
    ai.originalDeckCounts = { yocchan: 1, general_student: 39 };
    ai.turnsTaken = 6;
    ai.will = ai.maxWill = 4;
    const yocchan = api.createCardFromBase("yocchan", "opponent");
    yocchan.attack = 8;
    yocchan.hp = yocchan.maxHp = yocchan.currentHp = 9;
    const general = api.createCardFromBase("general_student", "opponent");
    ai.hand = [yocchan, general];
    const returned = new Set(api.chooseAiMulliganReturnIds(ai.hand));
    const plan = api.getAiYocchanHyperCarryPlan();
    return {
      active: api.isAiYocchanHyperCarryStrategyActive(),
      keepsYocchan: !returned.has(yocchan.instanceId),
      attackWindow: plan.shouldDeploy,
      move: api.findAiPlayMove()?.card.baseId || null
    };
  });
  expect(result).toEqual({
    active: true,
    keepsYocchan: true,
    attackWindow: true,
    move: "yocchan"
  });
});

test("食堂と見習いヴァンパイアを採用した任意のデッキで4戦意コンボを優先する", async ({ page }) => {
  await setup(page, { turn: 4, actionTurn: 7 });
  const result = await page.evaluate(() => {
    const api = window.__chibattle;
    const ai = api.state.players.opponent;
    ai.originalDeckCounts = { cafeteria: 1, apprentice_vampire: 1, general_student: 38 };
    ai.turnsTaken = 4;
    ai.will = ai.maxWill = 4;
    const cafeteria = api.createCardFromBase("cafeteria", "opponent");
    const apprentice = api.createCardFromBase("apprentice_vampire", "opponent");
    ai.hand = [cafeteria, apprentice];
    const returned = new Set(api.chooseAiMulliganReturnIds(ai.hand));
    const firstMove = api.findAiPlayMove();
    api.placeCardFromHand("opponent", firstMove.card.instanceId, firstMove.zone, firstMove.owner, firstMove.index, false);
    const secondMove = api.findAiPlayMove();
    return {
      active: api.isAiCafeteriaVampireStrategyActive(),
      keptBoth: !returned.has(cafeteria.instanceId) && !returned.has(apprentice.instanceId),
      firstMove: firstMove?.card.baseId || null,
      secondMove: secondMove?.card.baseId || null,
      environment: api.state.environment?.baseId || null
    };
  });
  expect(result).toEqual({
    active: true,
    keptBoth: true,
    firstMove: "cafeteria",
    secondMove: "apprentice_vampire",
    environment: "cafeteria"
  });
});

test("食堂は同じターンに展開し切れなくても見習いヴァンパイアがあれば先に置く", async ({ page }) => {
  await setup(page, { turn: 3, actionTurn: 5 });
  const result = await page.evaluate(() => {
    const api = window.__chibattle;
    const ai = api.state.players.opponent;
    ai.originalDeckCounts = { cafeteria: 1, apprentice_vampire: 1, general_student: 38 };
    ai.turnsTaken = 3;
    ai.will = ai.maxWill = 3;
    ai.hand = [
      api.createCardFromBase("cafeteria", "opponent"),
      api.createCardFromBase("apprentice_vampire", "opponent")
    ];
    return {
      attackWindow: api.getAiCafeteriaVampirePlan().attackWindow,
      move: api.findAiPlayMove()?.card.baseId || null
    };
  });
  expect(result).toEqual({ attackWindow: false, move: "cafeteria" });
});

test("ナイトプールは単細胞生物を使う構成と空席があれば積極的に置く", async ({ page }) => {
  await setup(page, { turn: 3, actionTurn: 5 });
  const result = await page.evaluate(() => {
    const api = window.__chibattle;
    const right = api.state.players.opponent;
    right.originalDeckCounts = { single_cell: 3, night_pool: 1, general_student: 36 };
    right.will = right.maxWill = 3;
    right.hand = [
      api.createCardFromBase("night_pool", "opponent"),
      api.createCardFromBase("general_student", "opponent")
    ];
    const rightMove = api.findAiPlayMove()?.card.baseId || null;

    const left = api.state.players.player;
    left.originalDeckCounts = { single_cell: 3, night_pool: 1, general_student: 36 };
    left.will = left.maxWill = 3;
    const nightPool = api.createCardFromBase("night_pool", "player");
    left.hand = [nightPool, api.createCardFromBase("general_student", "player")];
    const leftMove = api.findTrainingAiPlayMove("player")?.card.baseId || null;
    return { rightMove, leftMove };
  });
  expect(result).toEqual({ rightMove: "night_pool", leftMove: "night_pool" });
});

test("グリーンカレーは弱い盤面では温存し、強い盤面への切り返しに使う", async ({ page }) => {
  await setup(page, { turn: 7, actionTurn: 13 });
  const result = await page.evaluate(() => {
    const api = window.__chibattle;
    const state = api.state;
    const curry = api.createCardFromBase("green_curry", "opponent");
    const placeEnemy = (count) => {
      state.players.player.board.seats = Array(9).fill(null);
      for (let index = 0; index < count; index += 1) {
        const card = api.makeBoardCard(api.createCardFromBase("general_student", "player"));
        card.attack = 3;
        card.currentHp = card.maxHp = 3;
        state.players.player.board.seats[index] = card;
      }
    };
    placeEnemy(2);
    const weak = api.scoreAiItem(curry);
    placeEnemy(4);
    const strong = api.scoreAiItem(curry);
    return {
      weak,
      strong,
      shouldUseStrong: api.aiGreenCurryBoardAssessment().shouldUse
    };
  });
  expect(result.weak).toBe(0);
  expect(result.strong).toBeGreaterThan(0);
  expect(result.shouldUseStrong).toBe(true);
});

test("左側CPUも特定デッキに限らずキングギドラベッドを盤面処理として評価する", async ({ page }) => {
  await setup(page, { turn: 8, actionTurn: 15 });
  const score = await page.evaluate(() => {
    const api = window.__chibattle;
    const left = api.state.players.player;
    left.originalDeckCounts = { king_ghidorah_bed: 1, general_student: 39 };
    left.turnsTaken = 8;
    left.will = left.maxWill = 4;
    const king = api.createCardFromBase("king_ghidorah_bed", "player");
    left.hand = [king, api.createCardFromBase("general_student", "player")];
    for (let index = 0; index < 4; index += 1) {
      const enemy = api.makeBoardCard(api.createCardFromBase("general_student", "opponent"));
      enemy.currentHp = enemy.maxHp = 2;
      api.state.players.opponent.board.seats[index] = enemy;
    }
    return api.scoreTrainingYocchanItem("player", king);
  });
  expect(score).toBeGreaterThan(0);
});

test("3ターン目はTRPGサークルメンバーを優先し、よっちゃんは温存する", async ({ page }) => {
  await setup(page, { turn: 3, actionTurn: 5 });
  const result = await page.evaluate(() => {
    const api = window.__chibattle;
    const ai = api.state.players.opponent;
    ai.will = ai.maxWill = 4;
    const trpg = api.createCardFromBase("trpg_member", "opponent");
    const earlyBody = api.createCardFromBase("general_student", "opponent");
    ai.hand = [trpg, earlyBody];
    const trpgScore = api.scoreAiPlacement(trpg, "seat", 4);
    const move = api.findAiPlayMove();
    const yocchan = api.createCardFromBase("yocchan", "opponent");
    yocchan.attack = 7;
    yocchan.hp = yocchan.maxHp = yocchan.currentHp = 8;
    ai.hand = [yocchan];
    const yocchanScore = api.scoreAiPlacement(yocchan, "seat", 4);
    return { trpgScore, yocchanScore, move: move?.card.baseId || null };
  });
  expect(result.trpgScore).toBeGreaterThan(100);
  expect(result.yocchanScore).toBeLessThan(0);
  expect(result.move).toBe("trpg_member");
});

test("8ターン目に2人のよっちゃんで勝てるなら、持ち物より出席を優先する", async ({ page }) => {
  await setup(page, { turn: 8 });
  const result = await page.evaluate(() => {
    const api = window.__chibattle;
    const ai = api.state.players.opponent;
    ai.will = ai.maxWill = 8;
    const first = api.createCardFromBase("yocchan", "opponent");
    const second = api.createCardFromBase("yocchan", "opponent");
    for (const card of [first, second]) {
      card.attack = 10;
      card.hp = card.maxHp = card.currentHp = 11;
    }
    const item = api.createCardFromBase("ikemasu", "opponent");
    ai.hand = [first, second, item];
    const plan = api.getAiYocchanHyperCarryPlan();
    const itemScore = api.scoreAiItem(item, { timing: "beforeBoard" });
    const useItem = api.shouldAiUseItemAtTiming(item, itemScore, "beforeBoard");
    const move = api.findAiPlayMove();
    return {
      lethal: plan.lethal,
      shouldDeploy: plan.shouldDeploy,
      requiredWill: plan.requiredWill,
      useItem,
      move: move?.card.baseId || null
    };
  });
  expect(result).toMatchObject({
    lethal: true,
    shouldDeploy: true,
    requiredWill: 8,
    useItem: false,
    move: "yocchan"
  });
});

test("実際のAI行動で2人のよっちゃんを出席させ、そのターン中に勝利する", async ({ page }) => {
  test.setTimeout(30000);
  await setup(page, { turn: 8 });
  const result = await page.evaluate(async () => {
    const api = window.__chibattle;
    const ai = api.state.players.opponent;
    ai.will = ai.maxWill = 8;
    const first = api.createCardFromBase("yocchan", "opponent");
    const second = api.createCardFromBase("yocchan", "opponent");
    for (const card of [first, second]) {
      card.attack = 10;
      card.hp = card.maxHp = card.currentHp = 11;
    }
    ai.hand = [first, second, api.createCardFromBase("ikemasu", "opponent")];
    await api.runOpponentAI();
    return {
      life: api.state.players.player.life,
      gameOver: api.state.gameOver,
      winner: api.state.gameWinner,
      attendedYocchans: ai.board.seats.filter((card) => card?.baseId === "yocchan").length,
      itemStillInHand: ai.hand.some((card) => card.baseId === "ikemasu")
    };
  });
  expect(result).toEqual({
    life: 0,
    gameOver: true,
    winner: "opponent",
    attendedYocchans: 2,
    itemStillInHand: true
  });
});

test("AI同士対戦の左側CPUでも専用デッキ判定とマリガン方針を使う", async ({ page }) => {
  await setup(page, { turn: 3, actionTurn: 5 });
  const result = await page.evaluate(() => {
    const api = window.__chibattle;
    const player = api.state.players.player;
    player.originalDeckCounts = { ...api.state.players.opponent.originalDeckCounts };
    const ids = ["trpg_member", "trpg_member", "sage_legacy", "general_teacher", "king_ghidorah_bed"];
    const hand = ids.map((id) => api.createCardFromBase(id, "player"));
    const returned = new Set(api.chooseAiMulliganReturnIds(hand, "player"));
    return {
      active: api.isAiYocchanHyperCarryStrategyActive("player"),
      kept: hand.filter((card) => !returned.has(card.instanceId)).map((card) => card.baseId),
      returned: hand.filter((card) => returned.has(card.instanceId)).map((card) => card.baseId)
    };
  });
  expect(result.active).toBe(true);
  expect(result.kept).toEqual(["trpg_member", "sage_legacy"]);
  expect(result.returned).toEqual(["trpg_member", "general_teacher", "king_ghidorah_bed"]);
});

test("AI同士対戦の左側CPUも3ターン目はTRPGサークルメンバーを優先する", async ({ page }) => {
  await setup(page, { turn: 3, actionTurn: 5 });
  const result = await page.evaluate(() => {
    const api = window.__chibattle;
    const state = api.state;
    const left = state.players.player;
    left.originalDeckCounts = { ...state.players.opponent.originalDeckCounts };
    left.turnsTaken = 3;
    left.will = left.maxWill = 4;
    left.hand = [
      api.createCardFromBase("general_student", "player"),
      api.createCardFromBase("trpg_member", "player")
    ];
    return api.findTrainingAiPlayMove("player")?.card.baseId || null;
  });
  expect(result).toBe("trpg_member");
});

test("後攻の左側CPUも賢者の遺産でTRPGサークルメンバーを探す", async ({ page }) => {
  test.setTimeout(30000);
  await setup(page, { firstSide: "opponent", turn: 1, actionTurn: 2 });
  const result = await page.evaluate(async () => {
    const api = window.__chibattle;
    const state = api.state;
    const left = state.players.player;
    left.originalDeckCounts = { ...state.players.opponent.originalDeckCounts };
    state.training = {
      ...state.training,
      active: true,
      leftController: "ai",
      speed: 4,
      paused: false,
      skipAnimations: true
    };
    state.currentSide = "player";
    left.turnsTaken = 1;
    left.will = left.maxWill = 1;
    left.hand = [api.createCardFromBase("sage_legacy", "player")];
    left.deck = [
      api.createCardFromBase("general_student", "player"),
      api.createCardFromBase("trpg_member", "player"),
      api.createCardFromBase("general_teacher", "player")
    ];
    await api.runTrainingLeftAI();
    return {
      hand: left.hand.map((card) => card.baseId),
      trash: left.trash.map((card) => card.baseId),
      deck: left.deck.map((card) => card.baseId)
    };
  });
  expect(result.hand).toContain("trpg_member");
  expect(result.trash).toContain("sage_legacy");
  expect(result.deck).not.toContain("trpg_member");
});

test("AI同士対戦の左側CPUも持ち物を使って手札のよっちゃんを強化する", async ({ page }) => {
  test.setTimeout(30000);
  await setup(page, { turn: 4, actionTurn: 7 });
  const result = await page.evaluate(async () => {
    const api = window.__chibattle;
    const state = api.state;
    const left = state.players.player;
    left.originalDeckCounts = { ...state.players.opponent.originalDeckCounts };
    state.training = {
      ...state.training,
      active: true,
      leftController: "ai",
      speed: 4,
      paused: false,
      skipAnimations: true
    };
    state.currentSide = "player";
    left.turnsTaken = 4;
    left.will = left.maxWill = 4;
    const yocchan = api.createCardFromBase("yocchan", "player");
    left.hand = [yocchan, api.createCardFromBase("ikemasu", "player")];
    await api.runTrainingLeftAI();
    return {
      yocchanAttack: yocchan.attack,
      yocchanHp: yocchan.maxHp,
      usedItem: left.trash.some((card) => card.baseId === "ikemasu"),
      keptYocchan: left.hand.some((card) => card.instanceId === yocchan.instanceId)
    };
  });
  expect(result).toEqual({
    yocchanAttack: 1,
    yocchanHp: 2,
    usedItem: true,
    keptYocchan: true
  });
});

test("AI同士対戦の左側CPUも8ターン目のよっちゃん2人リーサルを優先する", async ({ page }) => {
  test.setTimeout(30000);
  await setup(page, { turn: 8 });
  const result = await page.evaluate(async () => {
    const api = window.__chibattle;
    const state = api.state;
    const left = state.players.player;
    left.originalDeckCounts = { ...state.players.opponent.originalDeckCounts };
    state.training = {
      ...state.training,
      active: true,
      leftController: "ai",
      speed: 4,
      paused: false,
      skipAnimations: true
    };
    state.currentSide = "player";
    left.turnsTaken = 8;
    left.will = left.maxWill = 8;
    const first = api.createCardFromBase("yocchan", "player");
    const second = api.createCardFromBase("yocchan", "player");
    for (const card of [first, second]) {
      card.attack = 10;
      card.hp = card.maxHp = card.currentHp = 11;
    }
    left.hand = [first, second, api.createCardFromBase("ikemasu", "player")];
    const planBefore = api.getAiYocchanHyperCarryPlan("player");
    const moveBefore = api.findTrainingAiPlayMove("player");
    await api.runTrainingLeftAI();
    return {
      strategyActive: api.isAiYocchanHyperCarryStrategyActive("player"),
      shouldDeploy: planBefore.shouldDeploy,
      firstMove: moveBefore?.card.baseId || null,
      life: state.players.opponent.life,
      gameOver: state.gameOver,
      winner: state.gameWinner,
      attendedYocchans: left.board.seats.filter((card) => card?.baseId === "yocchan").length,
      itemStillInHand: left.hand.some((card) => card.baseId === "ikemasu")
    };
  });
  expect(result).toEqual({
    strategyActive: true,
    shouldDeploy: true,
    firstMove: "yocchan",
    life: 0,
    gameOver: true,
    winner: "player",
    attendedYocchans: 2,
    itemStillInHand: true
  });
});

test("役目を終えたTRPGサークルメンバーをキングギドラベッドで優先して校外へ送る", async ({ page }) => {
  await setup(page, { turn: 8 });
  const result = await page.evaluate(() => {
    const api = window.__chibattle;
    const ai = api.state.players.opponent;
    ai.will = ai.maxWill = 4;
    const usedTrpg = api.makeBoardCard(api.createCardFromBase("trpg_member", "opponent"));
    usedTrpg.playedOnTurn = 0;
    ai.board.seats[0] = usedTrpg;
    const king = api.createCardFromBase("king_ghidorah_bed", "opponent");
    const spareTrpg = api.createCardFromBase("trpg_member", "opponent");
    const key = api.createCardFromBase("key", "opponent");
    ai.hand = [king, spareTrpg, key];
    const threat = api.makeBoardCard(api.createCardFromBase("protein_drinker", "player"));
    threat.attack = 6;
    threat.currentHp = threat.maxHp = 7;
    api.state.players.player.board.seats[4] = threat;
    const plan = api.planAiKingGhidorahBed(king);
    return { mode: plan.effectMode, discard: plan.discard?.baseId || null };
  });
  expect(result).toEqual({ mode: "2", discard: "trpg_member" });
});

test("AI戦術の内容を更新情報には掲載しない", async ({ page }) => {
  await page.goto(gameUrl);
  const text = await page.locator("body").textContent();
  expect(text).not.toContain("AIのデッキ戦術");
  expect(text).not.toContain("よっちゃんハイパーキャリー");
});
