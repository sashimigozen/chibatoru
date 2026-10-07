const { test, expect } = require("@playwright/test");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const url = pathToFileURL(path.join(__dirname, "..", "index.html")).href;

async function enter(page, view = "library") {
  await page.goto(url);
  await page.locator("#homeNavDeckButton").click();
  await expect(page.locator("#cardsEntryView")).toBeVisible();
  await page.locator(`[data-case-view="${view}"]`).click();
}

test("カードの二択・一覧・能力と関連カードの詳細・好きなカードを本体へ保存", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await enter(page, "cards");
  await expect(page.locator("#cardsCatalogGrid > button")).toHaveCount(20);
  await expect(page.locator("#cardsCatalogPage")).toContainText("Page 1 / ");
  await page.getByRole("button", { name: "前のカードページ", exact: true }).click();
  const pageText = await page.locator("#cardsCatalogPage").innerText();
  expect(pageText.match(/Page (\d+) \/ (\d+)/).slice(1)).toEqual(["13", "13"]);
  await page.getByRole("button", { name: "次のカードページ", exact: true }).click();
  await expect(page.locator("#cardsCatalogPage")).toContainText("Page 1 / ");
  await page.locator("#cardsCatalogSearch").fill("偽魏義ッ血");
  await page.locator("[data-catalog-card='gigi_blood']").click();
  const modal = page.locator("#cardTestModal");
  await expect(modal).toBeVisible();
  await expect(page.locator("#cardTestStartButton")).toBeHidden();
  await modal.locator('[data-preview-term="進化"]').click();
  await expect(modal.locator("[data-preview-term-description]")).toContainText("同じマス");
  await modal.locator('.tooltip-effect [data-related-card="grudge"]').click();
  await expect(modal.locator(".tooltip-title")).toHaveText("怨念");
  await modal.locator('[data-related-card-back]').click();
  await expect(modal.locator(".tooltip-title")).toHaveText("偽魏義ッ血");
  await modal.locator(".case-favorite").click();
  await expect(modal.locator(".case-favorite")).toHaveAttribute("aria-pressed", "true");
  await page.locator("#cardTestCancelButton").click();
  await page.reload();
  expect(await page.evaluate(() => window.__chibattle.state.profile.favoriteCardId)).toBe("gigi_blood");
  expect(errors).toEqual([]);
});

test("カード一覧の絞り込みと空状態はデッキ・カード効果を変更しない", async ({ page }) => {
  await enter(page, "cards");
  const before = await page.evaluate(() => JSON.stringify(window.__chibattle.state.deckBuilder.counts));
  await page.locator("#cardsCatalogFilter").click();
  await page.locator('[data-catalog-filter="type"]').selectOption("teacher");
  await page.locator('[data-catalog-filter="cost"]').selectOption("4");
  const ids = await page.locator("[data-catalog-card]").evaluateAll(nodes => nodes.map(node => node.dataset.catalogCard));
  expect(ids.length).toBeGreaterThan(0);
  expect(await page.evaluate(ids => ids.every(id => CARD_BASES[id].type === "teacher" && CARD_BASES[id].cost === 4), ids)).toBe(true);
  await page.locator("#cardsCatalogSearch").fill("存在しないカード名123");
  await expect(page.locator(".case-empty")).toBeVisible();
  await expect(page.getByRole("button", { name: "次のカードページ", exact: true })).toBeDisabled();
  expect(await page.evaluate(() => JSON.stringify(window.__chibattle.state.deckBuilder.counts))).toBe(before);
});

test("保存デッキを12件ずつ表示し最初と最後が循環・内容と編成が実データへ接続", async ({ page }) => {
  await enter(page);
  await page.locator("#chaosDeckFormatButton").click();
  await page.evaluate(() => {
    const api = window.__chibattle;
    api.state.deckBuilder.chaosDecks = Object.fromEntries(Array.from({ length: 13 }, (_, i) => [`実デッキ${i+1}`, { counts: { general_student: 40 }, createdOrder: i+1 }]));
    api.render();
  });
  await expect(page.locator("#deckLibraryGrid .case-deck-tile")).toHaveCount(12);
  await expect(page.locator("#deckLibraryGrid .new-deck")).toHaveCount(0);
  await expect(page.locator("#deckLibraryGrid .case-deck-tile").first()).toContainText("実デッキ13");
  await page.getByRole("button", { name: "前のデッキページ", exact: true }).click();
  await expect(page.locator("#caseDeckPage")).toContainText("Page 2 / 2");
  await expect(page.locator("#deckLibraryGrid > button")).toHaveCount(2);
  await expect(page.locator("#deckLibraryGrid > button").last()).toHaveText("＋ 新規作成");
  await page.locator("#deckLibraryGrid .case-deck-tile").last().click();
  await expect(page.locator("#caseDeckDetailModal")).toBeVisible();
  await expect(page.locator(".case-deck-content")).toContainText("×40");
  await page.locator("[data-deck-edit]").click();
  await expect(page.locator("#deckSaveNameInput")).toHaveValue("実デッキ1");
  await expect(page.locator("#caseDeckDetailModal")).toBeHidden();
  await page.locator('[data-deck-plus="general_student"]').click();
  await page.locator("#deckSaveNameInput").fill("保存テスト");
  await page.locator("#saveDeckButton").click();
  await page.reload();
  expect(await page.evaluate(() => window.__chibattle.state.deckBuilder.chaosDecks["保存テスト"].counts.general_student)).toBe(41);
});

