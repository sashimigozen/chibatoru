const { test, expect } = require("@playwright/test");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const gameUrl = pathToFileURL(path.join(__dirname, "..", "index.html")).href;

test.beforeEach(async ({ page }) => {
  await page.goto(gameUrl);
  await page.locator("#homeSoloButton").click();
});

test("ソロモードをAIバトル、魔の1号館、トレーニングの順に表示する", async ({ page }) => {
  const order = await page.locator("#soloMenuScreen .solo-mode-button").evaluateAll((buttons) =>
    buttons.map((button) => button.id));

  expect(order).toEqual(["soloAiBattleButton", "soloDungeonButton", "soloTrainingButton"]);
  await expect(page.locator("#soloAiBattleButton")).toBeDisabled();
  await expect(page.locator("#soloAiBattleButton")).toContainText("COMING SOON");
  await expect(page.locator("#soloAiBattleButton")).toContainText("ランダムなAIデッキ");
});

test("従来のAIバトルをトレーニングとして開く", async ({ page }) => {
  await page.locator("#soloTrainingButton").click();

  await expect(page.locator("#soloDeckScreen")).toBeVisible();
  await expect(page.locator("#soloDeckScreen h1")).toHaveText("トレーニング");
  await expect(page.locator("#soloPlayerSlot")).toBeVisible();
  await expect(page.locator("#soloAiSlot")).toBeVisible();
});

test("魔の1号館は2番目のボタンから開く", async ({ page }) => {
  await page.locator("#soloDungeonButton").click();
  await expect(page.locator("#dungeonEntranceScreen")).toBeVisible();
});

test("9月6日の更新情報にソロモードの変更を記載する", async ({ page }) => {
  await page.locator("#soloMenuBackHomeButton").click();
  await page.locator("#homeUpdatesButton").click();
  const latest = page.locator(".update-entry").filter({ hasText: "ver.0.22.3" });

  await expect(latest).toContainText("ver.0.22.3");
  await expect(latest).toContainText("2026年9月6日");
  await expect(latest).toContainText("トレーニング");
  await expect(latest).toContainText("COMING SOON");
});
