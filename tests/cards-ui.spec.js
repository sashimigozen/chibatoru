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

test("デッキへの追加・削除は下の通知を出さず、必要なエラーは維持する", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await enter(page);
  await page.locator("#deckLibraryGrid .new-deck").click();
  const notice = page.locator("#cardsNotice");
  const count = () => page.evaluate(() => window.__chibattle.state.deckBuilder.counts.player.general_student || 0);
  await page.locator('[data-card-test="general_student"]').click();
  await page.locator('#caseEditorPlus').click();
  expect(await count()).toBe(1);
  await expect(notice).toBeHidden();
  await page.locator('#caseEditorPlus').click();
  expect(await count()).toBe(2);
  await expect(notice).toBeHidden();
  await page.locator('#caseEditorMinus').click();
  expect(await count()).toBe(1);
  await expect(notice).toBeHidden();
  // 保存に必要なデッキ名のエラーは通知を維持する。
  await page.locator("#saveDeckButton").click();
  await expect(notice).toContainText("保存するデッキ名を入力してください");
  await expect(notice).toBeVisible();
  await page.locator('#caseEditorMinus').click();
  expect(await count()).toBe(0);
  await expect(notice).toBeEmpty();
  await expect(notice).toBeHidden();
  // 再描画でも古いお知らせが復活しない。
  await page.evaluate(() => window.__chibattle.render());
  await expect(notice).toBeHidden();
  await page.locator('#caseEditorPlus').click();
  expect(await count()).toBe(1);
  await expect(notice).toBeHidden();
  await page.screenshot({ path: test.info().outputPath("deck-editor-without-count-notice.png") });
});

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
  await expect(page.locator(".case-deck-content")).toContainText("x40");
  await page.locator("[data-deck-edit]").click();
  await expect(page.locator("#deckSaveNameInput")).toHaveValue("実デッキ1");
  await expect(page.locator("#caseDeckDetailModal")).toBeHidden();
  await page.locator('[data-current-detail="general_student"]').click();
  await page.locator('#caseEditorPlus').click();
  await page.locator("#deckSaveNameInput").fill("保存テスト");
  await page.locator("#saveDeckButton").click();
  await page.reload();
  expect(await page.evaluate(() => window.__chibattle.state.deckBuilder.chaosDecks["保存テスト"].counts.general_student)).toBe(41);
});

test("デッキ詳細は実際のカードと枚数を1画面に表示し、説明の確認で内容を変えない", async ({ page }, testInfo) => {
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
    await expect(button.locator(".case-deck-copy-count")).toHaveText(`x${index % 3 + 1}`);
  }
  const before = await page.evaluate(() => JSON.stringify(window.__chibattle.state.deckBuilder.chaosDecks));
  for (const size of [{ width: 1280, height: 720 }, { width: 1440, height: 900 }, { width: 1920, height: 1080 }]) {
    await page.setViewportSize(size);
    const card = await contents.locator(".card").first().boundingBox();
    expect(card.width / card.height).toBeCloseTo(21 / 32, 2);
    expect(card.width).toBeGreaterThan(50);
    expect(card.width).toBeGreaterThan(74);
    const dialog = await page.locator(".case-deck-dialog").boundingBox();
    expect(dialog.y + dialog.height).toBeLessThanOrEqual(size.height);
    await expect.poll(() => contents.evaluate(node => node.scrollWidth <= node.clientWidth && node.scrollHeight <= node.clientHeight)).toBe(true);
    expect(await contents.evaluate(node => [...node.querySelectorAll(".case-deck-content")].every(tile => {
      const hp = tile.querySelector(".stat-hp");
      if (!hp) return true;
      const badge = tile.querySelector(".deck-copy-badge").getBoundingClientRect();
      return badge.bottom < hp.getBoundingClientRect().top;
    }))).toBe(true);
    await contents.locator(".case-deck-content").last().click();
    await expect(page.locator("#cardTestModal")).toBeVisible();
    await expect(page.locator("#cardTestText .tooltip-title")).toHaveText(await page.evaluate(id => CARD_BASES[id].name, ids.at(-1)));
    await expect(page.locator("#cardTestStartButton")).toBeHidden();
    await page.locator("#cardTestCancelButton").click();
    await expect(page.locator("#caseDeckDetailModal")).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath(`deck-card-contents-${size.width}.png`) });
  }
  expect(await page.evaluate(() => JSON.stringify(window.__chibattle.state.deckBuilder.chaosDecks))).toBe(before);
});

