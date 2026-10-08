const { test, expect } = require("@playwright/test");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const gameUrl = pathToFileURL(path.join(__dirname, "..", "index.html")).href;

async function start(page, stage) {
  await page.evaluate((stage) => window.__chibattle.startTutorialBattle("placement", { stage }), stage);
  await expect(page.locator("#tutorialCoach")).toBeVisible();
  await expect(page.locator("#tutorialLayer")).not.toHaveClass(/hidden/);
}

for (const stage of ["quiz", "expert"]) {
  test(`${stage}：説明は3秒後にフェードし、やり直しは独立して残る`, async ({ page }) => {
    await page.setViewportSize({ width: stage === "quiz" ? 1280 : 1920, height: stage === "quiz" ? 900 : 1080 });
    await page.goto(gameUrl);
    await start(page, stage);
    const retry = page.locator("#tutorialRetryButton");
    const initial = await page.evaluate(() => JSON.stringify(window.__chibattle.state.players));
    const box = await retry.boundingBox();
    const coachBox = await page.locator("#tutorialCoach").boundingBox();
    const exitBox = await page.locator("#tutorialExitButton").boundingBox();
    const menuBox = await page.getByRole("button", { name: "MENU", exact: true }).boundingBox();
    expect(exitBox.x).toBeGreaterThanOrEqual(menuBox.x + menuBox.width);
    expect(box.x).toBeGreaterThanOrEqual(exitBox.x + exitBox.width);
    expect(box.x + box.width).toBeLessThan(coachBox.x);
    expect(box.y).toBe(exitBox.y);
    await expect(page.locator("#tutorialNextButton")).toBeHidden();
    await page.screenshot({ path: test.info().outputPath(`${stage}-intro.png`) });
    await page.waitForTimeout(2000);
    expect(await page.evaluate(() => window.__chibattle.state.tutorial.coachHidden === true)).toBe(false);
    // 操作による再描画が説明の表示時間を延長しない。
    await page.evaluate(() => window.__chibattle.render());
    await expect.poll(() => page.evaluate(() => window.__chibattle.state.tutorial.coachHidden), { timeout: 1800 }).toBe(true);
    expect(await page.locator("#tutorialCoach").evaluate((node) => getComputedStyle(node).transitionProperty)).toContain("opacity");
    await expect(page.locator("#tutorialCoach")).toBeHidden();
    expect(await page.locator("#tutorialCoach").evaluate((node) => ({
      opacity: getComputedStyle(node).opacity,
      pointerEvents: getComputedStyle(node).pointerEvents,
      inert: node.inert
    }))).toEqual({ opacity: "0", pointerEvents: "none", inert: true });
    await expect(retry).toBeVisible();
    await retry.hover();
    expect(await retry.boundingBox()).toEqual(box);
    await page.screenshot({ path: test.info().outputPath(`${stage}-playing.png`) });
    await page.locator("#playerHand .hand-card").first().click();
    await expect(page.locator("#tutorialCoach")).toBeHidden();
    await retry.click();
    await expect(page.locator("#tutorialCoach")).toBeVisible();
    expect(await page.evaluate(() => JSON.stringify(window.__chibattle.state.players))).toEqual(initial);
    expect(await page.evaluate(() => window.__chibattle.state.tutorial.stage)).toBe(stage);
    await expect(page.locator("#tutorialCoach")).toBeHidden({ timeout: 5000 });
    expect(await retry.boundingBox()).toEqual(box);
    await expect(retry).toBeVisible();
  });
}

test("再挑戦前のタイマーは新しいクイズの説明を早く消さない", async ({ page }) => {
  await page.goto(gameUrl);
  await start(page, "expert");
  await page.waitForTimeout(2000);
  await page.locator("#tutorialRetryButton").click();
  await expect(page.locator("#tutorialCoach")).toBeVisible();
  await page.waitForTimeout(2200);
  await expect(page.locator("#tutorialCoach")).toBeVisible();
  await expect(page.locator("#tutorialCoach")).toBeHidden({ timeout: 2000 });
});

test("クイズ退出後の練習説明は消えず、やり直しボタンは出ない", async ({ page }) => {
  await page.goto(gameUrl);
  await start(page, "quiz");
  await page.locator("#tutorialExitButton").click();
  await page.locator('[data-tutorial-chapter="basic"]').click();
  await page.locator("#tutorialStartButton").click();
  await expect(page.locator("#tutorialCoachTitle")).toHaveText("基本編：練習を始めよう");
  await page.waitForTimeout(3500);
  await expect(page.locator("#tutorialCoach")).toBeVisible();
  await expect(page.locator("#tutorialNextButton")).toBeVisible();
  await expect(page.locator("#tutorialRetryButton")).toBeHidden();
  await page.locator("#tutorialToggleButton").click();
  await expect(page.locator("#tutorialCoach")).toBeHidden();
  await page.locator("#tutorialToggleButton").click();
  await expect(page.locator("#tutorialCoach")).toBeVisible();
});
