const { test, expect } = require("@playwright/test");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const gameUrl = pathToFileURL(path.join(__dirname, "..", "index.html")).href;

test("PC盤面は縦横比を保って画面内に収まり、スマホ配置は維持する", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(gameUrl);
  await page.evaluate(() => {
    window.__chibattle.startCardTest("general_student");
    window.__chibattle.render();
  });

  for (const viewport of [
    { width: 1920, height: 1080 },
    { width: 1440, height: 900 },
    { width: 1280, height: 720 },
    { width: 900, height: 900 },
    { width: 390, height: 844 }
  ]) {
    await page.setViewportSize(viewport);
    const expectedZoom = viewport.width <= 760
      ? 1
      : Math.min((viewport.width - 24) / 1200, (viewport.height - 24) / 826);
    await expect.poll(() => page.locator("#battleScreen .game-shell").evaluate((shell) => Number(getComputedStyle(shell).zoom)))
      .toBeCloseTo(expectedZoom, 2);
    const metrics = await page.evaluate(() => {
      const shell = document.querySelector("#battleScreen .game-shell");
      const bounds = (element) => {
        const rect = element.getBoundingClientRect();
        return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height };
      };
      return {
        zoom: Number(getComputedStyle(shell).zoom),
        shell: bounds(shell),
        hand: bounds(document.getElementById("playerHand")),
        endTurn: bounds(document.getElementById("endTurnButton"))
      };
    });
    if (viewport.width <= 760) {
      expect(metrics.zoom).toBe(1);
      continue;
    }
    expect(metrics.zoom).toBeCloseTo(expectedZoom, 2);
    expect(metrics.shell.width / metrics.shell.height).toBeCloseTo(1200 / 826, 2);
    expect(metrics.shell.left).toBeGreaterThanOrEqual(0);
    expect(metrics.shell.right).toBeLessThanOrEqual(viewport.width);
    expect(metrics.shell.top).toBeGreaterThanOrEqual(8);
    expect(metrics.shell.bottom).toBeLessThanOrEqual(viewport.height - 8);
    expect(metrics.hand.top).toBeLessThan(viewport.height - 50);
    expect(metrics.endTurn.right).toBeLessThan(viewport.width);
    expect(metrics.endTurn.bottom).toBeLessThan(viewport.height);
  }
  expect(errors).toEqual([]);
});

test("盤面を拡大縮小してもメニューとログをクリックできる", async ({ page }) => {
  await page.goto(gameUrl);
  await page.evaluate(() => {
    window.__chibattle.startCardTest("general_student");
    window.__chibattle.render();
  });
  for (const viewport of [{ width: 1920, height: 1080 }, { width: 1280, height: 720 }]) {
    await page.setViewportSize(viewport);
    await page.locator("#battleMenuButton").click();
    await expect(page.locator("#battleMenuDrawer")).toHaveClass(/open/);
    await page.locator("#battleMenuCloseButton").click();
    await page.locator("#battleLogButton").click();
    await expect(page.locator("#battleLogDrawer")).toHaveClass(/open/);
    await page.locator("#battleLogCloseButton").click();
  }
});

test("マリガンの確定ボタンは画面内に表示され、押せる", async ({ page }) => {
  for (const viewport of [
    { width: 1920, height: 1080 },
    { width: 1280, height: 720 },
    { width: 390, height: 844 }
  ]) {
    await page.setViewportSize(viewport);
    await page.goto(gameUrl);
    await page.evaluate(() => {
      const game = window.__chibattle;
      game.startCardTest("general_student");
      game.state.phase = "mulligan";
      game.state.players.player.mulliganUsed = false;
      game.render();
    });
    const button = page.locator("#mulliganButton");
    await expect(button).toBeVisible();
    await expect(button).toBeEnabled();
    const bounds = await button.boundingBox();
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.y).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(viewport.height);
    await button.click();
    await expect(button).toBeHidden();
  }
});
