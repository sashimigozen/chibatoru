const { test, expect } = require("@playwright/test");
const { pathToFileURL } = require("node:url");
const path = require("node:path");
const url = pathToFileURL(path.join(__dirname, "..", "index.html")).href;

for (const width of [1280, 390]) test(`最新更新を分類し全文と差分を維持する ${width}`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 });
  await page.goto(url);
  await page.locator("#homeUpdatesButton").click();
  const release = page.locator(".update-entry").filter({has: page.locator('summary', {hasText:'ver.0.27.0'})});
  await release.locator("summary").click();
  await expect(release.locator(".update-category h3")).toHaveText(["新カード", "カード調整", "システム", "表示・操作改善", "不具合修正"]);
  const groups = release.locator(".update-category");
  await expect(groups.nth(0).locator(".update-change")).toHaveCount(5);
  await expect(groups.nth(1).locator(".update-change")).toHaveCount(9);
  await expect(groups.nth(2)).toContainText("融合の追加素材");
  await expect(groups.nth(3)).toContainText("手札の状態表示");
  const titles = await release.locator(".update-change strong").allTextContents();
  expect(titles.filter(title => title.includes("マイボの骨"))).toHaveLength(1);
  const sniper = groups.nth(0).locator('.update-change').filter({hasText:'新カード：窓からスナイプ学生'});
  await expect(sniper).toContainText('戦意3／攻撃力2／体力1');
  await expect(sniper).toContainText('手札から3行3列に出席させたとき');
  await expect(sniper.locator('.update-text-highlight')).toHaveCount(0);
  await expect(sniper).not.toContainText('体力2');
  await expect(groups.nth(1)).toContainText("学生／学友会・持ち物／戦意5／攻撃力3／体力3");
  await expect(groups.nth(1).locator(".update-text-highlight").first()).toHaveText("2ダメージ");
  for (const group of await groups.all()) {
    await group.scrollIntoViewIfNeeded();
    const box = await group.boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(width);
  }
  await release.locator("summary").scrollIntoViewIfNeeded();
  await page.screenshot({ path: test.info().outputPath("categories.png") });
});
