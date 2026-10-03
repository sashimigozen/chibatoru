const { test, expect } = require("@playwright/test");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const gameUrl = pathToFileURL(path.join(__dirname, "..", "index.html")).href;

test.beforeEach(async ({ page }) => {
  await page.goto(gameUrl);
  await page.evaluate(() => {
    const api = window.__chibattle;
    api.startCardTest("general_student");
    api.state.phase = "mulligan";
    api.state.firstSide = "player";
    api.state.players.player.mulliganUsed = false;
    api.state.players.opponent.mulliganUsed = false;
    api.state.players.player.hand = Array.from({ length: 5 }, () => api.createCardFromBase("general_student", "player"));
    api.render();
  });
});

test("ソロのマリガンで自分の先攻・後攻を表示し、引き直し中も維持する", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  for (const viewport of [{ width: 1920, height: 1080 }, { width: 1280, height: 720 }]) {
    await page.setViewportSize(viewport);
    for (const [side, order] of [["player", "先攻"], ["opponent", "後攻"]]) {
      await page.evaluate((firstSide) => {
        const api = window.__chibattle;
        api.state.phase = "mulligan";
        api.state.firstSide = firstSide;
        api.render();
      }, side);
      const badge = page.locator("#mulliganOrder");
      await expect(badge).toBeVisible();
      await expect(badge).toHaveText(`あなたは${order}`);
      await expect(badge).toHaveCSS("font-size", "18px");
      const bounds = await badge.boundingBox();
      const title = await page.locator("#mulliganTitle").boundingBox();
      expect(bounds.y).toBeGreaterThanOrEqual(0);
      expect(bounds.y + bounds.height).toBeLessThanOrEqual(title.y);
      expect(bounds.x).toBeGreaterThanOrEqual(0);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width);
      await expect(page.locator("#mulliganHand .mulligan-card")).toHaveCount(5);
      await page.evaluate(() => {
        window.__chibattle.state.phase = "mulliganDraw";
        window.__chibattle.render();
      });
      await expect(badge).toHaveText(`あなたは${order}`);
      await expect(badge).toBeVisible();
    }
  }
  expect(errors).toEqual([]);
});

test("オンライン同期でホストとゲストそれぞれ自分の先後を表示する", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  for (const [hostSide, hostOrder, guestOrder] of [["player", "先攻", "後攻"], ["opponent", "後攻", "先攻"]]) {
    const snapshot = await page.evaluate((firstSide) => {
      const api = window.__chibattle;
      api.state.online.enabled = true;
      api.state.online.role = "host";
      api.state.online.started = true;
      api.state.phase = "mulligan";
      api.state.firstSide = firstSide;
      api.render();
      return api.onlineCreateSnapshot();
    }, hostSide);
    await expect(page.locator("#mulliganOrder")).toHaveText(`あなたは${hostOrder}`);
    await page.evaluate((hostSnapshot) => {
      const api = window.__chibattle;
      api.state.online.role = "guest";
      api.onlineHandleMessage({ type: "gameState", protocol: 1,
        snapshot: { ...hostSnapshot, seq: api.state.online.lastSnapshotSeq + 1 } });
    }, snapshot);
    await expect(page.locator("#mulliganOrder")).toHaveText(`あなたは${guestOrder}`);
    await expect(page.locator("#mulliganOrder")).toBeVisible();
  }
  expect(errors).toEqual([]);
});

test("先後未決定・マリガン完了・別のカード選択では先後表示を出さない", async ({ page }) => {
  await page.evaluate(() => {
    window.__chibattle.state.firstSide = null;
    window.__chibattle.render();
  });
  await expect(page.locator("#mulliganOrder")).toBeHidden();
  await page.evaluate(() => {
    const api = window.__chibattle;
    api.state.firstSide = "player";
    api.state.players.player.mulliganUsed = true;
    api.render();
  });
  await expect(page.locator("#mulliganOrder")).toBeHidden();
  await page.evaluate(() => {
    const api = window.__chibattle;
    api.state.phase = "battle";
    api.state.pendingCardChoice = {
      mode: "thin_item_keep", title: "残すカードを選んでください", message: "4枚を選びます。",
      cards: [], selectedIds: [], min: 4, max: 4, confirmLabel: "この4枚を残す"
    };
    api.render();
  });
  await expect(page.locator("#mulliganStage")).toBeVisible();
  await expect(page.locator("#mulliganOrder")).toBeHidden();
  await expect(page.locator("#mulliganTitle")).toHaveText("残すカードを選んでください");
});
