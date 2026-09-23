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

test("ゲスト本人の山札をホスト本人の山札と同じ位置に固定する", async ({ browser }) => {
  const hostContext = await browser.newContext({ viewport: { width: 1122, height: 696 } });
  const guestContext = await browser.newContext({ viewport: { width: 1122, height: 696 } });
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
        action: rect(".battle-action-slot"),
        playerWill: rect(".battle-v16-player-mana"),
        opponentWill: rect(".battle-v16-opponent-mana"),
        deckCount: window.__chibattle.state.players.player.deck.length
      };
    });

    const hostLayout = await host.evaluate(() => {
      const hand = document.querySelector("#playerHand").getBoundingClientRect();
      const deck = document.querySelector("#playerDeckPile").getBoundingClientRect();
      return {
        role: window.__chibattle.state.online.role,
        hand: { left: hand.left, right: hand.right, top: hand.top, bottom: hand.bottom },
        deck: { left: deck.left, right: deck.right, top: deck.top, bottom: deck.bottom },
        action: (() => {
          const rect = document.querySelector(".battle-action-slot").getBoundingClientRect();
          return { left: rect.left, right: rect.right };
        })(),
        playerWill: (() => {
          const rect = document.querySelector(".battle-v16-player-mana").getBoundingClientRect();
          return { left: rect.left, right: rect.right };
        })(),
        opponentWill: (() => {
          const rect = document.querySelector(".battle-v16-opponent-mana").getBoundingClientRect();
          return { left: rect.left, right: rect.right };
        })(),
        deckCount: window.__chibattle.state.players.player.deck.length
      };
    });

    const centerX = (rect) => (rect.left + rect.right) / 2;
    const expectSameCenter = (layout) => {
      expect(Math.abs(centerX(layout.deck) - centerX(layout.action))).toBeLessThanOrEqual(0.5);
      expect(Math.abs(centerX(layout.deck) - centerX(layout.playerWill))).toBeLessThanOrEqual(0.5);
      expect(Math.abs(centerX(layout.deck) - centerX(layout.opponentWill))).toBeLessThanOrEqual(0.5);
    };

    expect(guestLayout.role).toBe("guest");
    expect(guestLayout.deckCount).toBeGreaterThan(0);
    expect(guestLayout.deck.left).toBeGreaterThanOrEqual(guestLayout.hand.right + 1);
    expectSameCenter(guestLayout);

    expect(hostLayout.role).toBe("host");
    expect(hostLayout.deckCount).toBe(guestLayout.deckCount);
    expect(guestLayout.deck).toEqual(hostLayout.deck);
    expectSameCenter(hostLayout);

    await Promise.all([
      host.setViewportSize({ width: 600, height: 800 }),
      guest.setViewportSize({ width: 600, height: 800 })
    ]);
    const mobileDecks = await Promise.all([host, guest].map((page) => page.evaluate(() => {
      const deck = document.querySelector("#playerDeckPile").getBoundingClientRect();
      return { left: deck.left, right: deck.right, top: deck.top, bottom: deck.bottom };
    })));
    expect(mobileDecks[1]).toEqual(mobileDecks[0]);
  } finally {
    await hostContext.close();
    await guestContext.close();
  }
});
