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
    state.firstSide = "player";
    state.actionTurn = 8;
    state.testMode = false;
    state.gameOver = false;
    state.environment = null;
    for (const side of ["player", "opponent"]) {
      Object.assign(state.players[side], {
        life: 20,
        will: 6,
        maxWill: 6,
        hand: [],
        deck: Array.from({ length: 10 }, () => api.createCardFromBase("general_student", side)),
        trash: [],
        late: [],
        turnsTaken: 5,
        originalDeckCounts: {}
      });
      state.players[side].board = { teacher: null, seats: Array(9).fill(null) };
    }
  });
}

test("現在体力が最も高い学生を破壊し、基本体力や攻撃力の高さでは選ばない", async ({ page }) => {
  await setup(page);
  const result = await page.evaluate(() => {
    const api = window.__chibattle;
    const { state } = api;
    const damagedProtein = api.makeBoardCard(api.createCardFromBase("protein_drinker", "player"));
    damagedProtein.currentHp = 1;
    damagedProtein.attack = 12;
    const buffedStudent = api.makeBoardCard(api.createCardFromBase("general_student", "player"));
    buffedStudent.currentHp = buffedStudent.maxHp = 5;
    state.players.player.board.seats[0] = damagedProtein;
    state.players.player.board.seats[1] = buffedStudent;
    const item = api.createCardFromBase("scared_me", "opponent");
    state.players.opponent.hand = [item];
    const used = api.useAiItem(item);
    return {
      used,
      remaining: state.players.player.board.seats.filter(Boolean).map((card) => card.baseId),
      trash: state.players.player.trash.map((card) => card.baseId)
    };
  });
  expect(result).toEqual({
    used: true,
    remaining: ["protein_drinker"],
    trash: ["general_student"]
  });
});

test("AIの使用評価も対象になる学生の現在体力に応じて上がる", async ({ page }) => {
  await setup(page);
  const scores = await page.evaluate(() => {
    const api = window.__chibattle;
    const { state } = api;
    const item = api.createCardFromBase("scared_me", "opponent");
    state.players.opponent.hand = [item];
    const target = api.makeBoardCard(api.createCardFromBase("general_student", "player"));
    target.attack = 1;
    target.maxHp = 8;
    target.currentHp = 8;
    state.players.player.board.seats[0] = target;
    const healthy = api.scoreAiItem(item, { timing: "beforeBoard" });
    target.currentHp = 1;
    const damaged = api.scoreAiItem(item, { timing: "beforeBoard" });
    return { healthy, damaged };
  });
  expect(scores.healthy).toBeGreaterThan(scores.damaged + 8);
});
