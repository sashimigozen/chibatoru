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
    state.actionTurn = 9;
    state.firstSide = "player";
    state.environment = null;
    state.gameOver = false;
    for (const side of ["player", "opponent"]) {
      Object.assign(state.players[side], {
        life: 20,
        will: 10,
        maxWill: 10,
        hand: [],
        deck: [],
        trash: [],
        late: [],
        turnsTaken: 5,
        originalDeckCounts: { single_cell: 3, general_student: 37 }
      });
      state.players[side].board = { teacher: null, seats: Array(9).fill(null) };
    }
  });
}

test("左右のCPUが単細胞生物を完全変異体への合成素材として認識する", async ({ page }) => {
  await setup(page);
  const result = await page.evaluate(() => {
    const api = window.__chibattle;
    const left = api.createCardFromBase("single_cell", "player");
    const right = api.createCardFromBase("single_cell", "opponent");
    return {
      leftStrategy: api.isAiBiologyFusionStrategyActive("player"),
      rightStrategy: api.isAiBiologyFusionStrategyActive("opponent"),
      leftProtected: api.isAiProtectedBiologyMaterial("player", left),
      rightProtected: api.isAiProtectedBiologyMaterial("opponent", right)
    };
  });
  expect(result).toEqual({
    leftStrategy: true,
    rightStrategy: true,
    leftProtected: true,
    rightProtected: true
  });
});

test("左右のCPUは単細胞生物が反撃で失われる攻撃を避ける", async ({ page }) => {
  await setup(page);
  const result = await page.evaluate(() => {
    const api = window.__chibattle;
    const left = api.makeBoardCard(api.createCardFromBase("single_cell", "player"));
    const right = api.makeBoardCard(api.createCardFromBase("single_cell", "opponent"));
    const leftEnemy = api.makeBoardCard(api.createCardFromBase("general_student", "opponent"));
    const rightEnemy = api.makeBoardCard(api.createCardFromBase("general_student", "player"));
    api.state.players.player.board.seats[0] = left;
    api.state.players.opponent.board.seats[0] = right;
    api.state.players.opponent.board.seats[1] = leftEnemy;
    api.state.players.player.board.seats[1] = rightEnemy;
    return {
      leftTarget: api.findTrainingAiAttackTarget("player", left),
      rightTarget: api.findAiAttackTarget(right)
    };
  });
  expect(result.leftTarget).toBeNull();
  expect(result.rightTarget).toBeNull();
});

test("パンパンは合成素材を守り、自分の価値が低い出席者と相手の高体力出席者を選ぶ", async ({ page }) => {
  await setup(page);
  const result = await page.evaluate(() => {
    const api = window.__chibattle;
    for (const side of ["player", "opponent"]) {
      const targetSide = side === "player" ? "opponent" : "player";
      const single = api.makeBoardCard(api.createCardFromBase("single_cell", side));
      const expendable = api.makeBoardCard(api.createCardFromBase("general_student", side));
      expendable.attack = 0;
      expendable.currentHp = 1;
      expendable.maxHp = 1;
      api.state.players[side].board.seats[0] = single;
      api.state.players[side].board.seats[1] = expendable;

      const highHp = api.makeBoardCard(api.createCardFromBase("protein_drinker", targetSide));
      const highAttack = api.makeBoardCard(api.createCardFromBase("lazy_student", targetSide));
      highHp.currentHp = 9;
      highHp.maxHp = 9;
      highAttack.attack = 8;
      highAttack.currentHp = 2;
      highAttack.maxHp = 2;
      api.state.players[targetSide].board.seats[3] = highHp;
      api.state.players[targetSide].board.seats[4] = highAttack;
    }
    const leftItem = api.createCardFromBase("panpan", "player");
    const rightItem = api.createCardFromBase("panpan", "opponent");
    const leftPlan = api.planAiPanpan("player", leftItem);
    const rightPlan = api.planAiPanpan("opponent", rightItem);
    return {
      left: { friendly: leftPlan.friendly.card.baseId, enemy: leftPlan.enemy.card.baseId },
      right: { friendly: rightPlan.friendly.card.baseId, enemy: rightPlan.enemy.card.baseId }
    };
  });
  expect(result.left).toEqual({ friendly: "general_student", enemy: "protein_drinker" });
  expect(result.right).toEqual({ friendly: "general_student", enemy: "protein_drinker" });
});

test("左側CPUもパンパンの破壊判断を実際の効果処理に使用する", async ({ page }) => {
  await setup(page);
  const result = await page.evaluate(() => {
    const api = window.__chibattle;
    const single = api.makeBoardCard(api.createCardFromBase("single_cell", "player"));
    const expendable = api.makeBoardCard(api.createCardFromBase("general_student", "player"));
    expendable.attack = 0;
    expendable.currentHp = 1;
    expendable.maxHp = 1;
    const highHp = api.makeBoardCard(api.createCardFromBase("protein_drinker", "opponent"));
    highHp.currentHp = 9;
    highHp.maxHp = 9;
    api.state.players.player.board.seats[0] = single;
    api.state.players.player.board.seats[1] = expendable;
    api.state.players.opponent.board.seats[0] = highHp;
    const item = api.createCardFromBase("panpan", "player");
    api.state.players.player.hand = [item];
    const used = api.useTrainingYocchanItem("player", item);
    return {
      used,
      singleRemains: Boolean(api.state.players.player.board.seats[0]),
      expendableRemains: Boolean(api.state.players.player.board.seats[1]),
      highHpRemains: Boolean(api.state.players.opponent.board.seats[0])
    };
  });
  expect(result).toEqual({
    used: true,
    singleRemains: true,
    expendableRemains: false,
    highHpRemains: false
  });
});

test("確定破壊は攻撃力だけでなく現在の体力が高い出席者を優先する", async ({ page }) => {
  await setup(page);
  const result = await page.evaluate(() => {
    const api = window.__chibattle;
    const highHp = api.makeBoardCard(api.createCardFromBase("protein_drinker", "player"));
    const highAttack = api.makeBoardCard(api.createCardFromBase("lazy_student", "player"));
    highHp.currentHp = 9;
    highHp.maxHp = 9;
    highAttack.attack = 8;
    highAttack.currentHp = 2;
    highAttack.maxHp = 2;
    api.state.players.player.board.seats[0] = highHp;
    api.state.players.player.board.seats[1] = highAttack;
    const item = api.createCardFromBase("seriously_hit", "opponent");
    api.state.players.opponent.hand = [item];
    const used = api.useAiItem(item);
    return {
      used,
      highHpRemains: Boolean(api.state.players.player.board.seats[0]),
      highAttackRemains: Boolean(api.state.players.player.board.seats[1])
    };
  });
  expect(result).toEqual({ used: true, highHpRemains: false, highAttackRemains: true });
});
