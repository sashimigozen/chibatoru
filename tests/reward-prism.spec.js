const { test, expect } = require("@playwright/test");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const gameUrl = pathToFileURL(path.join(__dirname, "..", "index.html")).href;
const rewards = ["yuta", "dark_yuta", "vampire", "bird_a", "demon_a_plus", "lazy_student", "extra_people", "extra_student", "dos_attack", "infight_shogi", "loud_student", "king_ghidorah_bed"];

async function openGoldGame(page) {
  await page.addInitScript((ids) => localStorage.setItem("chibattle-dungeon-card-styles-v1", JSON.stringify({
    unlocked: Object.fromEntries(["gakuyukai_item", "cafeteria", "design", "late", "expansion", "interference", "shogi", "big", "king_ghidorah_bed"].map((id) => [id, true])), prismUnlocked: Object.fromEntries(ids.map((id) => [id, true])), selected: Object.fromEntries(ids.map((id) => [id, "prism"]))
  })), rewards);
  await page.goto(gameUrl);
}

test("旧全解放データでもキラキラ金枠はキングギドラベッドだけで、他11種は通常金枠", async ({ page }) => {
  await openGoldGame(page);
  await page.evaluate(() => window.__chibattle.startCardTest("king_ghidorah_bed"));
  for (const baseId of rewards) {
    await page.evaluate((id) => {
      const api = window.__chibattle;
      api.state.players.player.hand = [api.createCardFromBase(id, "player"), api.createCardFromBase("general_student", "player")];
      api.render();
      api.showBattleCardPreview(api.state.players.player.hand[0]);
    }, baseId);
    const hand = page.locator(`#playerHand [data-base-id="${baseId}"]`).first();
    await expect(hand).toHaveClass(/reward-foil/);
    const prism = baseId === "king_ghidorah_bed";
    await expect(hand.locator(".reward-prism-surface")).toHaveCount(prism ? 1 : 0);
    const preview = page.locator("#battleCardPreview .reward-prism-surface");
    if (!prism) {
      await expect(preview).toHaveCount(0);
      continue;
    }
    await expect(preview).toBeVisible();
    const style = await preview.evaluate((el) => ({
      pointer: getComputedStyle(el).pointerEvents,
      animation: getComputedStyle(el, "::before").animationName,
      mask: getComputedStyle(el, "::before").maskImage,
      textZ: getComputedStyle(el.parentElement.querySelector(".card-art-panel")).zIndex,
      faceBackground: getComputedStyle(el.parentElement).backgroundImage,
      panelBackground: getComputedStyle(el.parentElement.querySelector(".card-art-panel")).backgroundImage,
      effectBackground: getComputedStyle(el.parentElement.querySelector(".card-effect-panel")).backgroundImage,
      textColor: getComputedStyle(el.parentElement.querySelector(".card-art-name")).color,
      frameBackground: getComputedStyle(el.parentElement.parentElement).backgroundImage
    }));
    expect(style).toMatchObject({ pointer: "none", animation: "reward-prism-colors", textZ: "1" });
    expect(style.mask).toContain("radial-gradient");
    expect(style.faceBackground).toContain("linear-gradient");
    expect(style.faceBackground).toContain("rgb(255, 244, 196)");
    expect(style.panelBackground).toContain("linear-gradient");
    expect(style.panelBackground).toContain("rgba(255, 255, 255, 0.98)");
    expect(style.effectBackground).toContain("rgba(255, 226, 126");
    expect(style.textColor).toBe("rgb(23, 53, 86)");
    expect(style.frameBackground).toContain("conic-gradient");
    await expect(page.locator('#playerHand [data-base-id="general_student"] .reward-prism-surface')).toHaveCount(0);
    const dimensions = (el) => { const rect = el.getBoundingClientRect(); return [Math.round(rect.width), Math.round(rect.height)]; };
    expect(await hand.evaluate(dimensions)).toEqual(await page.locator('#playerHand [data-base-id="general_student"]').first().evaluate(dimensions));
  }
});

test("旧データの盤面金枠にプリズム加工は残らず、キングギドラベッドは動きを減らす設定に対応", async ({ page }) => {
  await openGoldGame(page);
  await page.evaluate(() => {
    const api = window.__chibattle;
    api.startCardTest("yuta");
    api.state.players.player.board.seats = Array(9).fill(null);
    const card = api.makeBoardCard(api.createCardFromBase("yuta", "player"));
    card.playedOnTurn = 1;
    api.state.players.player.board.seats[0] = card;
    api.render();
  });
  const board = page.locator(".field-card.board-card.reward-foil").first();
  await expect(board.locator(":scope > .reward-prism-surface")).toHaveCount(0);
  await page.evaluate(() => {
    const api = window.__chibattle;
    const card = api.state.players.player.board.seats[0];
    card.rewardFoilStyle = "gakuyukai-prism"; // Old saved battle snapshot.
    api.render();
    api.showBattleCardPreview(api.createCardFromBase("king_ghidorah_bed", "player"));
  });
  await expect(board.locator(":scope > .reward-prism-surface")).toHaveCount(0);
  const surface = page.locator("#battleCardPreview .reward-prism-surface");
  await expect(surface).toHaveCount(1);
  await page.emulateMedia({ reducedMotion: "reduce" });
  const animations = await surface.evaluate((el) => [null, "::before", "::after"].map((pseudo) => getComputedStyle(el, pseudo).animationName));
  expect(animations).toEqual(["none", "none", "none"]);
});

test("出席・使用演出の拡大カードにも加工が表示される", async ({ page }) => {
  await openGoldGame(page);
  await page.evaluate(() => {
    const api = window.__chibattle;
    api.startCardTest("king_ghidorah_bed");
    api.showCardPlayAnimation(api.createCardFromBase("king_ghidorah_bed", "player"), "trash");
  });
  await expect(page.locator(".play-reveal-card .reward-prism-surface")).toBeVisible();
});
