const { test, expect } = require("@playwright/test");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const gameUrl = pathToFileURL(path.join(__dirname, "..", "index.html")).href;
const storageKey = "chibattle-player-profile-v1";

test.beforeEach(async ({ page }) => {
  await page.goto(gameUrl);
  await page.evaluate((key) => localStorage.removeItem(key), storageKey);
  await page.reload();
});

test("未設定時は既定プロフィールを表示し、8種類の既存系統アイコンから選べる", async ({ page }) => {
  await expect(page.locator("#homeProfileName")).toHaveText("チバトル学生");
  await expect(page.locator("#homeProfileAvatar")).toHaveClass(/user/);

  await page.locator("#homeProfileButton").click();
  await expect(page.locator("#profileModal")).toBeVisible();
  await expect(page.locator("#profileAvatarGrid [data-profile-avatar]")).toHaveCount(8);
  await expect(page.locator("#profileAvatarGrid [aria-pressed=true]")).toHaveCount(1);
});

test("ユーザー名を検証・整形して安全に保存し、再読み込み後も維持する", async ({ page }) => {
  await page.locator("#homeProfileButton").click();
  await page.locator("#profileUsernameInput").fill("   ");
  await page.locator("#profileForm button[type=submit]").click();
  await expect(page.locator("#profileUsernameError")).toContainText("入力してください");
  await expect(page.locator("#profileModal")).toBeVisible();

  await page.locator("#profileUsernameInput").fill("  <b>チバ</b>  ");
  await page.locator("[data-profile-avatar=glasses]").click();
  await page.locator("#profileForm button[type=submit]").click();
  await expect(page.locator("#homeProfileName")).toHaveText("<b>チバ</b>");
  await expect(page.locator("#homeProfileName b")).toHaveCount(0);

  expect(await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), storageKey)).toEqual({
    username: "<b>チバ</b>",
    avatarId: "glasses",
    favoriteCardId: ""
  });
  await page.reload();
  await expect(page.locator("#homeProfileName")).toHaveText("<b>チバ</b>");
  await expect(page.locator("#homeProfileAvatar")).toHaveClass(/avatar-glasses/);
});

test("既存カード検索と描画を使って好きなカードを保存する", async ({ page }) => {
  await page.locator("#homeProfileButton").click();
  await page.locator("#profileFavoriteCardButton").click();
  await page.locator("#profileCardSearchInput").fill("キングギドラベッド");
  await expect(page.locator("#profileCardGrid [data-profile-card-id=king_ghidorah_bed]")).toHaveCount(1);
  await page.locator("#profileCardGrid [data-profile-card-id=king_ghidorah_bed]").click();
  await expect(page.locator("#profileFavoriteCardName")).toHaveText("キングギドラベッド");
  await expect(page.locator("#profileFavoriteCardPreview .card-name")).toHaveText("キングギドラベッド");
  await page.locator("#profileForm button[type=submit]").click();
  await expect(page.locator("#homeProfileFavorite")).toContainText("キングギドラベッド");
  await page.reload();
  await expect(page.locator("#homeProfileFavorite")).toContainText("キングギドラベッド");
});

test("プロフィールはソロのユーザー側だけに反映し、CPUへ切り替えると既存表示へ戻る", async ({ page }) => {
  await page.evaluate((key) => localStorage.setItem(key, JSON.stringify({
    username: "テスト観戦者",
    avatarId: "robot_antenna",
    favoriteCardId: "general_student"
  })), storageKey);
  await page.reload();
  await page.locator("#homeSoloButton").click();
  await page.locator("#soloTrainingButton").click();
  await expect(page.locator("#soloLeftRoleTitle")).toHaveText("テスト観戦者");
  await expect(page.locator("#soloLeftAvatar")).toHaveClass(/avatar-robot-antenna/);

  await page.locator("#soloLeftControllerButton").click();
  await expect(page.locator("#soloLeftRoleTitle")).toHaveText("CPU");
  await expect(page.locator("#soloLeftAvatar")).toHaveClass(/cpu/);
  await expect(page.locator("#soloLeftAvatar")).not.toHaveClass(/avatar-robot-antenna/);
  await expect(page.locator("#soloDeckScreen .training-player-panel").last().locator(".training-avatar")).toHaveClass(/cpu/);
});

test("壊れた保存値や存在しないカードIDは既定値へ正規化して画面を壊さない", async ({ page }) => {
  await page.evaluate((key) => localStorage.setItem(key, JSON.stringify({
    username: "   ",
    avatarId: "unknown-avatar",
    favoriteCardId: "missing-card"
  })), storageKey);
  await page.reload();
  await expect(page.locator("#homeProfileName")).toHaveText("チバトル学生");
  await expect(page.locator("#homeProfileAvatar")).toHaveClass(/user/);
  await expect(page.locator("#homeProfileFavorite")).toContainText("未設定");
});
