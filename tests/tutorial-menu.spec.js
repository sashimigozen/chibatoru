const { test, expect } = require("@playwright/test");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const gameUrl = pathToFileURL(path.join(__dirname, "..", "index.html")).href;
const screenshotPath = name => process.env.TUTORIAL_QA_DIR
  ? path.join(process.env.TUTORIAL_QA_DIR, name)
  : test.info().outputPath(name);

async function openList(page) {
  await page.goto(gameUrl);
  await page.locator("#homeNavSoloButton").click();
  await page.locator("#soloTutorialButton").click();
}

test("一覧で編を選んでも開始せず、三角と概要・カードだけが変わる", async ({ page }) => {
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await openList(page);
  await expect(page.locator("#tutorialDetailTitle")).toHaveText("基本編 1/1");
  await expect(page.locator("#tutorialStageSwitch")).toBeHidden();
  await page.locator('[data-tutorial-chapter="cheerful"]').click();
  await expect(page.locator("#tutorialScreen")).toBeVisible();
  await expect(page.locator("#battleScreen")).toBeHidden();
  await expect(page.locator("#tutorialDetailTitle")).toHaveText("陽気編 1/3");
  await expect(page.locator("#tutorialOverviewCard")).toHaveAttribute("data-card", "aggro_princess");
  await expect(page.locator("#tutorialOverviewText")).toContainText("[超陽気]");
  await expect(page.locator('[data-tutorial-chapter][aria-pressed="true"]')).toHaveCount(1);
  await expect(page.locator('[data-tutorial-chapter="cheerful"] .tutorial-chapter-marker')).toBeVisible();
  await expect(page.locator('[data-tutorial-chapter="basic"] .tutorial-chapter-marker')).toBeHidden();
  const card = page.locator("#tutorialOverviewCard > .card");
  await expect.poll(async () => {
    const box = await card.boundingBox();
    return Math.abs(box.width / box.height - 21 / 32);
  }).toBeLessThan(0.001);
  const stage = await card.locator(".card-scale-stage").boundingBox();
  const box = await card.boundingBox();
  expect(Math.abs(stage.width - box.width)).toBeLessThan(1);
  expect(Math.abs(stage.height - box.height)).toBeLessThan(1);
  expect(await page.locator("#tutorialChapterList").evaluate(element => element.scrollTop)).toBe(0);
  await page.screenshot({ path: screenshotPath("tutorial-menu-cheerful-practice.png") });
  expect(errors).toEqual([]);
});

test("矢印で3ステージを循環でき、始めるを押した時だけ選んだステージを開始する", async ({ page }) => {
  await openList(page);
  await page.locator('[data-tutorial-chapter="cheerful"]').click();
  const start = page.locator("#tutorialStartButton");
  const fixed = await start.boundingBox();
  await page.locator("#tutorialStageSwitch").click();
  await expect(page.locator("#tutorialDetailTitle")).toHaveText("陽気編 2/3");
  await expect(page.locator("#tutorialStageTitle")).toHaveText("リーサルクイズ");
  await expect(page.locator("#tutorialOverviewText")).toContainText("相手のターンになったら失敗");
  await expect(page.locator("#battleScreen")).toBeHidden();
  expect(await start.boundingBox()).toEqual(fixed);
  await page.screenshot({ path: screenshotPath("tutorial-menu-cheerful-quiz.png") });
  await page.locator("#tutorialStageSwitch").click();
  await expect(page.locator("#tutorialDetailTitle")).toHaveText("陽気編 3/3");
  await expect(page.locator("#tutorialStageTitle")).toHaveText("リーサルクイズ・超難問");
  expect(await start.boundingBox()).toEqual(fixed);
  await start.click();
  await expect(page.locator("#tutorialCoachTitle")).toHaveText("陽気編：リーサルクイズ・超難問");
  await page.locator("#tutorialExitButton").click();
  await expect(page.locator("#tutorialDetailTitle")).toHaveText("陽気編 3/3");
  await page.locator("#tutorialStageSwitch").click();
  await expect(page.locator("#tutorialDetailTitle")).toHaveText("陽気編 1/3");
  await start.click();
  await expect(page.locator("#tutorialCoachTitle")).toHaveText("陽気編：練習を始めよう");
  await page.locator("#tutorialExitButton").click();
  await expect(page.locator("#tutorialDetailTitle")).toHaveText("陽気編 1/3");
  await page.locator("#tutorialStageSwitch").click();
  await start.click();
  expect(await page.evaluate(() => ({ chapter: window.__chibattle.state.tutorial.chapterId, stage: window.__chibattle.state.tutorial.stage })))
    .toEqual({ chapter: "cheerful", stage: "quiz" });
  await page.locator("#tutorialExitButton").click();
  await expect(page.locator("#tutorialDetailTitle")).toHaveText("陽気編 2/3");
  await page.locator('[data-tutorial-chapter="basic"]').click();
  await expect(page.locator("#tutorialStageSwitch")).toBeHidden();
  await start.click();
  await expect(page.locator("#tutorialCoachTitle")).toHaveText("基本編：練習を始めよう");
});

