const { test, expect } = require("@playwright/test");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const gameUrl = pathToFileURL(path.join(__dirname, "..", "index.html")).href;

test.beforeEach(async ({ page }) => {
  await page.goto(gameUrl);
  await page.evaluate(() => {
    const api = window.__chibattle;
    api.startCardTest("general_student");
    for (const side of ["player", "opponent"]) {
      const cards = ["general_student", "key", "general_student", "key", "general_student"]
        .map(id => api.createCardFromBase(id, side));
      for (const type of ["teacher", "vampire", "environment"]) {
        const id = Object.keys(api.CARD_BASES).find(id => api.CARD_BASES[id].type === type && !api.CARD_BASES[id].token);
        cards.push(api.createCardFromBase(id, side));
      }
      api.state.players[side].trash = cards;
    }
    api.render();
  });
});

for (const side of ["player", "opponent"]) {
  test(`${side}の校外を同名でまとめ、実枚数をタイプ別に表示して詳細を開ける`, async ({ page }) => {
    const before = await page.evaluate(() => JSON.stringify(window.__chibattle.state.players));
    await page.locator(`#${side}TrashButton`).click();
    const panel = page.locator("#battleDrawerInspector");
    await expect(panel.locator("[data-inspector-side]")).toHaveCount(0);
    await expect(page.locator("#battleDrawerTitle")).toHaveText(side === "player" ? "自分の校外" : "相手の校外");
    await expect(panel.locator(".battle-inspector-card")).toHaveCount(5);
    for (const [type, text] of Object.entries({ all: "すべて 8枚", student: "学生 3枚", teacher: "教師 1枚", vampire: "ヴァンパイア 1枚", item: "持ち物 2枚", environment: "環境 1枚" })) {
      await expect(panel.locator(`[data-inspector-filter="${type}"]`)).toHaveText(text);
    }
    await expect(panel.locator('.battle-inspector-card').filter({ has: page.locator('.battle-inspector-name', { hasText: '一般学生' }) }).locator('.battle-inspector-count')).toHaveText("×3");
    await expect(panel.locator(".battle-inspector-thumbnail")).toHaveCount(5);
    await panel.locator('[data-inspector-filter="student"]').click();
    await expect(panel.locator(".battle-inspector-card")).toHaveCount(1);
    expect(await page.evaluate(() => JSON.stringify(window.__chibattle.state.players))).toBe(before);
    await panel.locator(".battle-inspector-card").click();
    await expect(page.locator("#battleCardPreview")).toBeVisible();
    expect(await page.evaluate(() => document.getElementById("battleCardPreview")._previewCard.baseId)).toBe("general_student");
    expect(await page.evaluate(() => Object.values(window.__chibattle.state.players).map(player => player.trash.length))).toEqual([8, 8]);
  });
}

test("開いたまま校外の枚数が変わっても、選択タイプを保って枚数が更新される", async ({ page }) => {
  await page.locator("#playerTrashButton").click();
  const panel = page.locator("#battleDrawerInspector");
  await panel.locator('[data-inspector-filter="item"]').click();
  await page.evaluate(() => {
    const api = window.__chibattle;
    api.state.players.player.trash = api.state.players.player.trash.filter(card => card.type !== "item");
    api.render();
  });
  await expect(panel.locator('[data-inspector-filter="item"]')).toHaveText("持ち物 0枚");
  await expect(panel.locator('[data-inspector-filter="item"]')).toHaveClass(/active/);
  await expect(panel.locator('[data-inspector-filter="all"]')).toHaveText("すべて 6枚");
  await expect(panel.locator(".battle-inspector-card")).toHaveCount(0);
  await expect(panel).toContainText("カードはありません。");
});

test("空の校外でも全タイプを0枚で表示する", async ({ page }) => {
  await page.evaluate(() => {
    window.__chibattle.state.players.player.trash = [];
    window.__chibattle.render();
  });
  await page.locator("#playerTrashButton").click();
  const panel = page.locator("#battleDrawerInspector");
  await expect(panel.locator(".battle-inspector-tab")).toHaveText(["すべて 0枚", "学生 0枚", "教師 0枚", "ヴァンパイア 0枚", "持ち物 0枚", "環境 0枚"]);
  await expect(panel.locator(".battle-inspector-card")).toHaveCount(0);
  await expect(panel).toContainText("カードはありません。");
});
