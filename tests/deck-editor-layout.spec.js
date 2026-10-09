const { test, expect } = require("@playwright/test");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const url = pathToFileURL(path.join(__dirname, "..", "index.html")).href;

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(url);
  await page.locator("#homeNavDeckButton").click();
  await page.locator('[data-case-view="library"]').click();
  await page.locator("#deckLibraryGrid .new-deck").click();
});
const count = (page, id = "general_student") => page.evaluate(id => window.__chibattle.state.deckBuilder.counts.player[id] || 0, id);

test("クリックは左の詳細、＋−と双方向ドラッグは1枚ずつ変更し上限を守る", async ({ page }) => {
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.locator("#deckSearchInput").fill("一般学生");
  const source = page.locator('[data-card-test="general_student"]');
  await source.click();
  await expect(page.locator("#caseEditorText .tooltip-title")).toHaveText("一般学生");
  await expect(page.locator("#cardTestModal")).toBeHidden();
  await expect(page.locator("#caseEditorMinus")).toBeDisabled();
  await page.locator("#caseEditorPlus").click();
  expect(await count(page)).toBe(1);
  await source.dragTo(page.locator("#currentDeckList"));
  expect(await count(page)).toBe(2);
  await source.dragTo(page.locator("#currentDeckList"));
  expect(await count(page)).toBe(3);
  await expect(page.locator("#caseEditorPlus")).toBeDisabled();
  await source.dragTo(page.locator("#currentDeckList"));
  expect(await count(page)).toBe(3);
  await page.locator('[data-current-detail="general_student"]').dragTo(page.locator("#deckEditorList"));
  expect(await count(page)).toBe(2);
  await page.locator("#caseEditorMinus").click();
  expect(await count(page)).toBe(1);
  await expect(page.locator("#cardsNotice")).toBeHidden();
  await page.locator("#deckSearchInput").fill("U太");
  await expect(page.locator('[data-current-detail="general_student"]')).toBeVisible();
  await page.locator('[data-current-detail="general_student"]').click();
  await expect(page.locator("#caseEditorText .tooltip-title")).toHaveText("一般学生");
  expect(errors).toEqual([]);
});

test("能力・関連カード・カードテストと編集破棄の操作を維持する", async ({ page }) => {
  await page.locator("#deckSearchInput").fill("偽魏義ッ血");
  await page.locator('[data-card-test="gigi_blood"]').click();
  await page.locator('#caseEditorText [data-preview-term="進化"]').click();
  await expect(page.locator("#caseEditorText [data-preview-term-description]")).toContainText("同じマス");
  await page.locator('#caseEditorText .tooltip-effect [data-related-card="grudge"]').click();
  await expect(page.locator("#caseEditorText .tooltip-title")).toHaveText("怨念");
  await expect(page.locator("#caseEditorPlus")).toBeDisabled();
  await page.locator("[data-editor-card-back]").click();
  await expect(page.locator("#caseEditorText .tooltip-title")).toHaveText("偽魏義ッ血");
  await page.locator("#caseEditorTest").click();
  await expect(page.locator("#cardTestStartButton")).toBeVisible();
  await page.locator("#cardTestCancelButton").click();
  await page.locator("#caseEditorPlus").click();
  await page.locator("#deckEditorBackButton").click();
  await page.locator("[data-discard-cancel]").click();
  await expect(page.locator("#deckEditorView")).toBeVisible();
  await page.locator("#deckEditorBackButton").click();
  await page.locator("[data-discard-yes]").click();
  await expect(page.locator("#deckLibraryView")).toBeVisible();
});

test("PCサイズで3列とデッキ全体が収まり、カード比率と既存の色を維持する", async ({ page }) => {
  await page.evaluate(() => {
    const api = window.__chibattle;
    api.state.deckBuilder.counts.player = Object.fromEntries(getDeckEditorIds().slice(0, 20).map(id => [id, 3]));
    api.render();
  });
  await page.locator("#deckSearchInput").fill("U太");
  await page.locator('[data-card-test="yuta"]').click();
  for (const size of [{ width: 1280, height: 720 }, { width: 1440, height: 900 }, { width: 1920, height: 1080 }]) {
    await page.setViewportSize(size);
    await expect.poll(() => page.locator("#currentDeckList").evaluate(node => node.scrollHeight - node.clientHeight)).toBeLessThanOrEqual(1);
    const left = await page.locator(".case-editor-detail").boundingBox();
    const center = await page.locator(".current-deck-panel").boundingBox();
    const right = await page.locator(".case-editor-catalog").boundingBox();
    expect(left.x + left.width).toBeLessThanOrEqual(center.x);
    expect(center.x + center.width).toBeLessThanOrEqual(right.x);
    expect(Math.abs(left.y - center.y)).toBeLessThan(1);
    const card = await page.locator("#currentDeckList .card").first().boundingBox();
    expect(card.width / card.height).toBeCloseTo(21 / 32, 2);
    await expect(page.locator("#deckScreen")).toHaveCSS("border-top-color", "rgb(189, 165, 142)");
    await expect(page.locator("#deckScreen")).toHaveCSS("background-color", "rgb(23, 46, 64)");
    await page.screenshot({ path: test.info().outputPath(`deck-editor-${size.width}.png`) });
  }
});

test("満杯のデッキ・同じ領域へのドロップでは増えず、60種類でも中央に収まる", async ({ page }) => {
  await page.evaluate(() => {
    const api = window.__chibattle;
    api.state.deckBuilder.format = "chaos";
    api.state.deckBuilder.counts.player = Object.fromEntries(getDeckEditorIds().slice(0, 60).map(id => [id, 1]));
    api.render();
  });
  await page.locator("#deckSearchInput").fill("一般学生");
  const source = page.locator('[data-card-test="general_student"]');
  await source.click();
  await expect(page.locator("#caseEditorPlus")).toBeDisabled();
  const before = await count(page);
  await source.dragTo(page.locator("#currentDeckList"));
  expect(await count(page)).toBe(before);
  await source.dragTo(page.locator("#deckEditorList"));
  expect(await count(page)).toBe(before);
  await expect(page.locator("#currentDeckList [data-current-detail]")).toHaveCount(60);
  await expect.poll(() => page.locator("#currentDeckList").evaluate(node => node.scrollHeight - node.clientHeight)).toBeLessThanOrEqual(1);
  await page.setViewportSize({ width: 1280, height: 720 });
  await expect.poll(() => page.locator("#currentDeckList").evaluate(node => node.scrollHeight - node.clientHeight)).toBeLessThanOrEqual(1);
});
