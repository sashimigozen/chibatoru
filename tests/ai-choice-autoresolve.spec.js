const { test, expect } = require("@playwright/test");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const gameUrl = pathToFileURL(path.join(__dirname, "..", "index.html")).href;

async function setupAiVsAi(page) {
  await page.goto(gameUrl);
  await page.evaluate(() => {
    const api = window.__chibattle;
    const { state } = api;
    state.preBattleToken += 1000;
    state.screen = "battle";
    state.phase = "battle";
    state.currentSide = "player";
    state.actionTurn = 8;
    state.gameOver = false;
    state.testMode = false;
    state.pendingCardChoice = null;
    state.pendingThreeGestures = null;
    state.pendingAttendTarget = null;
    state.pendingHandDiscardItem = null;
    state.pendingCardPlay = null;
    state.resolvingOrderedAttendance = false;
    state.attackInProgress = false;
    state.attackQueue = [];
    state.training = {
      ...state.training,
      active: true,
      leftController: "ai",
      speed: 4,
      paused: false,
      skipAnimations: true
    };
    for (const side of ["player", "opponent"]) {
      Object.assign(state.players[side], {
        life: 20,
        will: 10,
        maxWill: 10,
        hand: [],
        deck: [],
        trash: [],
        late: [],
        originalDeckCounts: {},
        turnsTaken: 4
      });
      state.players[side].board = { teacher: null, seats: Array(9).fill(null) };
    }
    state.environment = null;
  });
}

test("AI同士対戦の左側CPUが目黒区図書館の手札を自動で選んでターンを終了する", async ({ page }) => {
  await setupAiVsAi(page);
  const result = await page.evaluate(() => {
    const api = window.__chibattle;
    const state = api.state;
    state.environment = { ...api.createCardFromBase("meguro_library", "player"), owner: "player" };
    const lowValue = api.createCardFromBase("general_student", "player");
    const highValue = api.createCardFromBase("general_teacher", "player");
    highValue.attack = 8;
    highValue.hp = highValue.maxHp = highValue.currentHp = 8;
    state.players.player.hand = [highValue, lowValue];
    api.endTurn({ fromAi: true });
    return {
      currentSide: state.currentSide,
      pendingChoice: state.pendingCardChoice,
      hand: state.players.player.hand.map((card) => card.instanceId),
      trash: state.players.player.trash.map((card) => card.instanceId),
      lowValueId: lowValue.instanceId,
      highValueId: highValue.instanceId
    };
  });
  expect(result.currentSide).toBe("opponent");
  expect(result.pendingChoice).toBeNull();
  expect(result.trash).toContain(result.lowValueId);
  expect(result.hand).toContain(result.highValueId);
});

test("右側CPUも目黒区図書館の手札選択で停止しない", async ({ page }) => {
  await setupAiVsAi(page);
  const result = await page.evaluate(() => {
    const api = window.__chibattle;
    const state = api.state;
    state.currentSide = "opponent";
    state.environment = { ...api.createCardFromBase("meguro_library", "opponent"), owner: "opponent" };
    const lowValue = api.createCardFromBase("general_student", "opponent");
    const highValue = api.createCardFromBase("general_teacher", "opponent");
    highValue.attack = 8;
    highValue.hp = highValue.maxHp = highValue.currentHp = 8;
    state.players.opponent.hand = [highValue, lowValue];
    api.endTurn({ fromAi: true });
    return {
      currentSide: state.currentSide,
      pendingChoice: state.pendingCardChoice,
      hand: state.players.opponent.hand.map((card) => card.instanceId),
      trash: state.players.opponent.trash.map((card) => card.instanceId),
      lowValueId: lowValue.instanceId,
      highValueId: highValue.instanceId
    };
  });
  expect(result.currentSide).toBe("player");
  expect(result.pendingChoice).toBeNull();
  expect(result.trash).toContain(result.lowValueId);
  expect(result.hand).toContain(result.highValueId);
});

