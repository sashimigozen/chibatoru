const { test, expect } = require("@playwright/test");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const gameUrl = pathToFileURL(path.join(__dirname, "..", "index.html")).href;

async function evaluateDontWorry(page, options = {}) {
  await page.goto(gameUrl);
  return page.evaluate((options) => {
    const api = window.__chibattle;
    const { state } = api;
    state.preBattleToken += 1000;
    state.screen = "battle";
    state.phase = "battle";
    state.currentSide = "opponent";
    state.firstSide = "player";
    state.actionTurn = 6;
    state.testMode = false;
    state.gameOver = false;
    state.environment = null;
    state.noAttackUntilActionTurn = 0;
    for (const side of ["player", "opponent"]) {
      Object.assign(state.players[side], {
        life: 20,
        will: 6,
        maxWill: 6,
        hand: [],
        deck: Array.from({ length: 10 }, () => api.createCardFromBase("general_student", side)),
        trash: [],
        late: [],
        turnsTaken: 4,
        originalDeckCounts: {}
      });
      state.players[side].board = { teacher: null, seats: Array(9).fill(null) };
    }
    state.players.opponent.life = options.aiLife ?? 20;
    state.players.player.life = options.enemyLife ?? 20;
    if (options.enemyAttack) {
      const attacker = api.makeBoardCard(api.createCardFromBase("general_student", "player"));
      attacker.attack = options.enemyAttack;
      attacker.playedOnTurn = 0;
      state.players.player.board.seats[0] = attacker;
    }
    if (options.shieldActive) {
      state.players.opponent.lifeShieldUntilTurn = state.actionTurn + 1;
      state.players.opponent.lifeShieldUntilSide = "player";
    }
    const item = api.createCardFromBase("dont_worry", "opponent");
    state.players.opponent.hand = [item];
    const score = api.scoreAiItem(item, { timing: "beforeBoard" });
    return {
      score,
      shouldUse: api.shouldAiUseItemAtTiming(item, score, "beforeBoard")
    };
  }, options);
}

test("AI自身が次の相手ターンに倒される場合は気にするなを最優先する", async ({ page }) => {
  const result = await evaluateDontWorry(page, { aiLife: 5, enemyLife: 20, enemyAttack: 5 });
  expect(result.score).toBeGreaterThan(40);
  expect(result.shouldUse).toBe(true);
});

test("相手の気力が低くても本体ダメージの危険がなければ使わない", async ({ page }) => {
  const result = await evaluateDontWorry(page, { aiLife: 20, enemyLife: 4, enemyAttack: 0 });
  expect(result).toEqual({ score: 0, shouldUse: false });
});

test("すでに気にするなの防御が有効なら重ねて使わない", async ({ page }) => {
  const result = await evaluateDontWorry(page, { aiLife: 5, enemyLife: 20, enemyAttack: 8, shieldActive: true });
  expect(result).toEqual({ score: 0, shouldUse: false });
});
