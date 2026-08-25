const { test, expect } = require("@playwright/test");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const gameUrl = pathToFileURL(path.join(__dirname, "..", "index.html")).href;

test("オンラインバトルの各機能を専用画面へ切り替える", async ({ page }) => {
  await page.goto(gameUrl);
  await page.locator("#homeBattleButton").click();

  await expect(page.locator("#onlineScreen")).toBeVisible();
  await expect(page.locator("#onlineMenuHead")).toBeVisible();
  await expect(page.locator("#onlineMatchActions")).toBeVisible();
  await expect(page.locator("#onlinePrivatePanel")).toBeHidden();
  await expect(page.locator("#onlineSpectatePanel")).toBeHidden();

  await page.locator("#onlinePrivateMatchButton").click();
  await expect(page.locator("#onlineMenuHead")).toBeHidden();
  await expect(page.locator("#onlineMatchActions")).toBeHidden();
  await expect(page.locator("#onlineSubviewHead")).toBeVisible();
  await expect(page.locator("#onlineSubviewTitle")).toHaveText("プライベートマッチ");
  await expect(page.locator("#onlinePrivatePanel")).toBeVisible();
  await expect(page.locator("#onlineSpectatePanel")).toBeHidden();

  await page.locator("#onlineBackMenuButton").click();
  await expect(page.locator("#onlineMenuHead")).toBeVisible();
  await expect(page.locator("#onlineMatchActions")).toBeVisible();
  await expect(page.locator("#onlineSubviewHead")).toBeHidden();

  await page.locator("#onlineSpectateButton").click();
  await expect(page.locator("#onlineMenuHead")).toBeHidden();
  await expect(page.locator("#onlineMatchActions")).toBeHidden();
  await expect(page.locator("#onlineSubviewTitle")).toHaveText("観戦");
  await expect(page.locator("#onlinePrivatePanel")).toBeHidden();
  await expect(page.locator("#onlineSpectatePanel")).toBeVisible();
});
