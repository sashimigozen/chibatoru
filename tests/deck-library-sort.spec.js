const { test, expect } = require("@playwright/test");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const gameUrl = pathToFileURL(path.join(__dirname, "..", "index.html")).href;

async function deckNames(page) {
  return page.locator("#deckLibraryGrid .deck-library-card:not(.new-deck)").allTextContents();
}

test("保存デッキを作成順で表示し、項目と昇降順を切り替えられる", async ({ page }) => {
  await page.goto(gameUrl);
  await page.locator("#homeNavDeckButton").click();
  await page.locator("#chaosDeckFormatButton").click();
  await page.evaluate(() => {
    const api = window.__chibattle;
    api.state.deckBuilder.chaosDecks = {
      "Zデッキ": { counts: { general_student: 42 }, createdOrder: 1, savedAt: "2026-09-02T00:00:00.000Z" },
      "Aデッキ": { counts: { general_student: 40 }, createdOrder: 3, savedAt: "2026-09-03T00:00:00.000Z" },
      "Mデッキ": { counts: { general_student: 41 }, createdOrder: 2, savedAt: "2026-09-01T00:00:00.000Z" }
    };
    api.render();
  });

  await expect(page.locator("#deckLibrarySortKey")).toHaveValue("created");
  await expect(page.locator("#deckLibrarySortDirection")).toHaveValue("desc");
  expect(await deckNames(page)).toEqual(["Aデッキ", "Mデッキ", "Zデッキ"]);

  const cases = [
    ["name", "asc", ["Aデッキ", "Mデッキ", "Zデッキ"]],
    ["name", "desc", ["Zデッキ", "Mデッキ", "Aデッキ"]],
    ["updated", "asc", ["Mデッキ", "Zデッキ", "Aデッキ"]],
    ["updated", "desc", ["Aデッキ", "Zデッキ", "Mデッキ"]],
    ["size", "asc", ["Aデッキ", "Mデッキ", "Zデッキ"]],
    ["size", "desc", ["Zデッキ", "Mデッキ", "Aデッキ"]],
    ["created", "desc", ["Aデッキ", "Mデッキ", "Zデッキ"]],
    ["created", "asc", ["Zデッキ", "Mデッキ", "Aデッキ"]]
  ];
  for (const [key, direction, expected] of cases) {
    await page.locator("#deckLibrarySortKey").selectOption(key);
    await page.locator("#deckLibrarySortDirection").selectOption(direction);
    expect(await deckNames(page)).toEqual(expected);
  }

  await page.evaluate(() => {
    const api = window.__chibattle;
    api.state.deckBuilder.chaosDecks["Zデッキ"].savedAt = "2026-09-04T00:00:00.000Z";
    api.render();
  });
  expect(await deckNames(page)).toEqual(["Zデッキ", "Mデッキ", "Aデッキ"]);
});

test("数字のデッキ名でも保存・再読込後に作成順を維持する", async ({ page }) => {
  await page.goto(gameUrl);
  await page.locator("#homeNavDeckButton").click();
  await page.locator("#chaosDeckFormatButton").click();
  for (const name of ["9", "1"]) {
    await page.locator("#deckLibraryGrid .new-deck").click();
    await page.evaluate(() => {
      const api = window.__chibattle;
      api.state.deckBuilder.counts.player = { general_student: 40 };
      api.render();
    });
    await page.locator("#deckSaveNameInput").fill(name);
    await page.locator("#saveDeckButton").click();
  }
  expect(await deckNames(page)).toEqual(["1", "9"]);
  await page.reload();
  await page.locator("#homeNavDeckButton").click();
  await page.locator("#chaosDeckFormatButton").click();
  expect(await deckNames(page)).toEqual(["1", "9"]);
});

test("並び替え操作はデスクトップとスマートフォンの幅で操作できる", async ({ page }) => {
  await page.goto(gameUrl);
  await page.locator("#homeNavDeckButton").click();
  for (const width of [1280, 390, 320]) {
    await page.setViewportSize({ width, height: 800 });
    const key = await page.locator("#deckLibrarySortKey").boundingBox();
    const direction = await page.locator("#deckLibrarySortDirection").boundingBox();
    const grid = await page.locator("#deckLibraryGrid").boundingBox();
    expect(key).not.toBeNull();
    expect(direction).not.toBeNull();
    expect(key.x + key.width).toBeLessThanOrEqual(width);
    expect(direction.x + direction.width).toBeLessThanOrEqual(width);
    expect(key.y + key.height).toBeLessThanOrEqual(grid.y);
    expect(direction.y + direction.height).toBeLessThanOrEqual(grid.y);
  }
});
