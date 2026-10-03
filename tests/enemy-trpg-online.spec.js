const { test, expect } = require("@playwright/test");
const { spawn } = require("node:child_process");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const port = 18795;
const gameFileUrl = pathToFileURL(path.join(__dirname, "..", "index.html"));
gameFileUrl.searchParams.set("ws", `ws://127.0.0.1:${port}`);
let serverProcess;

test.beforeAll(async () => {
  serverProcess = spawn(process.execPath, [path.join(__dirname, "..", "server", "server.js")], {
    env: { ...process.env, PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"]
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("オンラインテストサーバー起動タイムアウト")), 5000);
    serverProcess.stdout.on("data", (chunk) => {
      if (!String(chunk).includes("listening")) return;
      clearTimeout(timer);
      resolve();
    });
    serverProcess.once("error", reject);
  });
});

test.afterAll(() => serverProcess?.kill("SIGTERM"));

test("敵に塩でホスト・ゲスト両方の敵を即時強化し、表示・本体ダメージ・条件解除を同期する", async ({ browser }) => {
  const contexts = await Promise.all([browser.newContext(), browser.newContext()]);
  const [host, guest] = await Promise.all(contexts.map((context) => context.newPage()));
  try {
    for (const page of [host, guest]) {
      await page.goto(gameFileUrl.href);
      await page.locator("#homeNavBattleButton").click();
      await page.locator("#onlinePrivateMatchButton").click();
    }
    await host.locator("#onlineCreateRoomButton").click();
    await expect.poll(() => host.evaluate(() => window.__chibattle.state.online.role)).toBe("host");
    const roomCode = await host.evaluate(() => window.__chibattle.state.online.roomCode);
    await guest.locator("#onlineRoomInput").fill(roomCode);
    await guest.locator("#onlineJoinRoomButton").click();
    for (const page of [host, guest]) {
      await expect.poll(() => page.evaluate(() => window.__chibattle.state.online.connected)).toBe(true);
      await page.evaluate(() => {
        const api = window.__chibattle;
        api.state.deckBuilder.counts.player = api.createAutoDeckCounts();
        document.getElementById("onlineDeckSelect").dispatchEvent(new Event("change", { bubbles: true }));
      });
      await page.locator("#onlineReadyButton").click();
    }
    await expect.poll(() => host.evaluate(() => window.__chibattle.state.online.remoteReady)).toBe(true);
    await host.locator("#onlineStartButton").click();
    for (const page of [host, guest]) {
      await expect.poll(() => page.evaluate(() => window.__chibattle.state.online.started)).toBe(true);
    }

    for (const role of ["host", "guest"]) {
      const actor = role === "host" ? host : guest;
      for (const zone of ["seat", "teacher"]) {
        const setup = await host.evaluate(({ role, zone }) => {
          const api = window.__chibattle;
          api.startCardTest("enemy_student");
          const side = role === "host" ? "player" : "opponent";
          api.state.currentSide = side;
          for (const owner of ["player", "opponent"]) {
            api.state.players[owner].board = { teacher: null, seats: Array(9).fill(null) };
            api.state.players[owner].hand = [];
          }
          const enemy = api.makeBoardCard(api.createCardFromBase("enemy_student", side));
          enemy.playedOnTurn = 0;
          if (zone === "teacher") api.state.players[side].board.teacher = enemy;
          else api.state.players[side].board.seats[0] = enemy;
          api.state.players[side].hand = [api.createCardFromBase("salt_to_enemy", side)];
          api.render();
          return { id: enemy.instanceId, seq: api.state.online.lastSnapshotSeq };
        }, { role, zone });
        await expect.poll(() => guest.evaluate(() => window.__chibattle.state.online.lastSnapshotSeq)).toBeGreaterThanOrEqual(setup.seq);

        await actor.evaluate(() => {
          const api = window.__chibattle;
          const salt = api.state.players.player.hand.find((card) => card.baseId === "salt_to_enemy");
          api.castCaptureOnSlot("player", salt, "opponent", "seat", 0, true);
        });
        for (const page of [host, guest]) {
          const enemy = page.locator(`[data-card-id="${setup.id}"].board-card`);
          await expect(enemy.locator(".field-stat.attack")).toHaveText("6");
          expect(await page.evaluate((id) => {
            const api = window.__chibattle;
            const cards = Object.values(api.state.players).flatMap((player) => [player.board.teacher, ...player.board.seats]);
            const enemy = cards.find((card) => card?.instanceId === id);
            return { attack: enemy.attack, cheerful: api.hasKeyword(enemy, "陽気") };
          }, setup.id)).toEqual({ attack: 6, cheerful: true });
        }

        // Attack through the actual host/guest UI; damage must use the updated
        // numeric stat, not merely the dynamically calculated keyword.
        await actor.evaluate((zone) => {
          window.__chibattle.state.selectedAttacker = { owner: "player", zone, index: zone === "seat" ? 0 : null };
        }, zone);
        await actor.locator('[data-life-target="opponent"]').click();
        const targetSide = role === "host" ? "opponent" : "player";
        await expect.poll(() => host.evaluate((side) => window.__chibattle.state.players[side].life, targetSide)).toBe(14);
        const guestTarget = targetSide === "player" ? "opponent" : "player";
        await expect.poll(() => guest.evaluate((side) => window.__chibattle.state.players[side].life, guestTarget)).toBe(14);

        await host.evaluate((side) => {
          const api = window.__chibattle;
          api.destroyBoardCard({ owner: side, zone: "seat", index: 0 });
          api.applyBoardAuras();
          api.render();
        }, targetSide);
        for (const page of [host, guest]) {
          await expect(page.locator(`[data-card-id="${setup.id}"].board-card .field-stat.attack`)).toHaveText("1");
        }
      }
    }
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
});
