const { test, expect } = require("@playwright/test");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const gameUrl = pathToFileURL(path.join(__dirname, "..", "index.html")).href;

async function setup(page) {
  await page.goto(gameUrl);
  await page.evaluate(() => {
    const api = window.__chibattle;
    const { state } = api;
    state.preBattleToken += 1000;
    state.screen = "battle";
    state.testMode = false;
    state.phase = "battle";
    state.currentSide = "opponent";
    state.actionTurn = 12;
    state.firstSide = "player";
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
        originalDeckCounts: {},
        crabCountdown: null,
        turnsTaken: 6
      });
      state.players[side].board = { teacher: null, seats: Array(9).fill(null) };
    }
  });
}

test("カニ勝利構成をデッキ名ではなく採用枚数から判断する", async ({ page }) => {
  await setup(page);
  const result = await page.evaluate(() => {
    const api = window.__chibattle;
    const ai = api.state.players.opponent;
    ai.originalDeckCounts = {
      circle_crab: 2,
      hair_crab: 1,
      homeless_crab: 1,
      general_student: 36
    };
    const hand = ["circle_crab", "circle_crab", "hair_crab", "general_student", "fluid_pasta"]
      .map((baseId) => api.createCardFromBase(baseId, "opponent"));
    ai.hand = hand;
    const returned = new Set(api.chooseAiMulliganReturnIds(hand, "opponent"));
    return {
      active: api.isAiCrabVictoryStrategyActive("opponent"),
      missing: api.getAiCrabVictoryPlan("opponent").missingCounts,
      kept: hand.filter((card) => !returned.has(card.instanceId)).map((card) => card.baseId),
      returned: hand.filter((card) => returned.has(card.instanceId)).map((card) => card.baseId)
    };
  });
  expect(result.active).toBe(true);
  expect(result.missing).toEqual({ circle_crab: 0, hair_crab: 0, homeless_crab: 1 });
  expect(result.kept).toEqual(["circle_crab", "circle_crab", "hair_crab"]);
  expect(result.returned).toEqual(["general_student", "fluid_pasta"]);
});

test("左右のCPUがカニを回復に使わず、処理・回復・回収を優先する", async ({ page }) => {
  await setup(page);
  const result = await page.evaluate(() => {
    const api = window.__chibattle;
    for (const side of ["player", "opponent"]) {
      api.state.players[side].originalDeckCounts = {
        circle_crab: 2,
        hair_crab: 1,
        homeless_crab: 1,
        general_student: 36
      };
      api.state.players[side].life = 10;
    }
    api.state.players.player.board.seats[4] = api.createCardFromBase("general_student", "player");
    api.state.players.opponent.board.seats[4] = api.createCardFromBase("general_student", "opponent");
    const rightCrab = api.createCardFromBase("circle_crab", "opponent");
    const rightHeal = api.createCardFromBase("fluid_pasta", "opponent");
    const rightRemoval = api.createCardFromBase("yabe", "opponent");
    api.state.players.opponent.trash = [api.createCardFromBase("homeless_crab", "opponent")];
    const rightRecovery = api.createCardFromBase("water_2l", "opponent");
    const leftCrab = api.createCardFromBase("hair_crab", "player");
    const leftRemoval = api.createCardFromBase("yabe", "player");
    const leftRecovery = api.createCardFromBase("water_2l", "player");
    api.state.players.player.trash = [api.createCardFromBase("circle_crab", "player")];
    return {
      rightCrab: api.scoreAiItem(rightCrab),
      rightHeal: api.scoreAiItem(rightHeal),
      rightRemoval: api.scoreAiItem(rightRemoval),
      rightRecovery: api.scoreAiItem(rightRecovery),
      leftCrabFinite: Number.isFinite(api.scoreTrainingYocchanItem("player", leftCrab)),
      leftRemoval: api.scoreTrainingYocchanItem("player", leftRemoval),
      leftRecovery: api.scoreTrainingYocchanItem("player", leftRecovery)
    };
  });
  expect(result.rightCrab).toBe(0);
  expect(result.rightHeal).toBeGreaterThan(20);
  expect(result.rightRemoval).toBeGreaterThan(20);
  expect(result.rightRecovery).toBeGreaterThan(30);
  expect(result.leftCrabFinite).toBe(false);
  expect(result.leftRemoval).toBeGreaterThan(40);
  expect(result.leftRecovery).toBeGreaterThan(50);
});

test("カニ勝利に必要なカードをフルスロットルのコストにしない", async ({ page }) => {
  await setup(page);
  const result = await page.evaluate(() => {
    const api = window.__chibattle;
    const ai = api.state.players.opponent;
    ai.originalDeckCounts = { circle_crab: 2, hair_crab: 1, homeless_crab: 1, full_throttle: 1 };
    const fullThrottle = api.createCardFromBase("full_throttle", "opponent");
    ai.hand = [fullThrottle, ...["circle_crab", "circle_crab", "hair_crab", "homeless_crab"]
      .map((baseId) => api.createCardFromBase(baseId, "opponent"))];
    api.state.players.player.board.seats[4] = api.createCardFromBase("general_student", "player");
    const score = api.scoreAiItem(fullThrottle);
    const used = api.useAiItem(fullThrottle);
    return { score, used, heldCrabs: ai.hand.filter((card) => ["circle_crab", "hair_crab", "homeless_crab"].includes(card.baseId)).length };
  });
  expect(result).toEqual({ score: 0, used: false, heldCrabs: 4 });
});

test("キングギドラベッドの効果2でカニ以外を手札コストにする", async ({ page }) => {
  await setup(page);
  const result = await page.evaluate(() => {
    const api = window.__chibattle;
    const ai = api.state.players.opponent;
    ai.will = ai.maxWill = 4;
    ai.originalDeckCounts = { circle_crab: 2, hair_crab: 1, homeless_crab: 1, king_ghidorah_bed: 1 };
    const ghidorah = api.createCardFromBase("king_ghidorah_bed", "opponent");
    const spare = api.createCardFromBase("general_student", "opponent");
    ai.hand = [ghidorah, spare, ...["circle_crab", "circle_crab", "hair_crab", "homeless_crab"]
      .map((baseId) => api.createCardFromBase(baseId, "opponent"))];
    const threat = api.createCardFromBase("general_student", "player");
    threat.attack = 8;
    threat.hp = threat.maxHp = threat.currentHp = 8;
    api.state.players.player.board.seats[4] = threat;
    const plan = api.planAiKingGhidorahBed(ghidorah);
    return { mode: plan.effectMode, discard: plan.discard?.baseId || null };
  });
  expect(result).toEqual({ mode: "2", discard: "general_student" });
});