test("AI同士対戦の左側CPUがロジックハンターの手札選択で停止しない", async ({ page }) => {
  await setupAiVsAi(page);
  const result = await page.evaluate(() => {
    const api = window.__chibattle;
    const state = api.state;
    const hunter = api.createCardFromBase("logic_hunter", "player");
    const lowValue = api.createCardFromBase("general_student", "opponent");
    const highValue = api.createCardFromBase("general_teacher", "opponent");
    highValue.attack = 8;
    highValue.hp = highValue.maxHp = highValue.currentHp = 8;
    state.players.player.hand = [hunter];
    state.players.opponent.hand = [lowValue, highValue];
    const placed = api.placeCardFromHand("player", hunter.instanceId, "teacher", "player", null, false);
    return {
      placed,
      pendingChoice: state.pendingCardChoice,
      opponentHand: state.players.opponent.hand.map((card) => card.instanceId),
      opponentTrash: state.players.opponent.trash.map((card) => card.instanceId),
      highValueId: highValue.instanceId
    };
  });
  expect(result.placed).toBe(true);
  expect(result.pendingChoice).toBeNull();
  expect(result.opponentTrash).toContain(result.highValueId);
  expect(result.opponentHand).not.toContain(result.highValueId);
});

test("AI同士対戦の左側CPUが出席時の手札コスト選択で停止しない", async ({ page }) => {
  await setupAiVsAi(page);
  const result = await page.evaluate(() => {
    const api = window.__chibattle;
    const state = api.state;
    const failure = api.createCardFromBase("failure_student", "player");
    const first = api.createCardFromBase("general_student", "player");
    const second = api.createCardFromBase("hondara", "player");
    state.players.player.hand = [failure, first, second];
    const placed = api.placeCardFromHand("player", failure.instanceId, "seat", "player", 4, false);
    return {
      placed,
      pendingChoice: state.pendingCardChoice,
      handCount: state.players.player.hand.length,
      trashCount: state.players.player.trash.length
    };
  });
  expect(result).toEqual({ placed: true, pendingChoice: null, handCount: 0, trashCount: 2 });
});

test("AI同士対戦の左側CPUがデッキから選ぶ3つジェスチャーで停止しない", async ({ page }) => {
  await setupAiVsAi(page);
  const result = await page.evaluate(() => {
    const api = window.__chibattle;
    const state = api.state;
    const item = api.createCardFromBase("three_gestures", "player");
    state.players.player.hand = [item];
    state.players.player.deck = [
      "general_student", "general_teacher", "protein_drinker",
      "hondara", "fluid_pasta", "yabe"
    ].map((baseId) => api.createCardFromBase(baseId, "player"));
    const used = api.castImmediateItem("player", item, false);
    return {
      used,
      pendingChoice: state.pendingCardChoice,
      pendingThreeGestures: state.pendingThreeGestures,
      handCount: state.players.player.hand.length,
      trashCount: state.players.player.trash.length
    };
  });
  expect(result).toEqual({
    used: true,
    pendingChoice: null,
    pendingThreeGestures: null,
    handCount: 3,
    trashCount: 4
  });
});

test("将来追加される手札・デッキ選択も左側CPUが自動確定できる", async ({ page }) => {
  await setupAiVsAi(page);
  const result = await page.evaluate(() => {
    const api = window.__chibattle;
    const state = api.state;
    const sage = api.createCardFromBase("sage_legacy", "player");
    const first = api.createCardFromBase("general_student", "player");
    const second = api.createCardFromBase("general_teacher", "player");
    state.players.player.hand = [sage];
    state.players.player.deck = [first, second];
    state.pendingCardChoice = {
      mode: "sage_legacy",
      itemId: sage.instanceId,
      title: "デッキから選択",
      message: "",
      cards: [second],
      selectedIds: [],
      min: 1,
      max: 1,
      selectableIds: null,
      context: null
    };
    const resolved = api.resolveTrainingAiPendingSelections("player");
    return {
      resolved,
      pendingChoice: state.pendingCardChoice,
      handIds: state.players.player.hand.map((card) => card.instanceId),
      trashIds: state.players.player.trash.map((card) => card.instanceId),
      sageId: sage.instanceId,
      deckCardIds: [first.instanceId, second.instanceId]
    };
  });
  expect(result.resolved).toBe(true);
  expect(result.pendingChoice).toBeNull();
  expect(result.handIds).toHaveLength(1);
  expect(result.deckCardIds).toContain(result.handIds[0]);
  expect(result.trashIds).toContain(result.sageId);
});
