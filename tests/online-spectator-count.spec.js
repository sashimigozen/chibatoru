const { test, expect } = require("@playwright/test");
const { spawn } = require("node:child_process");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const port = 18797;
const gameUrl = pathToFileURL(path.join(__dirname, "..", "index.html"));
gameUrl.searchParams.set("ws", `ws://127.0.0.1:${port}`);
let serverProcess;

test.beforeAll(async () => {
  serverProcess = spawn(process.execPath, [path.join(__dirname, "..", "server", "server.js")], {
    env: { ...process.env, PORT: String(port) }, stdio: ["ignore", "pipe", "pipe"]
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("観戦テストサーバーの起動がタイムアウトしました。")), 5000);
    serverProcess.stdout.on("data", (chunk) => {
      if (!String(chunk).includes("listening")) return;
      clearTimeout(timer);
      resolve();
    });
    serverProcess.once("error", reject);
  });
});

test.afterAll(() => {
  if (serverProcess && !serverProcess.killed) serverProcess.kill("SIGTERM");
});

test("観戦者がいる対戦だけに表示し、多い手札やホバーも観戦表示・山札へ重ならない", async ({ page }) => {
  await page.goto(gameUrl.href);
  await page.evaluate(() => {
    const api = window.__chibattle;
    api.state.screen = "battle";
    api.state.phase = "battle";
    api.state.currentSide = "player";
    api.state.online.role = "host";
    api.state.online.started = true;
    api.state.online.roomSessionId = "count-test";
    api.state.players.player.hand = Array.from({ length: 140 }, () => api.createCardFromBase("general_student", "player"));
    api.render();
  });
  await expect(page.locator("#battleSpectatorCount")).toBeHidden();
  await page.evaluate(() => {
    const api = window.__chibattle;
    api.onlineHandleMessage({ type: "spectatorCount", protocol: 1, senderId: "server", roomSessionId: "count-test", spectatorCount: 1 });
  });
  await expect(page.locator("#battleSpectatorCount")).toBeVisible();
  await expect(page.locator("#battleSpectatorCountValue")).toHaveText("1");

  for (const viewport of [{ width: 1440, height: 900 }, { width: 1122, height: 768 }]) {
    await page.setViewportSize(viewport);
    const cardBox = await page.locator("#playerHand .hand-card").last().boundingBox();
    // Move onto the visible card rather than scrolling its deliberately
    // off-screen lower edge into view as locator.hover() would do.
    await page.mouse.move(cardBox.x + cardBox.width / 2, Math.min(cardBox.y + 18, viewport.height - 8));
    const bounds = await page.evaluate(() => {
      const badge = document.getElementById("battleSpectatorCount").getBoundingClientRect();
      const deck = document.getElementById("playerDeckPile").getBoundingClientRect();
      const cards = [...document.querySelectorAll("#playerHand .hand-card")].map((card) => card.getBoundingClientRect());
      return {
        handRight: Math.max(...cards.map((card) => card.right)), badgeLeft: badge.left,
        badgeRight: badge.right, badgeTop: badge.top, badgeBottom: badge.bottom,
        deckLeft: deck.left, viewportWidth: innerWidth, viewportHeight: innerHeight
      };
    });
    expect(bounds.handRight).toBeLessThan(bounds.badgeLeft);
    expect(bounds.badgeRight).toBeLessThan(bounds.deckLeft);
    expect(bounds.badgeTop).toBeGreaterThan(bounds.viewportHeight * .8);
    expect(bounds.badgeRight).toBeGreaterThan(bounds.viewportWidth * .7);
    expect(bounds.badgeBottom).toBeLessThanOrEqual(bounds.viewportHeight);
  }
  const unchanged = await page.evaluate(() => {
    const api = window.__chibattle;
    for (const message of [
      { roomSessionId: "other-room", spectatorCount: 0, senderId: "server" },
      { roomSessionId: "count-test", spectatorCount: 0, senderId: "opponent" },
      { roomSessionId: "count-test", spectatorCount: -1, senderId: "server" }
    ]) api.onlineHandleMessage({ type: "spectatorCount", protocol: 1, ...message });
    return api.state.online.spectatorCount;
  });
  expect(unchanged).toBe(1);
  await page.evaluate(() => {
    const api = window.__chibattle;
    api.state.online.role = null;
    api.render();
  });
  await expect(page.locator("#battleSpectatorCount")).toBeHidden();
});

