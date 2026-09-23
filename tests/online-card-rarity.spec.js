const { test, expect } = require("@playwright/test");
const { spawn } = require("node:child_process");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const port = 18788;
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

function cardStyleSave({ specialtyId, cardId, mode, prism = false }) {
  return {
    unlocked: { [specialtyId]: true },
    selected: { [cardId]: mode },
    ...(prism ? { prismUnlocked: { [cardId]: true } } : {})
  };
}

async function enterPrivateRoom(page) {
  await page.goto(gameUrl);
  await page.locator("#homeNavBattleButton").click();
  await page.locator("#onlinePrivateMatchButton").click();
}

test("オンライン対戦では両プレイヤーが選んだ高レアリティを双方の画面へ反映する", async ({ browser }) => {
  const hostContext = await browser.newContext();
  const guestContext = await browser.newContext();
  const host = await hostContext.newPage();
  const guest = await guestContext.newPage();
  try {
    await host.addInitScript((save) => {
      localStorage.setItem("chibattle-dungeon-card-styles-v1", JSON.stringify(save));
    }, cardStyleSave({ specialtyId: "king_ghidorah_bed", cardId: "king_ghidorah_bed", mode: "prism", prism: true }));
    await guest.addInitScript((save) => {
      localStorage.setItem("chibattle-dungeon-card-styles-v1", JSON.stringify(save));
    }, cardStyleSave({ specialtyId: "cafeteria", cardId: "vampire", mode: "reward" }));
    await Promise.all([enterPrivateRoom(host), enterPrivateRoom(guest)]);

    await host.locator("#onlineCreateRoomButton").click();
    await expect.poll(() => host.evaluate(() => window.__chibattle.state.online.role)).toBe("host");
    const roomCode = await host.evaluate(() => window.__chibattle.state.online.roomCode);
    await guest.locator("#onlineRoomInput").fill(roomCode);
    await guest.locator("#onlineJoinRoomButton").click();
    await expect.poll(() => host.evaluate(() => window.__chibattle.state.online.connected)).toBe(true);
    await expect.poll(() => guest.evaluate(() => window.__chibattle.state.online.connected)).toBe(true);

    for (const page of [host, guest]) {
      await page.evaluate(() => {
        const api = window.__chibattle;
        api.state.deckBuilder.counts.player = api.createAutoDeckCounts();
        document.getElementById("onlineDeckSelect").dispatchEvent(new Event("change", { bubbles: true }));
      });
    }
    await host.locator("#onlineReadyButton").click();
    await guest.locator("#onlineReadyButton").click();
    await expect.poll(() => host.evaluate(() => window.__chibattle.state.online.remoteCardStyles.vampire)).toBe("reward");
    await expect.poll(() => guest.evaluate(() => window.__chibattle.state.online.remoteCardStyles.king_ghidorah_bed)).toBe("prism");
    await expect.poll(() => host.evaluate(() => (
      window.__chibattle.state.online.localReady && window.__chibattle.state.online.remoteReady
    ))).toBe(true);
    await host.locator("#onlineStartButton").click();
    await expect.poll(() => host.evaluate(() => window.__chibattle.state.online.started)).toBe(true);
    await expect.poll(() => guest.evaluate(() => window.__chibattle.state.online.started)).toBe(true);

    // A reconnect or a missed lobby update must not make the battle depend on
    // transient lobby state. The next authoritative snapshot restores styles.
    await guest.evaluate(() => {
      const online = window.__chibattle.state.online;
      online.localCardStyles = {};
      online.remoteCardStyles = {};
      online.hostCardStyles = {};
      online.guestCardStyles = {};
    });

    const seq = await host.evaluate(() => {
      const api = window.__chibattle;
      api.state.phase = "battle";
      api.state.players.player.board.seats = Array(9).fill(null);
      api.state.players.opponent.board.seats = Array(9).fill(null);
      api.state.players.player.board.seats[0] = api.makeBoardCard(api.createCardFromBase("king_ghidorah_bed", "player"));
      api.state.players.opponent.board.seats[0] = api.makeBoardCard(api.createCardFromBase("vampire", "opponent"));
      api.render();
      api.onlineBroadcastState(true);
      return api.state.online.lastSnapshotSeq;
    });
    await expect.poll(() => guest.evaluate(() => window.__chibattle.state.online.lastSnapshotSeq)).toBeGreaterThanOrEqual(seq);
    expect(await guest.evaluate(() => ({
      local: window.__chibattle.state.online.localCardStyles,
      remote: window.__chibattle.state.online.remoteCardStyles
    }))).toEqual({
      local: { vampire: "reward" },
      remote: { king_ghidorah_bed: "prism" }
    });

    for (const page of [host, guest]) {
      await expect(page.locator('.board-card[data-base-id="king_ghidorah_bed"]')).toHaveClass(/reward-prism/);
      await expect(page.locator('.board-card[data-base-id="vampire"]')).toHaveClass(/reward-foil/);
    }

    await host.evaluate(() => {
      const api = window.__chibattle;
      api.showCardPlayAnimation(api.createCardFromBase("king_ghidorah_bed", "player"), "trash");
    });
    await expect(guest.locator("#playRevealCard .card")).toHaveClass(/reward-prism/);
    await Promise.all([host.evaluate(() => window.__chibattle.hidePlayReveal()), guest.evaluate(() => window.__chibattle.hidePlayReveal())]);

    await host.evaluate(() => {
      const api = window.__chibattle;
      api.showCardPlayAnimation(api.createCardFromBase("vampire", "opponent"), "trash");
    });
    await expect(guest.locator("#playRevealCard .card")).toHaveClass(/reward-foil/);
  } finally {
    await hostContext.close();
    await guestContext.close();
  }
});
