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
