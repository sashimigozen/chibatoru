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