test("デッキ詳細は実際のカードと枚数を表示し、スクロールと説明の確認で内容を変えない", async ({ page }, testInfo) => {
  await enter(page);
  await page.locator("#chaosDeckFormatButton").click();
  const ids = await page.evaluate(() => {
    const api = window.__chibattle;
    const ids = getDeckEditorIds().slice(0, 14);
    api.state.deckBuilder.chaosDecks = { "カード表示テスト": { counts: Object.fromEntries(ids.map((id, index) => [id, index % 3 + 1])), createdOrder: 1 } };
    api.render();
    return ids;
  });
  await page.locator("#deckLibraryGrid .case-deck-tile").click();
  const contents = page.locator(".case-deck-contents");
  await expect(contents.locator(".case-deck-content > .card")).toHaveCount(ids.length);
  for (let index = 0; index < ids.length; index++) {
    const button = contents.locator(`[data-library-card="${ids[index]}"]`);
    await expect(button.locator(".card-name")).toHaveText(await page.evaluate(id => CARD_BASES[id].name, ids[index]));
    await expect(button.locator(".case-deck-copy-count")).toHaveText(`×${index % 3 + 1}`);
  }
  const before = await page.evaluate(() => JSON.stringify(window.__chibattle.state.deckBuilder.chaosDecks));
  for (const size of [{ width: 1280, height: 720 }, { width: 1440, height: 900 }, { width: 1920, height: 1080 }]) {
    await page.setViewportSize(size);
    const card = await contents.locator(".card").first().boundingBox();
    expect(card.width / card.height).toBeCloseTo(21 / 32, 2);
    expect(card.width).toBeGreaterThan(100);
    const dialog = await page.locator(".case-deck-dialog").boundingBox();
    expect(dialog.y + dialog.height).toBeLessThanOrEqual(size.height);
    expect(await contents.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
    await contents.locator(".case-deck-content").last().click();
    await expect(page.locator("#cardTestModal")).toBeVisible();
    await expect(page.locator("#cardTestText .tooltip-title")).toHaveText(await page.evaluate(id => CARD_BASES[id].name, ids.at(-1)));
    await expect(page.locator("#cardTestStartButton")).toBeHidden();
    await page.locator("#cardTestCancelButton").click();
    await expect(page.locator("#caseDeckDetailModal")).toBeVisible();
    await contents.locator(".case-deck-content").first().scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath(`deck-card-contents-${size.width}.png`) });
  }
  expect(await page.evaluate(() => JSON.stringify(window.__chibattle.state.deckBuilder.chaosDecks))).toBe(before);
});

