const { test, expect } = require("@playwright/test");
const { pathToFileURL } = require("node:url");
const path = require("node:path");
const url = pathToFileURL(path.join(__dirname, "..", "index.html")).href;

for (const width of [1280, 390]) test(`カード修正は能力値と全文を載せ差分だけ強調する ${width}`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 });
  await page.goto(url);
  await page.locator("#homeUpdatesButton").click();
  const release = page.locator(".update-entry").first();
  await release.locator("summary").click();
  const change = release.locator(".update-change").filter({
    has: page.locator(".update-before strong", { hasText: "形容詞学生vs冷笑学生" })
  });
  for (const selector of [".update-before", ".update-after"]) {
    await expect(change.locator(selector)).toContainText("学生／共通カード／戦意6／攻撃力5／体力5");
    await expect(change.locator(selector)).toContainText("このカードは横に連続した席マスを2つ使用する。");
    await expect(change.locator(selector)).toContainText("1. 相手の出席者1人をランダムに破壊する。");
    await expect(change.locator(selector)).toHaveCSS("color", "rgb(51, 65, 85)");
  }
  await expect(change.locator(".update-before .update-text-highlight")).toHaveText(["-2"]);
  await expect(change.locator(".update-after .update-text-highlight")).toHaveText(["次の相手のターン終了まで、", "-3"]);
  const currentRules = await page.evaluate(() => cardRulesText(createCardFromBase("adjective_vs_cynical", "player")));
  await expect(change.locator(".update-after")).toContainText(currentRules);
  await change.scrollIntoViewIfNeeded();
  const box = await change.boundingBox();
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(width);
  await change.screenshot({ path: test.info().outputPath("card-comparison.png") });
});

test("強調箇所もHTMLとして実行せず文字として扱う", async ({ page }) => {
  await page.goto(url);
  const html = await page.evaluate(() => updateHighlightedText('<img src=x onerror=alert(1)> &', ['<img src=x onerror=alert(1)>']));
  expect(html).not.toContain("<img");
  expect(html).toContain("&lt;img");
  expect(html).toContain("&amp;");
});
