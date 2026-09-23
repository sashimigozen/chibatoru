const { test, expect } = require("@playwright/test");
const { spawn } = require("node:child_process");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const port = 18792;
const wsUrl = `ws://127.0.0.1:${port}`;
const gameFileUrl = pathToFileURL(path.join(__dirname, "..", "index.html"));
gameFileUrl.searchParams.set("ws", wsUrl);
const gameUrl = gameFileUrl.href;
let serverProcess;

test.beforeAll(async () => {
  serverProcess = spawn(process.execPath, [path.join(__dirname, "..", "server", "server.js")], {
    env: { ...process.env, PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"]
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("オンラインテストサーバーの起動がタイムアウトしました。")), 5000);
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

async function openOnlineLobby(page) {
  await page.goto(gameUrl);
  await page.locator("#homeNavBattleButton").click();
  await page.locator("#onlinePrivateMatchButton").click();
}

async function chooseValidDeck(page) {
  await page.evaluate(() => {
    const api = window.__chibattle;
    api.state.deckBuilder.counts.player = api.createAutoDeckCounts();
    document.getElementById("onlineDeckSelect").dispatchEvent(new Event("change", { bubbles: true }));
  });
  await expect(page.locator("#onlineReadyButton")).toBeEnabled();
}

test("ゲスト側でも山札を手札レーンの外に固定する", async ({ browser }) => {
  const hostContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const guestContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const host = await hostContext.newPage();
  const guest = await guestContext.newPage();

  try {
    await Promise.all([openOnlineLobby(host), openOnlineLobby(guest)]);
    await host.locator("#onlineCreateRoomButton").click();
    await expect.poll(() => host.evaluate(() => window.__chibattle.state.online.role)).toBe("host");
    const roomCode = await host.evaluate(() => window.__chibattle.state.online.roomCode);
    await guest.locator("#onlineRoomInput").fill(roomCode);
    await guest.locator("#onlineJoinRoomButton").click();
    await expect.poll(() => guest.evaluate(() => window.__chibattle.state.online.role)).toBe("guest");
    await expect.poll(() => host.evaluate(() => window.__chibattle.state.online.connected)).toBe(true);
    await expect.poll(() => guest.evaluate(() => window.__chibattle.state.online.connected)).toBe(true);

    await chooseValidDeck(host);
    await chooseValidDeck(guest);
    await host.locator("#onlineReadyButton").click();
    await guest.locator("#onlineReadyButton").click();
    await expect.poll(() => host.evaluate(() => (
      window.__chibattle.state.online.localReady && window.__chibattle.state.online.remoteReady
    ))).toBe(true);
    await host.locator("#onlineStartButton").click();
    await expect.poll(() => guest.evaluate(() => window.__chibattle.state.screen)).toBe("battle");

    const guestLayout = await guest.evaluate(() => {
      const rect = (selector) => {
        const bounds = document.querySelector(selector).getBoundingClientRect();
        return { left: bounds.left, right: bounds.right, top: bounds.top, bottom: bounds.bottom };
      };
      return {
        role: window.__chibattle.state.online.role,
        hand: rect("#playerHand"),
        deck: rect("#playerDeckPile"),
        deckCount: window.__chibattle.state.players.player.deck.length
      };
    });

    const hostLayout = await host.evaluate(() => {
      const hand = document.querySelector("#opponentHand").getBoundingClientRect();
      const deck = document.querySelector("#opponentDeckPile").getBoundingClientRect();
      return {
        role: window.__chibattle.state.online.role,
        deckParentClass: document.querySelector("#opponentDeckPile").parentElement.className,
        hand: { left: hand.left, right: hand.right },
        deck: { left: deck.left, right: deck.right },
        guestDeckCount: window.__chibattle.state.players.opponent.deck.length
      };
    });

    expect(guestLayout.role).toBe("guest");
    expect(guestLayout.deckCount).toBeGreaterThan(0);
    expect(guestLayout.deck.left).toBeGreaterThanOrEqual(guestLayout.hand.right + 1);

    expect(hostLayout.role).toBe("host");
    expect(hostLayout.guestDeckCount).toBe(guestLayout.deckCount);
    expect(hostLayout.deckParentClass).toContain("opponent-hand-zone");
    expect(hostLayout.deckParentClass).not.toContain("opponent-hand-table");
    expect(hostLayout.deck.right).toBeLessThanOrEqual(hostLayout.hand.left - 1);

    await host.setViewportSize({ width: 600, height: 800 });
    const mobileLayout = await host.evaluate(() => {
      const hand = document.querySelector("#opponentHand").getBoundingClientRect();
      const deck = document.querySelector("#opponentDeckPile").getBoundingClientRect();
      return {
        hand: { left: hand.left, right: hand.right },
        deck: { left: deck.left, right: deck.right }
      };
    });
    expect(mobileLayout.deck.right).toBeLessThanOrEqual(mobileLayout.hand.left - 1);
  } finally {
    await hostContext.close();
    await guestContext.close();
  }
});
