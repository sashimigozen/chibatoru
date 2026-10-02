const { test, expect } = require("@playwright/test");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const gameUrl = pathToFileURL(path.join(__dirname, "..", "index.html")).href;

async function setup(page, currentSide = "opponent") {
  await page.goto(gameUrl);
  await page.evaluate((side) => {
    const api = window.__chibattle;
    const { state } = api;
    state.preBattleToken += 1000;
    state.screen = "battle";
    state.phase = "battle";
    state.currentSide = side;
    state.actionTurn = 9;
    state.firstSide = "player";
    state.environment = null;
    state.gameOver = false;
    state.aiLethalForcedTargetId = null;
    for (const owner of ["player", "opponent"]) {
      Object.assign(state.players[owner], {
        life: 20,
        will: 10,
        maxWill: 10,
        hand: [],
        deck: [],
        trash: [],
        late: [],
        turnsTaken: 5,
        originalDeckCounts: {}
      });
      state.players[owner].board = { teacher: null, seats: Array(9).fill(null) };
    }
  }, currentSide);
}

test("左右のCPUは講義の1ダメージで学生1人を倒せるなら攻撃しない", async ({ page }) => {
  await setup(page);
  const result = await page.evaluate(() => {
    const api = window.__chibattle;
    const prepare = (side) => {
      const targetSide = side === "player" ? "opponent" : "player";
      api.state.currentSide = side;
      api.state.players[side].board = { teacher: null, seats: Array(9).fill(null) };
      api.state.players[targetSide].board = { teacher: null, seats: Array(9).fill(null) };
      const teacher = api.makeBoardCard(api.createCardFromBase("general_teacher", side));
      teacher.playedOnTurn = 0;
      const target = api.makeBoardCard(api.createCardFromBase("general_student", targetSide));
      target.currentHp = 1;
      api.state.players[side].board.teacher = teacher;
      api.state.players[targetSide].board.seats[0] = target;
      const ref = { owner: side, zone: "teacher", index: null };
      return api.shouldAiUseLecture(ref, teacher, side);
    };
    return {
      rightCpu: prepare("opponent"),
      leftCpu: prepare("player")
    };
  });
  expect(result).toEqual({ rightCpu: true, leftCpu: true });
});

test("アグロクイーンのターン終了時ダメージで確定して倒せる学生に攻撃しない", async ({ page }) => {
  await setup(page);
  const result = await page.evaluate(() => {
    const api = window.__chibattle;
    const queen = api.makeBoardCard(api.createCardFromBase("aggro_queen", "opponent"));
    queen.playedOnTurn = 0;
    const target = api.makeBoardCard(api.createCardFromBase("general_student", "player"));
    target.currentHp = 2;
    target.attack = 8;
    api.state.players.opponent.board.seats[5] = queen;
    api.state.players.player.board.seats[0] = target;
    const plan = api.planAiGuaranteedEndTurnEffectKills("opponent");
    return {
      reservedTarget: plan.targetIds.has(target.instanceId),
      preservesQueen: plan.sourceIds.has(queen.instanceId),
      attackTarget: api.findAiAttackTarget(queen)
    };
  });
  expect(result).toEqual({
    reservedTarget: true,
    preservesQueen: true,
    attackTarget: null
  });
});

test("アグロクイーンのランダム対象が複数いるときは、倒す対象を確定扱いしない", async ({ page }) => {
  await setup(page);
  const result = await page.evaluate(() => {
    const api = window.__chibattle;
    const queen = api.makeBoardCard(api.createCardFromBase("aggro_queen", "opponent"));
    queen.playedOnTurn = 0;
    api.state.players.opponent.board.seats[5] = queen;
    for (const index of [0, 1]) {
      const target = api.makeBoardCard(api.createCardFromBase("general_student", "player"));
      target.currentHp = 2;
      target.keywords = [...(target.keywords || []), "注目"];
      api.state.players.player.board.seats[index] = target;
    }
    const plan = api.planAiGuaranteedEndTurnEffectKills("opponent");
    return {
      reservedTargets: plan.targetIds.size,
      hasAttackTarget: Boolean(api.findAiAttackTarget(queen))
    };
  });
  expect(result).toEqual({ reservedTargets: 0, hasAttackTarget: true });
});

test("後ろにいるクイーンが全学生を確実に倒せるときも攻撃を控える", async ({ page }) => {
  await setup(page, "player");
  const result = await page.evaluate(() => {
    const api = window.__chibattle;
    const queen = api.makeBoardCard(api.createCardFromBase("rear_queen", "player"));
    queen.playedOnTurn = 0;
    const target = api.makeBoardCard(api.createCardFromBase("general_student", "opponent"));
    target.currentHp = 4;
    target.attack = 8;
    api.state.players.player.board.seats[0] = queen;
    api.state.players.opponent.board.seats[0] = target;
    const plan = api.planAiGuaranteedEndTurnEffectKills("player");
    return {
      reservedTarget: plan.targetIds.has(target.instanceId),
      preservesQueen: plan.sourceIds.has(queen.instanceId),
      attackTarget: api.findTrainingAiAttackTarget("player", queen)
    };
  });
  expect(result).toEqual({
    reservedTarget: true,
    preservesQueen: true,
    attackTarget: null
  });
});