test("全13編の選択・概要・カード・ステージ数が一致する", async ({ page }) => {
  await openList(page);
  const chapters = await page.locator("[data-tutorial-chapter]").evaluateAll(buttons => buttons.map(button => ({ id: button.dataset.tutorialChapter, title: button.textContent.trim().replace(/^\d+\. /, "") })));
  expect(chapters).toHaveLength(13);
  for (const chapter of chapters) {
    await page.locator(`[data-tutorial-chapter="${chapter.id}"]`).click();
    await expect(page.locator("#tutorialDetailTitle")).toHaveText(`${chapter.title} 1/${chapter.id === "basic" ? 1 : 3}`);
    await expect(page.locator("#tutorialOverviewText")).not.toBeEmpty();
    await expect(page.locator("#tutorialOverviewCard .card-scale-stage")).toHaveCount(1);
    await expect(page.locator("#tutorialStageSwitch")).toBeVisible({ visible: chapter.id !== "basic" });
  }
});

for (const viewport of [{ width: 1280, height: 720 }, { width: 1440, height: 900 }, { width: 1024, height: 768 }]) {
  test(`PC ${viewport.width}×${viewport.height}で左だけスクロールし、詳細と始めるが固定される`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await openList(page);
    const start = page.locator("#tutorialStartButton");
    const fixed = await start.boundingBox();
    await page.locator('[data-tutorial-chapter="load"]').click();
    await expect(page.locator('[data-tutorial-chapter="load"] .tutorial-chapter-marker')).toBeVisible();
    expect(await start.boundingBox()).toEqual(fixed);
    await page.locator("#tutorialStageSwitch").click();
    expect(await start.boundingBox()).toEqual(fixed);
    await page.locator("#tutorialStageSwitch").click();
    await expect(page.locator("#tutorialStageTitle")).toHaveText("リーサルクイズ・超難問");
    expect(await start.boundingBox()).toEqual(fixed);
    const nav = await page.locator("#homeNavigation").boundingBox();
    expect(fixed.y + fixed.height).toBeLessThanOrEqual(nav.y);
    const overview = await page.locator(".tutorial-overview").boundingBox();
    const text = await page.locator("#tutorialOverviewText").boundingBox();
    expect(text.y + text.height).toBeLessThanOrEqual(overview.y + overview.height);
    const scroll = await page.locator("#tutorialChapterList").evaluate(e => ({ top: e.scrollTop, height: e.clientHeight, total: e.scrollHeight }));
    expect(scroll.top).toBeGreaterThan(0);
    expect(scroll.total).toBeGreaterThan(scroll.height);
    await start.hover();
    expect(await start.boundingBox()).toEqual(fixed);
    await page.screenshot({ path: screenshotPath(`tutorial-menu-load-quiz-${viewport.width}x${viewport.height}.png`) });
  });
}

test("キーボードで選択とステージ切替・開始を操作できる", async ({ page }) => {
  await openList(page);
  await page.locator('[data-tutorial-chapter="cheerful"]').press("Enter");
  await expect(page.locator('[data-tutorial-chapter="cheerful"]')).toBeFocused();
  await expect(page.locator("#tutorialDetailTitle")).toHaveText("陽気編 1/3");
  await page.locator("#tutorialStageSwitch").press("Enter");
  await expect(page.locator("#tutorialStageSwitch")).toBeFocused();
  await expect(page.locator("#tutorialDetailTitle")).toHaveText("陽気編 2/3");
  await page.locator("#tutorialStageSwitch").press("Tab");
  await expect(page.locator("#tutorialStartButton")).toBeFocused();
  await page.locator("#tutorialStartButton").press("Enter");
  await expect(page.locator("#battleScreen")).toBeVisible();
});
