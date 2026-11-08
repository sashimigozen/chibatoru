const { test, expect } = require("@playwright/test");
const { pathToFileURL } = require("node:url");
const path = require("node:path");
const gameUrl = pathToFileURL(path.join(__dirname, "..", "index.html")).href;

test("一覧を表示しても赤ポチを保ち、開いた項目だけ既読になって再読み込み後も保持する", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(gameUrl);
  await page.evaluate(() => {
    localStorage.setItem(UPDATE_READ_STORAGE_KEY, JSON.stringify(DISPLAY_UPDATE_HISTORY.slice(2).map(updateReadId)));
    renderHomeUpdateStatus();
  });
  await expect(page.locator("#homeUpdatesDot")).toBeVisible();
  await page.locator("#homeUpdatesButton").click();
  const first = page.locator(".update-entry").nth(0);
  const second = page.locator(".update-entry").nth(1);
  await expect(page.locator(".update-entry.unread")).toHaveCount(2);
  expect(await first.locator("summary").evaluate(summary => {
    const style = getComputedStyle(summary, "::before");
    return [style.backgroundColor, style.width, style.height];
  })).toEqual(["rgb(220, 38, 38)", "9px", "9px"]);
  await page.screenshot({ path: test.info().outputPath("unread-updates-list.png") });
  await page.locator("#updatesBackHomeButton").click();
  await expect(page.locator("#homeUpdatesDot")).toBeVisible();
  await page.locator("#homeUpdatesButton").click();
  await first.locator("summary").click();
  await expect(first).not.toHaveClass(/unread/);
  await expect(second).toHaveClass(/unread/);
  await page.reload();
  await expect(page.locator("#homeUpdatesDot")).toBeVisible();
  await page.locator("#homeUpdatesButton").click();
  await expect(first).not.toHaveClass(/unread/);
  await expect(second).toHaveClass(/unread/);
  await second.locator("summary").click();
  await expect(page.locator(".update-entry.unread")).toHaveCount(0);
  await page.locator("#updatesBackHomeButton").click();
  await expect(page.locator("#homeUpdatesDot")).toBeHidden();
});

test("追加された更新と同じバージョンへの追記も自動で未読表示する", async ({ page }) => {
  await page.goto(gameUrl);
  await page.evaluate(() => {
    localStorage.setItem(UPDATE_READ_STORAGE_KEY, JSON.stringify(DISPLAY_UPDATE_HISTORY.map(updateReadId)));
    renderHomeUpdateStatus();
  });
  await expect(page.locator("#homeUpdatesDot")).toBeHidden();
  await page.evaluate(() => {
    DISPLAY_UPDATE_HISTORY.unshift({
      version: "ver.99.0.0",
      date: "2026年11月10日",
      summary: "追加された更新",
      changes: [{ title: "表示", after: "更新内容" }]
    });
    renderHomeUpdateStatus();
  });
  await expect(page.locator("#homeUpdatesDot")).toBeVisible();
  await page.locator("#homeUpdatesButton").click();
  const added = page.locator(".update-entry").first();
  await expect(added).toHaveClass(/unread/);
  await added.locator("summary").click();
  await expect(added).not.toHaveClass(/unread/);
  await page.locator("#updatesBackHomeButton").click();
  await expect(page.locator("#homeUpdatesDot")).toBeHidden();
  await page.evaluate(() => {
    DISPLAY_UPDATE_HISTORY[0].summary += "・追記";
    renderHomeUpdateStatus();
  });
  await expect(page.locator("#homeUpdatesDot")).toBeVisible();
  await page.locator("#homeUpdatesButton").click();
  await expect(added).toHaveClass(/unread/);
  await expect(page.locator(".update-entry.unread")).toHaveCount(1);
});
