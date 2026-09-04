const { test, expect } = require("@playwright/test");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const gameUrl = pathToFileURL(path.join(__dirname, "..", "index.html")).href;
const rewards = ["yuta", "dark_yuta", "vampire", "bird_a", "demon_a_plus", "lazy_student", "extra_people", "extra_student", "dos_attack", "infight_shogi", "loud_student", "king_ghidorah_bed"];

async function openGoldGame(page) {
  await page.addInitScript((ids) => localStorage.setItem("chibattle-dungeon-card-styles-v1", JSON.stringify({
    unlocked: {}, prismUnlocked: Object.fromEntries(ids.map((id) => [id, true])), selected: Object.fromEntries(ids.map((id) => [id, "prism"]))
  })), rewards);
  await page.goto(gameUrl);
}

test("全12種の金枠は手札とカード確認にプリズム加工を持ち、通常カードは変わらない", async ({ page }) => {
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
    await expect(hand.locator(".reward-prism-surface")).toHaveCount(1);
    const preview = page.locator("#battleCardPreview .reward-prism-surface");
    await expect(preview).toBeVisible();
    const style = await preview.evaluate((el) => ({
      pointer: getComputedStyle(el).pointerEvents,
      animation: getComputedStyle(el, "::before").animationName,
      mask: getComputedStyle(el, "::before").maskImage,
      textZ: getComputedStyle(el.parentElement.querySelector(".card-art-panel")).zIndex
    }));
    expect(style).toMatchObject({ pointer: "none", animation: "reward-prism-colors", textZ: "1" });
    expect(style.mask).toContain("radial-gradient");
    await expect(page.locator('#playerHand [data-base-id="general_student"] .reward-prism-surface')).toHaveCount(0);
    const dimensions = (el) => { const rect = el.getBoundingClientRect(); return [Math.round(rect.width), Math.round(rect.height)]; };
    expect(await hand.evaluate(dimensions)).toEqual(await page.locator('#playerHand [data-base-id="general_student"]').first().evaluate(dimensions));
  }
});

test("盤面の金枠も同じ加工になり、クリックを妨げず、動きを減らす設定では静止する", async ({ page }) => {
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
  const surface = board.locator(":scope > .reward-prism-surface");
  await expect(surface).toHaveCount(1);
  expect(await surface.evaluate((el) => getComputedStyle(el).getPropertyValue("--prism-cell").trim())).toBe("6px");
  expect(await surface.evaluate((el) => {
    const rect = el.getBoundingClientRect();
    return document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2).closest(".field-card") === el.parentElement;
  })).toBe(true);
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
