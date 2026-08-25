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

    await page.evaluate(() => window.__chibattle.hidePlayReveal());
    await expect(overlay).toBeHidden();
  });
}