test("新規作成は保存デッキの最後の1枠だけ・空一覧とページ境界でも左上から続く", async ({ page }, testInfo) => {
  await enter(page);
  await page.locator("#chaosDeckFormatButton").click();
  const grid = page.locator("#deckLibraryGrid");
  const previous = page.getByRole("button", { name: "前のデッキページ", exact: true });
  const next = page.getByRole("button", { name: "次のデッキページ", exact: true });
  for (const count of [0, 2, 11, 12, 13, 24]) {
    // Switching formats resets the page, as it does in normal navigation.
    await page.locator("#normalDeckFormatButton").click();
    await page.locator("#chaosDeckFormatButton").click();
    await page.evaluate(count => {
      const api = window.__chibattle;
      api.state.deckBuilder.chaosDecks = Object.fromEntries(Array.from({ length: count }, (_, i) => [`実デッキ${i + 1}`, { counts: { general_student: 40 }, createdOrder: i + 1 }]));
      api.render();
    }, count);
    const pages = Math.ceil((count + 1) / 12);
    for (let index = 0; index < pages; index++) {
      await expect(page.locator("#caseDeckPage")).toContainText(`Page ${index + 1} / ${pages}`);
      await expect(grid.locator(".case-deck-tile")).toHaveCount(Math.min(12, Math.max(0, count - index * 12)));
      await expect(grid.locator(".new-deck")).toHaveCount(index === pages - 1 ? 1 : 0);
      if (index === pages - 1) {
        await expect(grid.locator("> button").last()).toHaveText("＋ 新規作成");
        const first = await grid.locator("> button").first().boundingBox();
        const last = await grid.locator(".new-deck").boundingBox();
        const position = count % 12;
        if (position < 4) expect(Math.abs(last.y - first.y)).toBeLessThan(1);
        if (position === 0) expect(Math.abs(last.x - first.x)).toBeLessThan(1);
        if (position === 2) expect(last.x).toBeGreaterThan(first.x);
        if (count === 2 || count === 13) await page.screenshot({ path: testInfo.outputPath(`deck-new-after-${count}-saved.png`) });
      }
      if (pages > 1) await next.click();
    }
    if (pages > 1) {
      await expect(page.locator("#caseDeckPage")).toContainText(`Page 1 / ${pages}`);
      await previous.click();
      await expect(page.locator("#caseDeckPage")).toContainText(`Page ${pages} / ${pages}`);
      await expect(grid.locator(".new-deck")).toHaveCount(1);
    } else {
      await expect(previous).toBeDisabled();
      await expect(next).toBeDisabled();
    }
  }
});

test("デッキのダブルクリック、カードテストと戻る、破棄確認のキャンセルとはい", async ({ page }) => {
  await enter(page);
  const tile = page.locator("#deckLibraryGrid .case-deck-tile").first();
  const name = await tile.locator("span:not(.case-deck-spine)").innerText();
  await tile.dblclick();
  await expect(page.locator("#deckEditorView")).toBeVisible();
  await expect(page.locator("#deckSaveNameInput")).toHaveValue(name);
  await page.locator('[data-card-test="yuta"]').click();
  await expect(page.locator("#cardTestStartButton")).toBeVisible();
  await page.locator("#cardTestStartButton").click();
  expect(await page.evaluate(() => window.__chibattle.state.screen)).toBe("battle");
  await page.locator("#battleTestExitButton").click();
  await expect(page.locator("#deckEditorView")).toBeVisible();
  await page.locator("#deckSaveNameInput").fill("編集した名前");
  await page.locator("#deckEditorBackButton").click();
  await expect(page.locator(".case-confirm")).toContainText("編集中の内容を破棄して戻りますか？");
  await page.locator("[data-discard-cancel]").click();
  await expect(page.locator("#deckSaveNameInput")).toHaveValue("編集した名前");
  await page.locator("#homeNavHomeButton").click();
  await page.locator("[data-discard-yes]").click();
  await expect(page.locator("#homeScreen")).toBeVisible();
});

