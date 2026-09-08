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
    state.phase = "battle";
    state.currentSide = "opponent";
    state.actionTurn = 15;
    state.firstSide = "player";
    state.environment = null;
    state.gameOver = false;
    for (const side of ["player", "opponent"]) {
      Object.assign(state.players[side], {
        life: 20,
        will: 10,
        maxWill: 10,
        hand: [],
        deck: Array.from({ length: 24 }, () => api.createCardFromBase("general_student", side)),
        trash: [],
        late: [],
        turnsTaken: 8,
        originalDeckCounts: { general_student: 34 }
      });
      state.players[side].board = { teacher: null, seats: Array(9).fill(null) };
    }
  });
}

test("デッキ名ではなくDos攻撃とデストロイDos攻撃の採用でLO戦術を認識する", async ({ page }) => {
  await setup(page);
  const result = await page.evaluate(() => {
    const api = window.__chibattle;
    api.state.players.opponent.originalDeckCounts = {
      dos_attack: 1,
      destroy_dos_attack: 1,
      general_student: 38
    };
    api.state.players.player.originalDeckCounts = {
      dos_attack: 2,
      destroy_dos_attack: 2,
      general_student: 36
    };
    return {
      right: api.isAiDeckOutStrategyActive("opponent"),
      left: api.isAiDeckOutStrategyActive("player")
    };
  });
  expect(result).toEqual({ right: true, left: true });
});

test("Dos攻撃を校外へ置くまではデストロイDos攻撃よりDos攻撃を優先する", async ({ page }) => {
  await setup(page);
  const result = await page.evaluate(() => {
    const api = window.__chibattle;
    const ai = api.state.players.opponent;
    ai.originalDeckCounts = { dos_attack: 3, destroy_dos_attack: 3, general_student: 34 };
    const dos = api.createCardFromBase("dos_attack", "opponent");
    const destroy = api.createCardFromBase("destroy_dos_attack", "opponent");
    const before = {
      dos: api.aiDeckOutItemScore("opponent", dos),
      destroy: api.aiDeckOutItemScore("opponent", destroy)
    };
    ai.trash.push(api.createCardFromBase("dos_attack", "opponent"));
    const after = {
      dos: api.aiDeckOutItemScore("opponent", dos),
      destroy: api.aiDeckOutItemScore("opponent", destroy)
    };
    return { before, after };
  });
  expect(result.before.dos).toBeGreaterThan(0);
  expect(result.before.destroy).toBe(0);
  expect(result.after.destroy).toBeGreaterThan(result.after.dos);
});

test("左右どちらのCPUもLO用の持ち物を評価する", async ({ page }) => {
  await setup(page);
  const result = await page.evaluate(() => {
    const api = window.__chibattle;
    for (const side of ["player", "opponent"]) {
      api.state.players[side].originalDeckCounts = {
        dos_attack: 3,
        destroy_dos_attack: 3,
        general_student: 34
      };
    }
    const leftDos = api.createCardFromBase("dos_attack", "player");
    const rightDos = api.createCardFromBase("dos_attack", "opponent");
    return {
      left: api.scoreTrainingYocchanItem("player", leftDos),
      right: api.scoreAiItem(rightDos)
    };
  });
  expect(result.left).toBeGreaterThan(0);
  expect(result.right).toBeGreaterThan(0);
});

test("相手の環境カードが校外と現在の環境にすべて見えるまで目黒区図書館を温存する", async ({ page }) => {
  await setup(page);
  const result = await page.evaluate(() => {
    const api = window.__chibattle;
    const enemy = api.state.players.player;
    const ai = api.state.players.opponent;
    enemy.originalDeckCounts = { cafeteria: 2, general_student: 38 };
    enemy.trash = [api.createCardFromBase("cafeteria", "player")];
    ai.hand = [
      api.createCardFromBase("meguro_library", "opponent"),
      api.createCardFromBase("general_student", "opponent")
    ];
    const before = {
      progress: api.aiOpponentEnvironmentProgress("opponent"),
      move: api.findAiPlayMove()?.card.baseId || null
    };
    api.state.environment = api.makeBoardCard(api.createCardFromBase("cafeteria", "player"));
    api.state.environment.owner = "player";
    const after = {
      progress: api.aiOpponentEnvironmentProgress("opponent"),
      move: api.findAiPlayMove()?.card.baseId || null
    };
    return { before, after };
  });
  expect(result.before.progress.exhausted).toBe(false);
  expect(result.before.move).toBe("general_student");
  expect(result.after.progress.exhausted).toBe(true);
  expect(result.after.move).toBe("meguro_library");
});

test("左側CPUも相手の環境消費を見て目黒区図書館を判断し、相手の環境を張り替える", async ({ page }) => {
  await setup(page);
  const result = await page.evaluate(() => {
    const api = window.__chibattle;
    const enemy = api.state.players.opponent;
    enemy.originalDeckCounts = { classroom: 1, general_student: 39 };
    const meguro = api.createCardFromBase("meguro_library", "player");
    const classroom = api.createCardFromBase("classroom", "player");
    const held = api.trainingYocchanPlayPriority("player", meguro);
    api.state.environment = api.makeBoardCard(api.createCardFromBase("classroom", "opponent"));
    api.state.environment.owner = "opponent";
    const ready = api.trainingYocchanPlayPriority("player", meguro);
    const replacement = api.trainingYocchanPlayPriority("player", classroom);
    return { held, ready, replacement };
  });
  expect(result.held).toBe(-900);
  expect(result.ready).toBeGreaterThan(0);
  expect(result.replacement).toBeGreaterThan(0);
});
