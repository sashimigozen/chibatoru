const { test, expect } = require("@playwright/test");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const gameUrl = pathToFileURL(path.join(__dirname, "..", "index.html")).href;

async function setup(page, currentSide) {
  await page.goto(gameUrl);
  await page.evaluate((currentSide) => {
    const api = window.__chibattle;
    const { state } = api;
    state.preBattleToken += 1000;
    state.screen = "battle";
    state.phase = "battle";
    state.currentSide = currentSide;
    state.actionTurn = 9;
    state.firstSide = "player";
    state.environment = null;
    state.gameOver = false;
    state.training.active = currentSide === "player";
    state.training.leftController = currentSide === "player" ? "ai" : "user";
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
        originalDeckCounts: { back_question_student: 1, general_student: 39 }
      });
      state.players[side].board = { teacher: null, seats: Array(9).fill(null) };
    }
  }, currentSide);
}

test("右側CPUは相手の教卓マスを処理するとき3行目へ出席させる", async ({ page }) => {
  await setup(page, "opponent");
  const move = await page.evaluate(() => {
    const api = window.__chibattle;
    api.state.players.opponent.hand = [api.createCardFromBase("back_question_student", "opponent")];
    api.state.players.player.board.teacher = api.makeBoardCard(api.createCardFromBase("general_teacher", "player"));
    return api.findAiPlayMove();
  });
  expect(move.card.baseId).toBe("back_question_student");
  expect(move.zone).toBe("seat");
  expect(move.index).toBeGreaterThanOrEqual(6);
});

test("右側CPUは教卓マスに対象がない場合や3行目が満席の場合に温存する", async ({ page }) => {
  await setup(page, "opponent");
  const result = await page.evaluate(() => {
    const api = window.__chibattle;
    const ai = api.state.players.opponent;
    ai.hand = [api.createCardFromBase("back_question_student", "opponent")];
    const withoutTarget = api.findAiPlayMove();
    api.state.players.player.board.teacher = api.makeBoardCard(api.createCardFromBase("general_teacher", "player"));
    [6, 7, 8].forEach((index) => {
      ai.board.seats[index] = api.makeBoardCard(api.createCardFromBase("general_student", "opponent"));
    });
    const fullThirdRow = api.findAiPlayMove();
    return {
      withoutTarget: withoutTarget?.card.baseId || null,
      fullThirdRow: fullThirdRow?.card.baseId || null
    };
  });
  expect(result).toEqual({ withoutTarget: null, fullThirdRow: null });
});

test("左側CPUも相手の教卓マスを処理するとき3行目へ出席させる", async ({ page }) => {
  await setup(page, "player");
  const move = await page.evaluate(() => {
    const api = window.__chibattle;
    api.state.players.player.hand = [api.createCardFromBase("back_question_student", "player")];
    api.state.players.opponent.board.teacher = api.makeBoardCard(api.createCardFromBase("general_teacher", "opponent"));
    return api.findTrainingAiPlayMove("player");
  });
  expect(move.card.baseId).toBe("back_question_student");
  expect(move.zone).toBe("seat");
  expect(move.index).toBeGreaterThanOrEqual(6);
});

test("左側CPUも対象がない場合や3行目が満席の場合は教卓マスへ出さない", async ({ page }) => {
  await setup(page, "player");
  const result = await page.evaluate(() => {
    const api = window.__chibattle;
    const ai = api.state.players.player;
    ai.hand = [api.createCardFromBase("back_question_student", "player")];
    const withoutTarget = api.findTrainingAiPlayMove("player");
    api.state.players.opponent.board.teacher = api.makeBoardCard(api.createCardFromBase("general_teacher", "opponent"));
    [6, 7, 8].forEach((index) => {
      ai.board.seats[index] = api.makeBoardCard(api.createCardFromBase("general_student", "player"));
    });
    const fullThirdRow = api.findTrainingAiPlayMove("player");
    return {
      withoutTarget: withoutTarget?.card.baseId || null,
      fullThirdRow: fullThirdRow?.card.baseId || null
    };
  });
  expect(result).toEqual({ withoutTarget: null, fullThirdRow: null });
});