test("観戦者の入退室・再入室でホスト、ゲスト、観戦者の人数だけが更新され、0人なら消える", async ({ browser }) => {
  const contexts = [];
  const pageErrors = [];
  async function openBattleMenu() {
    const context = await browser.newContext();
    contexts.push(context);
    const page = await context.newPage();
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await page.goto(gameUrl.href);
    await page.locator("#homeNavBattleButton").click();
    return page;
  }
  async function joinSpectator(roomCode) {
    const page = await openBattleMenu();
    await page.locator("#onlineSpectateButton").click();
    await page.locator("#onlineSpectateRoomInput").fill(roomCode);
    await page.locator("#onlineSpectateSearchButton").click();
    await expect.poll(() => page.evaluate(() => window.__chibattle.state.online.started)).toBe(true);
    return page;
  }
  async function expectCount(pages, count) {
    for (const page of pages) {
      await expect.poll(() => page.evaluate(() => window.__chibattle.state.online.spectatorCount)).toBe(count);
      if (count) {
        await expect(page.locator("#battleSpectatorCount")).toBeVisible();
        await expect(page.locator("#battleSpectatorCountValue")).toHaveText(String(count));
      } else {
        await expect(page.locator("#battleSpectatorCount")).toBeHidden();
      }
    }
  }
  try {
    const host = await openBattleMenu();
    const guest = await openBattleMenu();
    for (const page of [host, guest]) await page.locator("#onlinePrivateMatchButton").click();
    await host.locator("#onlineCreateRoomButton").click();
    await expect.poll(() => host.evaluate(() => window.__chibattle.state.online.role)).toBe("host");
    const roomCode = await host.evaluate(() => window.__chibattle.state.online.roomCode);
    await guest.locator("#onlineRoomInput").fill(roomCode);
    await guest.locator("#onlineJoinRoomButton").click();
    await expect.poll(() => host.evaluate(() => window.__chibattle.state.online.connected)).toBe(true);
    for (const page of [host, guest]) {
      await page.evaluate(() => {
        const api = window.__chibattle;
        api.state.deckBuilder.counts.player = api.createAutoDeckCounts();
        document.getElementById("onlineDeckSelect").dispatchEvent(new Event("change", { bubbles: true }));
      });
      await page.locator("#onlineReadyButton").click();
    }
    await expect(host.locator("#onlineStartButton")).toBeEnabled();
    await host.locator("#onlineStartButton").click();
    await expect.poll(() => guest.evaluate(() => window.__chibattle.state.online.started)).toBe(true);
    await host.evaluate(() => {
      const api = window.__chibattle;
      api.state.phase = "battle";
      api.render();
      api.onlineBroadcastState(true);
    });
    await expect.poll(() => guest.evaluate(() => window.__chibattle.state.phase)).toBe("battle");
    await expectCount([host, guest], 0);
    const first = await joinSpectator(roomCode);
    await expectCount([host, guest, first], 1);
    const second = await joinSpectator(roomCode);
    await expectCount([host, guest, first, second], 2);
    const before = await host.evaluate(() => ({ message: window.__chibattle.state.message, log: [...window.__chibattle.state.log], status: window.__chibattle.state.online.status }));
    await second.context().close();
    await expectCount([host, guest, first], 1);
    await first.context().close();
    await expectCount([host, guest], 0);
    expect(await host.evaluate(() => ({ message: window.__chibattle.state.message, log: [...window.__chibattle.state.log], status: window.__chibattle.state.online.status }))).toEqual(before);
    const returning = await joinSpectator(roomCode);
    await expectCount([host, guest, returning], 1);
    expect(pageErrors).toEqual([]);
  } finally {
    for (const context of contexts) await context.close();
  }
});
