const { test, expect } = require("@playwright/test");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const gameUrl = pathToFileURL(path.join(__dirname, "..", "index.html")).href;

for (const viewport of [
  { name: "PC", width: 1280, height: 800 },
  { name: "スマートフォン", width: 390, height: 844 }
]) {
  test(`進化カードを画面中央へ大きく表示する（${viewport.name}）`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto(gameUrl);

    await page.evaluate(() => {
      const api = window.__chibattle;
      api.state.screen = "battle";
      api.state.phase = "battle";
      api.render();
      api.showEvolutionAnimation({
        owner: "player",
        targetCard: api.createCardFromBase("failure_student", "player"),
        evolutionCard: api.createCardFromBase("success_student", "player")
      });
    });

    const overlay = page.locator("#playRevealOverlay");
    const reveal = page.locator("#playRevealCard");
    const scene = reveal.locator(".evolution-scene");
    const evolvedCard = reveal.locator(".donguri-evolved-card .card");

    await expect(overlay).toBeVisible();
    await expect(reveal).toHaveClass(/evolution-card/);
    await expect(reveal).not.toHaveClass(/source-aligned/);
    await expect(evolvedCard).toBeVisible();

    const layout = await scene.evaluate((element) => {
      const sceneRect = element.getBoundingClientRect();
      const card = element.querySelector(".donguri-evolved-card .card");
      const cardRect = card.getBoundingClientRect();
      return {
        sceneCenterX: sceneRect.left + sceneRect.width / 2,
        sceneCenterY: sceneRect.top + sceneRect.height / 2,
        cardWidth: Number.parseFloat(getComputedStyle(card).width),
        renderedCardWidth: cardRect.width,
        viewportCenterX: window.innerWidth / 2,
        viewportCenterY: window.innerHeight / 2
      };
    });

    expect(Math.abs(layout.sceneCenterX - layout.viewportCenterX)).toBeLessThanOrEqual(2);
    expect(Math.abs(layout.sceneCenterY - layout.viewportCenterY)).toBeLessThanOrEqual(2);
    expect(layout.cardWidth).toBeGreaterThanOrEqual(245);
    expect(layout.renderedCardWidth).toBeGreaterThanOrEqual(220);

    await page.waitForTimeout(1850);
    const overlap = await scene.evaluate((element) => {
      const baseRect = element.querySelector(".donguri-base-card .card").getBoundingClientRect();
      const evolvedRect = element.querySelector(".donguri-evolved-card .card").getBoundingClientRect();
      return {
        left: Math.abs(baseRect.left - evolvedRect.left),
        top: Math.abs(baseRect.top - evolvedRect.top),
        width: Math.abs(baseRect.width - evolvedRect.width),
        height: Math.abs(baseRect.height - evolvedRect.height)
      };
    });
    expect(overlap.left).toBeLessThanOrEqual(1);
    expect(overlap.top).toBeLessThanOrEqual(1);
    expect(overlap.width).toBeLessThanOrEqual(1);
    expect(overlap.height).toBeLessThanOrEqual(1);

    await page.evaluate(() => window.__chibattle.hidePlayReveal());
    await expect(overlay).toBeHidden();
  });
}

test("すべての進化カードで進化前後のカード面が同じ大きさに重なる", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(gameUrl);

  const results = await page.evaluate(() => {
    const api = window.__chibattle;
    api.state.screen = "battle";
    api.state.phase = "battle";
    api.render();

    return Object.entries(api.CARD_BASES)
      .filter(([, base]) => base.evolutionFrom)
      .map(([evolutionBaseId, base]) => {
        api.showEvolutionAnimation({
          owner: "player",
          targetCard: api.createCardFromBase(base.evolutionFrom, "player"),
          evolutionCard: api.createCardFromBase(evolutionBaseId, "player")
        });

        const stackCards = [...document.querySelectorAll("#playRevealCard .donguri-stack-card")];
        stackCards.forEach((element) => {
          element.getAnimations().forEach((animation) => {
            animation.currentTime = 1300;
          });
        });
        const midBaseRect = document.querySelector(".donguri-base-card .card").getBoundingClientRect();
        const midEvolvedRect = document.querySelector(".donguri-evolved-card .card").getBoundingClientRect();
        const midSizeDifference = {
          width: Math.abs(midBaseRect.width - midEvolvedRect.width),
          height: Math.abs(midBaseRect.height - midEvolvedRect.height)
        };

        stackCards.forEach((element) => {
          element.getAnimations().forEach((animation) => animation.finish());
        });

        const selectors = [".card", ".card-scale-stage", ".card-face"];
        const differences = selectors.map((selector) => {
          const before = document.querySelector(`.donguri-base-card ${selector}`).getBoundingClientRect();
          const after = document.querySelector(`.donguri-evolved-card ${selector}`).getBoundingClientRect();
          return {
            selector,
            left: Math.abs(before.left - after.left),
            top: Math.abs(before.top - after.top),
            width: Math.abs(before.width - after.width),
            height: Math.abs(before.height - after.height)
          };
        });
        api.hidePlayReveal();
        return { evolutionBaseId, evolutionFrom: base.evolutionFrom, midSizeDifference, differences };
      });
  });

  expect(results.length).toBeGreaterThan(0);
  results.forEach(({ evolutionBaseId, evolutionFrom, midSizeDifference, differences }) => {
    expect(midSizeDifference.width, `${evolutionFrom}→${evolutionBaseId} 演出途中 width`).toBeLessThanOrEqual(1);
    expect(midSizeDifference.height, `${evolutionFrom}→${evolutionBaseId} 演出途中 height`).toBeLessThanOrEqual(1);
    differences.forEach((difference) => {
      expect(difference.left, `${evolutionFrom}→${evolutionBaseId} ${difference.selector} left`).toBeLessThanOrEqual(1);
      expect(difference.top, `${evolutionFrom}→${evolutionBaseId} ${difference.selector} top`).toBeLessThanOrEqual(1);
      expect(difference.width, `${evolutionFrom}→${evolutionBaseId} ${difference.selector} width`).toBeLessThanOrEqual(1);
      expect(difference.height, `${evolutionFrom}→${evolutionBaseId} ${difference.selector} height`).toBeLessThanOrEqual(1);
    });
  });
});
