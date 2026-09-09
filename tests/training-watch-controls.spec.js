const { test, expect } = require("@playwright/test");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const gameUrl = pathToFileURL(path.join(__dirname, "..", "index.html")).href;

test.beforeEach(async ({ page }) => {
  await page.goto(gameUrl);
  await page.evaluate(() => {
    const api = window.__chibattle;
    api.state.screen = "battle";
    api.state.phase = "battle";
    api.state.training.active = true;
    api.state.training.leftController = "ai";
    api.state.training.speed = 1;
    api.state.training.paused = false;
    api.state.training.skipAnimations = false;
    api.state.training.controlsCollapsed = false;
    api.render();
  });
});

test("CPU同士の観戦操作を対戦中に折りたたみ、その場で再表示できる", async ({ page }) => {
  const controls = page.locator("#trainingWatchControls");
  await expect(controls).toBeVisible();
  await expect(controls.locator("[data-training-speed]")).toHaveCount(3);

  await controls.locator('[data-training-speed="4"]').click();
  await expect(controls.locator('[data-training-speed="4"]')).toHaveClass(/active/);
  const collapseBox = await controls.locator("[data-training-collapse]").boundingBox();
  await controls.locator("[data-training-collapse]").click();

  await expect(controls).toHaveClass(/collapsed/);
  await expect(controls.locator("[data-training-speed]").first()).toBeHidden();
  await expect(controls.locator("[data-training-expand]")).toBeVisible();
  await expect(controls.locator("[data-training-expand]")).toHaveText("^");
  const expandBox = await controls.locator("[data-training-expand]").boundingBox();
  expect(Math.abs(expandBox.x - collapseBox.x)).toBeLessThan(1);
  expect(Math.abs(expandBox.y - collapseBox.y)).toBeLessThan(1);

  await controls.locator("[data-training-expand]").click();
  await expect(controls).not.toHaveClass(/collapsed/);
  await expect(controls.locator('[data-training-speed="4"]')).toHaveClass(/active/);
});

test("対戦準備へ戻ると観戦操作の折りたたみ状態をリセットする", async ({ page }) => {
  await page.locator("#trainingWatchControls [data-training-collapse]").click();
  await page.evaluate(() => window.__chibattle.startSoloBattleFromHome());
  expect(await page.evaluate(() => window.__chibattle.state.training.controlsCollapsed)).toBe(false);
  await expect(page.locator("#trainingWatchControls")).toHaveCount(0);
});
