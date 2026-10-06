const { test, expect } = require("@playwright/test");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const gameUrl = pathToFileURL(path.join(__dirname, "..", "index.html")).href;
const starterNames = ["スターター：出席ビギナーズ", "スターター：教卓ベーシック"];
const deletedKey = "chibattle-deleted-starter-decks-v1";
const savedKey = "chibattle-saved-decks-v1";

async function openLibrary(page) {
  await page.locator("#homeNavDeckButton").click();
}

function deck(page, name) {
  return page.locator("#deckLibraryGrid .deck-library-card", { hasText: name });
}

test("両スターターを確認後に削除でき、再起動・配布版変更後も戻らない", async ({ page }) => {
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("dialog", dialog => dialog.accept());
  await page.addInitScript(() => {
    if (!localStorage.getItem("chibattle-dungeon-card-styles-v1")) {
      localStorage.setItem("chibattle-dungeon-card-styles-v1", JSON.stringify({ unlocked: { big: true }, selected: {} }));
    }
  });
  await page.goto(gameUrl);
  const cardsBefore = await page.evaluate(() => localStorage.getItem("chibattle-dungeon-card-styles-v1"));
  await openLibrary(page);
  for (const name of starterNames) {
    await deck(page, name).click();
    await expect(page.locator("[data-deck-remove]")).toBeEnabled();
    await page.locator("[data-deck-remove]").click();
    await expect(deck(page, name)).toHaveCount(0);
    await expect(page.locator("#deckLibraryDetail")).toBeHidden();
  }
  expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)), deletedKey)).toEqual(starterNames);
  expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)), savedKey)).toEqual({});
  await page.evaluate(() => localStorage.setItem("chibattle-starter-decks-seeded-v1", "old-version"));
  await page.reload();
  await openLibrary(page);
  for (const name of starterNames) await expect(deck(page, name)).toHaveCount(0);
  await expect(page.locator("#deckLibraryGrid .new-deck")).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("chibattle-dungeon-card-styles-v1"))).toEqual(cardsBefore);
  expect(errors).toEqual([]);
});

test("削除をキャンセルしたスターターは残り、削除した1件だけが消える", async ({ page }) => {
  await page.goto(gameUrl);
  await openLibrary(page);
  await deck(page, starterNames[0]).click();
  page.once("dialog", dialog => dialog.dismiss());
  await page.locator("[data-deck-remove]").click();
  await expect(deck(page, starterNames[0])).toBeVisible();
  expect(await page.evaluate(key => localStorage.getItem(key), deletedKey)).toBeNull();
  page.once("dialog", dialog => dialog.accept());
  await page.locator("[data-deck-remove]").click();
  await expect(deck(page, starterNames[1])).toBeVisible();
  await page.reload();
  await openLibrary(page);
  await expect(deck(page, starterNames[0])).toHaveCount(0);
  await expect(deck(page, starterNames[1])).toBeVisible();
});

test("削除履歴が壊れていても初期スターターと自作デッキを読み込める", async ({ page }) => {
  await page.goto(gameUrl);
  await page.evaluate(({ deletedKey, savedKey }) => {
    localStorage.setItem(deletedKey, "not-json");
    localStorage.setItem(savedKey, JSON.stringify({ "自作": { counts: { general_student: 3 } } }));
  }, { deletedKey, savedKey });
  await page.reload();
  await openLibrary(page);
  for (const name of starterNames) await expect(deck(page, name)).toBeVisible();
  await expect(deck(page, "自作")).toBeVisible();
  page.once("dialog", dialog => dialog.accept());
  await deck(page, starterNames[0]).click();
  await page.locator("[data-deck-remove]").click();
  await page.reload();
  await openLibrary(page);
  await expect(deck(page, "自作")).toBeVisible();
  await expect(deck(page, starterNames[1])).toBeVisible();
});

test("同名のカオス・専攻デッキの削除は通常スターターへ影響しない", async ({ page }) => {
  page.on("dialog", dialog => dialog.accept());
  await page.goto(gameUrl);
  await openLibrary(page);
  await page.evaluate(name => {
    const api = window.__chibattle;
    api.state.deckBuilder.chaosDecks[name] = { counts: { general_student: 40 } };
    api.state.deckBuilder.specialtyDecks[name] = { counts: { general_student: 3 }, specialtyId: "big" };
    api.render();
  }, starterNames[0]);
  for (const format of ["chaos", "specialty"]) {
    await page.locator(`#${format}DeckFormatButton`).click();
    await deck(page, starterNames[0]).click();
    await page.locator("[data-deck-remove]").click();
    await expect(deck(page, starterNames[0])).toHaveCount(0);
  }
  expect(await page.evaluate(key => localStorage.getItem(key), deletedKey)).toBeNull();
  await page.reload();
  await openLibrary(page);
  for (const name of starterNames) await expect(deck(page, name)).toBeVisible();
});

test("削除履歴を保存できない場合は成功扱いせずデッキを残す", async ({ page }) => {
  page.on("dialog", dialog => dialog.accept());
  await page.goto(gameUrl);
  await openLibrary(page);
  await deck(page, starterNames[0]).click();
  await page.evaluate(key => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (name, value) {
      if (name === key) throw new Error("storage denied");
      return original.call(this, name, value);
    };
  }, deletedKey);
  await page.locator("[data-deck-remove]").click();
  await expect(deck(page, starterNames[0])).toBeVisible();
  expect(await page.evaluate(() => window.__chibattle.state.message)).toContain("保存できませんでした");
});
