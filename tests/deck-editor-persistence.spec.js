const { test, expect } = require("@playwright/test");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const gameUrl = pathToFileURL(path.join(__dirname, "..", "index.html")).href;

async function openSavedChaosDeck(page, name) {
  await page.locator("#deckLibraryGrid .deck-library-card", { hasText: name }).click();
  await page.locator("[data-deck-edit]").click();
  await expect(page.locator("#deckEditorView")).toBeVisible();
}

test("カオスデッキの4枚以上を保存・再編集・再保存・再起動で維持する", async ({ page }) => {
  page.on("dialog", dialog => dialog.accept());
  await page.goto(gameUrl);
  await page.locator("#homeNavDeckButton").click();
  await page.locator("#chaosDeckFormatButton").click();
  await page.locator("#deckLibraryGrid .new-deck").click();
  await page.evaluate(() => {
    const api = window.__chibattle;
    api.state.deckBuilder.counts.player = { protein_drinker: 4, general_student: 32, think_so: 4 };
    api.render();
  });
  await page.locator("#deckSaveNameInput").fill("枚数保持テスト");
  await page.locator("#saveDeckButton").click();
  await openSavedChaosDeck(page, "枚数保持テスト");
  const counts = () => page.evaluate(() => {
    const c = window.__chibattle.state.deckBuilder.counts.player;
    return [c.protein_drinker, c.general_student, c.think_so];
  });
  expect(await counts()).toEqual([4, 32, 4]);
  await page.evaluate(() => {
    const api = window.__chibattle;
    api.state.deckBuilder.counts.player.protein_drinker += 1;
    api.render();
  });
  await page.locator("#saveDeckButton").click();
  await openSavedChaosDeck(page, "枚数保持テスト");
  expect(await counts()).toEqual([5, 32, 4]);
  await page.reload();
  await page.locator("#homeNavDeckButton").click();
  await page.locator("#chaosDeckFormatButton").click();
  await openSavedChaosDeck(page, "枚数保持テスト");
  expect(await counts()).toEqual([5, 32, 4]);
});

test("通常・専攻デッキでは既存の同名枚数制限を維持する", async ({ page }) => {
  await page.goto(gameUrl);
  await page.locator("#homeNavDeckButton").click();
  for (const format of ["normal", "specialty"]) {
    await page.evaluate((format) => {
      const api = window.__chibattle;
      const builder = api.state.deckBuilder;
      builder.format = format;
      builder.view = "library";
      builder.selectedName = "";
      builder[format === "normal" ? "savedDecks" : "specialtyDecks"]["制限テスト"] = {
        counts: { general_student: 4 }, specialtyId: "big"
      };
      api.render();
    }, format);
    await page.locator("#deckLibraryGrid .deck-library-card", { hasText: "制限テスト" }).click();
    await page.locator("[data-deck-edit]").click();
    expect(await page.evaluate(() => window.__chibattle.state.deckBuilder.counts.player.general_student)).toBe(3);
  }
});

test("分類を削除し、カード名・テキスト検索とタイプ・戦意の絞り込みは維持する", async ({ page }) => {
  await page.goto(gameUrl);
  await page.locator("#homeNavDeckButton").click();
  await page.locator("#deckLibraryGrid .new-deck").click();
  await page.locator("#deckFilterPanel > summary").click();
  await expect(page.locator("#deckCategoryFilters")).toHaveCount(0);
  await expect(page.locator("#deckFilterPanel")).not.toContainText("分類");
  await page.locator("#deckSearchInput").fill("攻撃力を+1");
  await page.locator("#deckTypeFilters button", { hasText: /^学生$/ }).click();
  await page.locator("#deckCostFilters button", { hasText: /^4$/ }).click();
  await expect(page.locator("#deckEditorList .deck-row-name", { hasText: "プロテインドリンカー" })).toBeVisible();
  await page.locator("#deckSearchInput").fill("プロテインドリンカー");
  await expect(page.locator("#deckEditorList .deck-row-name")).toHaveCount(1);
  await page.locator("#deckFilterClearButton").click();
  await expect(page.locator("#deckSearchInput")).toHaveValue("");
  await expect(page.locator("#deckTypeFilters .active, #deckCostFilters .active")).toHaveCount(0);
});
