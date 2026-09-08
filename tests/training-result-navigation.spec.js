const { test, expect } = require("@playwright/test");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const gameUrl = pathToFileURL(path.join(__dirname, "..", "index.html")).href;

async function showTrainingResult(page) {
  await page.goto(gameUrl);
  await page.evaluate(() => {
    const api = window.__chibattle;
    api.state.deckBuilder.chaosDecks = {
      "再戦確認用": { counts: { general_student: 40 } }
    };
    Object.assign(api.state.soloSelection, {
      ruleId: "chaos",
      leftController: "ai",
      playerDeckName: "再戦確認用",
      opponentDeckName: "再戦確認用",
      initiative: "random"
    });
    api.state.screen = "battle";
    api.state.phase = "battle";
    api.state.currentSide = "player";
    api.state.gameOver = false;
    api.state.training.active = true;
    api.state.training.leftController = "ai";
    api.state.training.currentConfigKey = "chaos|ai|再戦確認用|再戦確認用";
    api.state.training.replayRemaining = 0;
    api.state.training.series = null;
    api.state.players.player.will = api.state.players.player.maxWill = 10;
    api.state.players.opponent.life = 4;
    const king = api.createCardFromBase("king_ghidorah_bed", "player");
    api.state.players.player.hand = [king];
    api.resolveKingGhidorahBed("player", king, "3", null, null, true);
  });
  await expect(page.locator("#resultOverlay")).toBeVisible();
}

test("リザルトのデータを閉じるとリザルトに戻る", async ({ page }) => {
  await showTrainingResult(page);

  await page.locator("[data-result-training-data]").click();
  await expect(page.locator("#soloTrainingDataOverlay")).toBeVisible();
  await expect(page.locator("#resultOverlay")).toBeVisible();
  expect(await page.evaluate(() => window.__chibattle.state.screen)).toBe("battle");

  await page.locator("#soloTrainingDataCloseButton").click();
  await expect(page.locator("#soloTrainingDataOverlay")).toBeHidden();
  await expect(page.locator("#resultOverlay")).toBeVisible();
  expect(await page.evaluate(() => ({
    screen: window.__chibattle.state.screen,
    trainingActive: window.__chibattle.state.training.active
  }))).toEqual({ screen: "battle", trainingActive: true });
});

test("リザルトの再戦設定をその場で開き、指定回数で開始できる", async ({ page }) => {
  await showTrainingResult(page);

  await page.locator("[data-result-training-replay]").click();
  await expect(page.locator("#soloTrainingReplayOverlay")).toBeVisible();
  await expect(page.locator("#resultOverlay")).toBeVisible();
  expect(await page.evaluate(() => window.__chibattle.state.screen)).toBe("battle");

  await page.locator("#soloTrainingReplayCount").fill("3");
  await page.locator("#soloTrainingReplayForm button[type=submit]").click();
  await expect(page.locator("#soloTrainingReplayOverlay")).toBeHidden();
  await expect(page.locator("#resultOverlay")).toBeHidden();
  expect(await page.evaluate(() => ({
    screen: window.__chibattle.state.screen,
    replayTotal: window.__chibattle.state.training.replayTotal,
    replayRemaining: window.__chibattle.state.training.replayRemaining,
    trainingActive: window.__chibattle.state.training.active
  }))).toEqual({
    screen: "battle",
    replayTotal: 3,
    replayRemaining: 2,
    trainingActive: true
  });
});