test("本体のデッキ形式を読み込み・書き出し・不正ファイルで編集中の内容を変えない", async ({ page }) => {
  await enter(page);
  const payload = { kind: "chibattle-chaos-deck", name: "読込テスト", counts: { general_student: 40 } };
  await page.locator("#deckFileInput").setInputFiles({ name: "deck.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(payload)) });
  await expect(page.locator("#deckEditorView")).toBeVisible();
  await expect(page.locator("#deckSaveNameInput")).toHaveValue("読込テスト");
  expect(await page.evaluate(() => window.__chibattle.state.deckBuilder.format)).toBe("chaos");
  await page.evaluate(() => { window.showSaveFilePicker = undefined; });
  const downloadPromise = page.waitForEvent("download");
  await page.locator("#exportDeckButton").click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("読込テスト.json");
  const exported = JSON.parse(require("node:fs").readFileSync(await download.path(), "utf8"));
  expect(exported.kind).toBe("chibattle-chaos-deck");
  expect(exported.counts.general_student).toBe(40);
  await page.locator("#deckFileInput").setInputFiles({ name: "broken.json", mimeType: "application/json", buffer: Buffer.from('{"counts":{"fake_card":40}}') });
  await page.locator("[data-discard-yes]").click();
  await expect(page.locator("#cardsNotice")).toContainText("読み込めませんでした");
  await expect(page.locator("#deckSaveNameInput")).toHaveValue("読込テスト");
  expect(await page.evaluate(() => window.__chibattle.state.deckBuilder.counts.player.general_student)).toBe(40);
});

test("専攻デッキの選択・登録制限とレアリティ切替を維持", async ({ page }) => {
  await enter(page);
  await page.locator("#specialtyDeckFormatButton").click();
  await page.locator("#deckLibraryGrid .new-deck").click();
  await page.locator("#deckSpecialtyChoice button", { hasText: /^食堂$/ }).click();
  await expect(page.locator("#deckEditorView")).toBeVisible();
  expect(await page.evaluate(() => window.__chibattle.state.deckBuilder.specialtyId)).toBe("cafeteria");
  expect(await page.evaluate(() => getDeckEditorIds().every(id => specialtyAllowedCardIds("cafeteria").has(id)))).toBe(true);
  await page.evaluate(() => {
    unlockDungeonCardStyle("cafeteria");
    render();
  });
  const rewardId = await page.evaluate(() => DUNGEON_CARD_STYLE_REWARDS.cafeteria.cardIds.find(id => getDeckEditorIds().includes(id)));
  await page.locator(`[data-card-test="${rewardId}"]`).click();
  await expect(page.locator("#cardTestModal")).toBeVisible();
  const modeBefore = await page.evaluate(id => localCardStyleMode(id), rewardId);
  await page.locator(`[data-card-style-cycle="${rewardId}"]`).click();
  expect(await page.evaluate(id => localCardStyleMode(id), rewardId)).not.toBe(modeBefore);
});

test("PCの複数サイズで一覧・詳細・編成とホームバーが画面内に収まる", async ({ page }) => {
  await enter(page, "cards");
  for (const size of [{width:1280,height:720}, {width:1440,height:900}, {width:1920,height:1080}]) {
    await page.setViewportSize(size);
    await expect.poll(async () => {
      const grid = await page.locator("#cardsCatalogGrid").boundingBox();
      const nav = await page.locator("#homeNavigation").boundingBox();
      return grid.y + grid.height - nav.y;
    }).toBeLessThanOrEqual(0);
    const grid = await page.locator("#cardsCatalogGrid").boundingBox();
    const nav = await page.locator("#homeNavigation").boundingBox();
    expect(grid.y + grid.height).toBeLessThanOrEqual(nav.y);
    const card = await page.locator("#cardsCatalogGrid .card").first().boundingBox();
    expect(card.width / card.height).toBeCloseTo(21 / 32, 2);
    await page.locator("[data-catalog-card]").first().click();
    const dialog = await page.locator(".case-card-dialog").boundingBox();
    expect(dialog.x).toBeGreaterThanOrEqual(0);
    expect(dialog.y + dialog.height).toBeLessThanOrEqual(size.height);
    await page.locator("#cardTestCancelButton").click();
    if (size.width === 1440) await page.screenshot({ path: test.info().outputPath("production-card-list.png") });
  }
  await page.locator(".case-back").click();
  await page.locator('[data-case-view="library"]').click();
  await page.locator("#deckLibraryGrid .new-deck").click();
  const work = await page.locator(".deck-workspace").boundingBox();
  const nav = await page.locator("#homeNavigation").boundingBox();
  expect(work.y + work.height).toBeLessThanOrEqual(nav.y);
  await page.screenshot({ path: test.info().outputPath("production-deck-editor.png") });
});

test("カードの選択・一覧・デッキ編成・編集で同じ机色の外枠を保つ", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto(url);
  await page.locator("#homeNavDeckButton").click();
  const frame = page.locator("#deckScreen");
  const expectFrame = async (view) => {
    await expect(frame).toHaveAttribute("data-case-view", view);
    for (const side of ["top", "right", "bottom", "left"]) {
      await expect(frame).toHaveCSS(`border-${side}-color`, "rgb(189, 165, 142)");
      await expect(frame).toHaveCSS(`border-${side}-width`, "20px");
    }
    await expect(frame).toHaveCSS("background-color", "rgb(23, 46, 64)");
  };
  await expectFrame("entry");
  await page.locator('[data-case-view="cards"]').click();
  await expectFrame("cards");
  await page.locator(".case-back").click();
  await page.locator('[data-case-view="library"]').click();
  await expectFrame("library");
  await page.screenshot({ path: test.info().outputPath("desk-frame-decks.png") });
  await page.locator("#deckLibraryGrid .new-deck").click();
  await expectFrame("editor");
  const bottom = await page.locator(".case-file-tools").last().boundingBox();
  const nav = await page.locator("#homeNavigation").boundingBox();
  expect(bottom.y + bottom.height).toBeLessThanOrEqual(nav.y - 20);
});
