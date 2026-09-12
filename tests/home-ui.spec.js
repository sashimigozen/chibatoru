const { test, expect } = require("@playwright/test");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const gameUrl = pathToFileURL(path.join(__dirname, "..", "index.html")).href;
const profileStorageKey = "chibattle-player-profile-v1";
const lectureNoticeKey = "chibattle-lecture-experiment-notice-v1";

test.beforeEach(async ({ page }) => {
  await page.goto(gameUrl);
  await page.evaluate(({ profileKey, noticeKey }) => {
    localStorage.setItem(noticeKey, "shown");
    localStorage.setItem(profileKey, JSON.stringify({
      username: "ホーム確認",
      avatarId: "glasses",
      favoriteCardId: "aggro_king",
      favoriteCardStyle: "normal",
      commentParts: ["対戦よろしく", "お願いします", "エンジョイ"]
    }));
  }, { profileKey: profileStorageKey, noticeKey: lectureNoticeKey });
  await page.reload();
});

test("ホームの好きなカードをめくり、表だけでカード名と拡大表示を出す", async ({ page }) => {
  const cardButton = page.locator("#homeFavoriteCardButton");
  const cardLabel = page.locator("#homeFavoriteCardLabel");

  await cardButton.hover();
  await expect.poll(() => cardLabel.evaluate((element) => getComputedStyle(element).opacity)).toBe("0");

  await page.locator("#homeFavoriteCardFlipButton").click();
  await expect(cardButton).toHaveClass(/is-flipped/);
  await cardButton.hover();
  await expect.poll(() => cardLabel.evaluate((element) => getComputedStyle(element).opacity)).toBe("1");
  await expect(cardLabel).toHaveText("アグロキング");

  await cardButton.click();
  await expect(page.locator("#homeFavoriteCardPreview")).toBeVisible();
  await expect(page.locator("#homeFavoriteCardPreviewCard .card-name")).toHaveText("アグロキング");
  await page.locator("#homeFavoriteCardPreviewCloseButton").click();
  await expect(page.locator("#homeFavoriteCardPreview")).toBeHidden();
});

test("デッキケースからカード画面を開き、ランダムマッチは検索画面へ直接進む", async ({ page }) => {
  const deckButton = page.locator("#homeDeckButton");
  await deckButton.hover();
  await expect.poll(() => page.locator("#homeDeckName").evaluate((element) => getComputedStyle(element).opacity)).toBe("1");
  await deckButton.click();
  await expect(page.locator("#deckScreen")).toBeVisible();

  await page.locator("#homeNavHomeButton").click();
  await page.locator("#homeBattleButton").click();
  await expect(page.locator("#onlineScreen")).toBeVisible();
  await expect(page.locator("#onlineRandomSetupPanel")).toBeVisible();
  await expect(page.locator("#onlineRandomMainText")).toContainText(/マッチング中|マッチしました/);
});
