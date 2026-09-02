const { test, expect } = require("@playwright/test");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const gameUrl = pathToFileURL(path.join(__dirname, "..", "index.html")).href;

test("下部ホームバーだけを既存画面へ追加し、素材どおりに表示する", async ({ page }) => {
  await page.goto(gameUrl);

  const navigation = page.locator("#homeNavigation");
  await expect(navigation).toBeVisible();
  await expect(page.locator("#homeNavHomeButton")).toHaveAttribute("aria-current", "page");

  const iconSizes = await navigation.locator("img").evaluateAll((images) =>
    images.map((image) => ({ width: image.naturalWidth, height: image.naturalHeight }))
  );
  expect(iconSizes).toEqual(Array.from({ length: 5 }, () => ({ width: 320, height: 320 })));
  await expect(navigation.locator(".home-nav-item").last()).toHaveCSS("opacity", "1");

  const deckButton = page.locator("#homeNavDeckButton");
  const deckIcon = deckButton.locator("img");
  await expect(deckIcon).toHaveCSS("content", "normal");
  await deckButton.hover();
  await expect(deckButton).toHaveCSS("background-color", "rgb(225, 243, 252)");
  await expect.poll(() => deckIcon.evaluate((icon) => getComputedStyle(icon).content))
    .toContain("nav-card-glow.png");

  const battleButton = page.locator("#homeNavBattleButton");
  const battleIcon = battleButton.locator("img");
  await battleButton.hover();
  await expect.poll(() => battleIcon.evaluate((icon) => getComputedStyle(icon).content))
    .toContain("nav-battle-glow.png");

  await deckButton.click();
  await expect(page.locator("#deckLibraryView")).toBeVisible();
  await expect(navigation).toBeVisible();
  await expect(deckButton).toHaveAttribute("aria-current", "page");

  await page.locator("#deckLibraryGrid .new-deck").click();
  await expect(page.locator("#deckEditorView")).toBeVisible();
  await expect(navigation).toBeHidden();

  await page.locator("#deckFilterPanel > summary").click();
  const cardSearch = page.locator("#deckSearchInput");
  await expect(cardSearch).toHaveAttribute("placeholder", "カード名・テキストを検索");
  await cardSearch.fill("最大戦意は3");
  await expect(page.locator("#deckEditorList .deck-row-name", { hasText: "パッドプレゼンクリエイター" })).toBeVisible();
  await expect(page.locator("#deckEditorList .deck-row-name", { hasText: "一般学生" })).toHaveCount(0);
  await cardSearch.fill("キングギドラベッド");
  await expect(page.locator("#deckEditorList .deck-row-name", { hasText: "キングギドラベッド" })).toBeVisible();

  await page.locator("#deckEditorBackButton").click();
  await expect(navigation).toBeVisible();

  await battleButton.click();
  await expect(page.locator("#onlineScreen")).toBeVisible();
  await expect(navigation).toBeVisible();
  await expect(battleButton).toHaveAttribute("aria-current", "page");

  await page.locator("#homeNavSoloButton").click();
  await expect(page.locator("#soloMenuScreen")).toBeVisible();
  await expect(navigation).toBeVisible();
  await expect(page.locator("#homeNavSoloButton")).toHaveAttribute("aria-current", "page");

  await page.locator("#homeNavHomeButton").click();
  await page.locator("#homeTutorialButton").click();
  await expect(page.locator("#battleScreen")).toBeVisible();
  await expect(navigation).toBeHidden();
});