test("デッキの種類数と画面サイズに合わせ全カードを重なりやスクロールなしで収める", async ({ page }, testInfo) => {
  await enter(page);
  await page.locator("#chaosDeckFormatButton").click();
  for (const count of [0, 1, 4, 14, 30, 40, 60]) {
    await page.evaluate(count => {
      const api = window.__chibattle;
      const ids = getDeckEditorIds().slice(0, count);
      api.state.deckBuilder.chaosDecks = { "全体表示テスト": { counts: Object.fromEntries(ids.map(id => [id, 1])), createdOrder: 1 } };
      api.state.deckBuilder.selectedName = "全体表示テスト";
      api.render();
    }, count);
    const contents = page.locator(".case-deck-contents");
    await expect(contents.locator(".case-deck-content")).toHaveCount(count);
    for (const size of [{ width: 1280, height: 720 }, { width: 1440, height: 900 }, { width: 1920, height: 1080 }]) {
      await page.setViewportSize(size);
      await expect.poll(() => contents.evaluate(node => {
        const area = node.getBoundingClientRect();
        const tiles = [...node.children].map(child => child.getBoundingClientRect());
        return node.scrollWidth <= node.clientWidth && node.scrollHeight <= node.clientHeight
          && tiles.every(tile => tile.x >= area.x && tile.y >= area.y && tile.right <= area.right && tile.bottom <= area.bottom)
          && tiles.every((tile, index) => tiles.slice(index + 1).every(other => tile.right <= other.x || other.right <= tile.x || tile.bottom <= other.y || other.bottom <= tile.y));
      })).toBe(true);
      if (count > 0) {
        const bounds = await contents.evaluate(node => {
          const rect = target => {
            const { x, y, width, height } = target.getBoundingClientRect();
            return { x, y, width, height };
          };
          return { card: rect(node.querySelector(".card")), badge: rect(node.querySelector(".deck-copy-badge")), grid: rect(node) };
        });
        const card = bounds.card;
        expect(card.width / card.height).toBeCloseTo(21 / 32, 2);
        const badge = contents.locator(".deck-copy-badge").first();
        await expect(badge).toHaveCSS("background-color", "rgb(23, 32, 51)");
        const badgeBounds = bounds.badge;
        expect(badgeBounds.x).toBeGreaterThan(card.x);
        expect(badgeBounds.y).toBeGreaterThanOrEqual(card.y);
        expect(badgeBounds.y + badgeBounds.height).toBeLessThan(card.y + card.height / 2);
        expect(badgeBounds.x + badgeBounds.width).toBeLessThanOrEqual(card.x + card.width);
        expect(badgeBounds.y + badgeBounds.height).toBeLessThanOrEqual(card.y + card.height);
        const grid = bounds.grid;
        expect(card.x - grid.x).toBeCloseTo(13, 0);
        expect(card.y - grid.y).toBeCloseTo(13, 0);
        if (count > 1) {
          await expect.poll(() => contents.evaluate(node => {
            const [first, second] = [...node.querySelectorAll(".card")].slice(0, 2).map(card => card.getBoundingClientRect());
            return Math.round(second.x - first.right);
          })).toBe(6);
        }
        if (count <= 4) expect(await contents.evaluate(node => node.style.getPropertyValue("--deck-content-rows"))).toBe("1");
      }
      if (size.width === 1440 && [4, 30, 40].includes(count)) await page.screenshot({ path: testInfo.outputPath(`deck-fit-${count}-kinds.png`) });
    }
  }
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

test("少ない行数では大きく表示し、種類数が増えると自動で縮小する", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await enter(page);
  await page.locator("#chaosDeckFormatButton").click();
  const layouts = [];
  for (const count of [4, 14, 30, 60]) {
    await page.evaluate(count => {
      const api = window.__chibattle;
      api.state.deckBuilder.chaosDecks = { "可変サイズ": { counts: Object.fromEntries(getDeckEditorIds().slice(0, count).map(id => [id, 1])) } };
      api.state.deckBuilder.selectedName = "可変サイズ";
      api.render();
    }, count);
    const contents = page.locator(".case-deck-contents");
    await expect.poll(() => contents.evaluate(node => Number.parseFloat(node.style.getPropertyValue("--deck-content-card-width")))).toBeGreaterThan(0);
    layouts.push(await contents.evaluate(node => ({
      rows: Number(node.style.getPropertyValue("--deck-content-rows")),
      width: node.querySelector(".card").getBoundingClientRect().width
    })));
    await page.screenshot({ path: testInfo.outputPath(`adaptive-deck-${count}.png`) });
  }
  expect(layouts[0].rows).toBe(1);
  expect(layouts[1].rows).toBe(2);
  expect(layouts[2].rows).toBeGreaterThanOrEqual(3);
  expect(layouts[3].rows).toBeGreaterThanOrEqual(4);
  for (let index = 1; index < layouts.length; index++) expect(layouts[index].width).toBeLessThan(layouts[index - 1].width);
  expect(layouts[0].width).toBeGreaterThan(150);
});

test("2本指スクロール相当の操作で一覧・詳細を送り、慣性でページを飛ばさない", async ({ page }) => {
  await enter(page, "cards");
  const catalogPage = page.locator("#cardsCatalogPage");
  await page.locator("#cardsCatalogGrid").hover();
  await page.mouse.wheel(90, 0);
  await expect(catalogPage).toContainText("Page 2 / ");
  await page.locator("#cardsCatalogGrid").evaluate(node => {
    for (let i = 0; i < 12; i++) node.dispatchEvent(new WheelEvent("wheel", { deltaX: 80, bubbles: true, cancelable: true }));
  });
  await expect(catalogPage).toContainText("Page 2 / ");
  await page.waitForTimeout(250);
  await page.mouse.wheel(0, -90);
  await expect(catalogPage).toContainText("Page 1 / ");
  await page.waitForTimeout(250);
  await page.mouse.wheel(-90, 0);
  await expect(catalogPage).toContainText("Page 13 / 13");
  await page.locator("#cardsCatalogSearch").dispatchEvent("wheel", { deltaY: 100 });
  await expect(catalogPage).toContainText("Page 13 / 13");
  await page.locator("#cardsCatalogGrid").dispatchEvent("wheel", { deltaY: 100, ctrlKey: true });
  await expect(catalogPage).toContainText("Page 13 / 13");

  await page.locator("[data-catalog-card]").first().click();
  const title = page.locator("#cardTestText .tooltip-title");
  const previousCard = await title.innerText();
  await page.locator("#cardTestCard").hover();
  await page.mouse.wheel(90, 0);
  await expect(title).not.toHaveText(previousCard);
  await expect(catalogPage).toContainText("Page 13 / 13");
  await page.waitForTimeout(250);
  await page.mouse.wheel(-90, 0);
  await expect(title).toHaveText(previousCard);
  // A long explanation must scroll as text, not switch to another card.
  await page.locator("#cardTestText").evaluate(node => {
    const text = document.createElement("p");
    text.textContent = "詳細な説明。".repeat(2000);
    node.append(text);
  });
  await page.locator("#cardTestText").hover();
  await page.mouse.wheel(0, 160);
  await expect.poll(() => page.locator("#cardTestText").evaluate(node => node.scrollTop)).toBeGreaterThan(0);
  await expect(title).toHaveText(previousCard);
  await page.locator("#cardTestCancelButton").click();
  await page.locator(".case-back").click();
  await page.locator('[data-case-view="library"]').click();
  await page.locator("#chaosDeckFormatButton").click();
  await page.evaluate(() => {
    const api = window.__chibattle;
    api.state.deckBuilder.chaosDecks = Object.fromEntries(Array.from({ length: 13 }, (_, i) => [`スクロールデッキ${i + 1}`, { counts: { general_student: 40 }, createdOrder: i + 1 }]));
    api.render();
  });
  await page.locator("#deckLibraryGrid").hover();
  await page.mouse.wheel(0, 90);
  await expect(page.locator("#caseDeckPage")).toContainText("Page 2 / 2");
  await page.locator("#deckLibraryGrid .case-deck-tile").click();
  const deckTitle = page.locator(".case-deck-detail-tools h2");
  const originalDeck = await deckTitle.innerText();
  await page.locator(".case-deck-contents").hover();
  await page.mouse.wheel(90, 0);
  await expect(deckTitle).not.toHaveText(originalDeck);
  await page.locator(".case-deck-contents").evaluate(node => {
    for (let i = 0; i < 12; i++) node.dispatchEvent(new WheelEvent("wheel", { deltaX: 80, bubbles: true, cancelable: true }));
  });
  const afterGesture = await deckTitle.innerText();
  await page.waitForTimeout(250);
  await page.mouse.wheel(-90, 0);
  await expect(deckTitle).toHaveText(originalDeck);
  expect(afterGesture).not.toBe(originalDeck);
  await expect(page.locator("#caseDeckPage")).toContainText("Page 2 / 2");
});

test("スクロールバーを全画面で隠し、編集一覧とチュートリアル一覧のスクロールを保つ", async ({ page }) => {
  await enter(page);
  const expectHiddenBars = async () => {
    expect(await page.evaluate(() => [...document.querySelectorAll("html, body, body *")].every(node =>
      getComputedStyle(node).scrollbarWidth === "none"
      && getComputedStyle(node, "::-webkit-scrollbar").display === "none"))).toBe(true);
  };
  await page.locator("#deckLibraryGrid .case-deck-tile").first().dblclick();
  await page.locator("#deckEditorList").hover();
  await page.mouse.wheel(0, 180);
  await expect.poll(() => page.locator("#deckEditorList").evaluate(node => node.scrollTop)).toBeGreaterThan(0);
  await expectHiddenBars();
  await page.locator("#homeNavSoloButton").click();
  await page.locator("#soloTutorialButton").click();
  await page.locator('[data-tutorial-chapter="cheerful"]').click();
  await page.locator(".tutorial-detail h2").hover();
  await page.mouse.wheel(90, 0);
  await expect(page.locator("#tutorialDetailTitle")).toHaveText("陽気編 2/3");
  await page.waitForTimeout(250);
  await page.mouse.wheel(90, 0);
  await expect(page.locator("#tutorialDetailTitle")).toHaveText("陽気編 3/3");
  await page.waitForTimeout(250);
  await page.mouse.wheel(-90, 0);
  await expect(page.locator("#tutorialDetailTitle")).toHaveText("陽気編 2/3");
  await page.waitForTimeout(250);
  await page.mouse.wheel(-90, 0);
  await expect(page.locator("#tutorialDetailTitle")).toHaveText("陽気編 1/3");
  await page.waitForTimeout(250);
  await page.mouse.wheel(-90, 0);
  await expect(page.locator("#tutorialDetailTitle")).toHaveText("陽気編 3/3");
  await page.waitForTimeout(250);
  await page.mouse.wheel(90, 0);
  await expect(page.locator("#tutorialDetailTitle")).toHaveText("陽気編 1/3");
  await page.locator("#tutorialChapterList").hover();
  await page.mouse.wheel(0, 200);
  await expect.poll(() => page.locator("#tutorialChapterList").evaluate(node => node.scrollTop)).toBeGreaterThan(0);
  await expect(page.locator("#tutorialDetailTitle")).toHaveText("陽気編 1/3");
  await expectHiddenBars();
  await page.locator("#tutorialStartButton").click();
  await expect(page.locator("#battleScreen")).toBeVisible();
  await expectHiddenBars();
});

test("デッキのダブルクリック、カードテストと戻る、破棄確認のキャンセルとはい", async ({ page }) => {
  await enter(page);
  const tile = page.locator("#deckLibraryGrid .case-deck-tile").first();
  const name = await tile.locator("span:not(.case-deck-spine)").innerText();
  await tile.dblclick();
  await expect(page.locator("#deckEditorView")).toBeVisible();
  await expect(page.locator("#deckSaveNameInput")).toHaveValue(name);
  await page.locator('[data-card-test="yuta"]').click();
  await page.locator('#caseEditorTest').click();
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
  await page.locator('#caseEditorTest').click();
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

test("対戦準備・トレーニング・ダンジョン・オンライン・対戦中の枚数も右上で体力を隠さない", async ({ page }, testInfo) => {
  await page.goto(url);
  for (const screen of ["soloDeck", "training", "dungeonDeck", "online", "battle"]) {
    await page.evaluate(screen => {
      const { state, render } = window.__chibattle;
      const counts = { general_student: 3, general_teacher: 2 };
      state.screen = screen === "training" ? "soloDeck" : screen;
      state.deckBuilder.savedDecks = { "枚数テスト": { counts } };
      state.deckBuilder.specialtyDecks = { "枚数テスト": { counts, specialtyId: "cafeteria" } };
      state.deckBuilder.counts.player = counts;
      Object.assign(state.soloSelection, { ruleId: "normal", previewName: "枚数テスト", previewExpanded: true,
        pickerOpen: true, leftController: screen === "training" ? "ai" : "player" });
      Object.assign(state.dungeon, { previewName: "枚数テスト", previewExpanded: true });
      Object.assign(state.online, { matchMode: "random", localDeckName: "__current", deckPreviewOpen: screen === "online" });
      state.players.player.originalDeckCounts = counts;
      render();
      if (screen === "battle") openDeckWindow();
    }, screen);
    const selector = { soloDeck: "#soloDeckDetail", training: "#soloDeckDetail", dungeonDeck: "#dungeonDeckDetail",
      online: "#onlineRandomDeckPreviewContent", battle: "#deckWindowGrid" }[screen];
    const grid = page.locator(selector);
    await expect(grid).toBeVisible();
    await expect(grid.locator(".deck-copy-badge")).toHaveCount(2);
    for (const size of [{ width: 1280, height: 720 }, { width: 1920, height: 1080 }]) {
      await page.setViewportSize(size);
      expect(await grid.evaluate(node => [...node.querySelectorAll(".card")].every(card => {
        const area = card.getBoundingClientRect();
        const badge = card.querySelector(".deck-copy-badge").getBoundingClientRect();
        const hp = card.querySelector(".stat-hp").getBoundingClientRect();
        return badge.top >= area.top && badge.bottom < area.top + area.height / 2
          && badge.right <= area.right && badge.left > area.left && badge.bottom < hp.top;
      }))).toBe(true);
    }
    await page.screenshot({ path: testInfo.outputPath(`deck-count-${screen}.png`) });
  }
});
