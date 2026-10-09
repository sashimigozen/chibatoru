const { test, expect } = require("@playwright/test");
const { spawn } = require("node:child_process");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const gameUrl = pathToFileURL(path.join(__dirname, "..", "index.html"));
const port = 18807;
gameUrl.searchParams.set("ws", `ws://127.0.0.1:${port}`);
let server;
test.beforeAll(async () => {
  server = spawn(process.execPath, [path.join(__dirname, "..", "server", "server.js")], {
    env: { ...process.env, PORT: String(port) }, stdio: ["ignore", "pipe", "pipe"]
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("オンラインテスト起動タイムアウト")), 5000);
    server.stdout.on("data", data => {
      if (String(data).includes("listening")) { clearTimeout(timer); resolve(); }
    });
    server.once("error", reject);
  });
});
test.afterAll(() => server?.kill("SIGTERM"));

test("ホスト・ゲストともにアグロ散歩の攻撃力のみの強化とプリンセスの先行自傷・敗北を同期する", async ({ browser }) => {
  const contexts = await Promise.all([browser.newContext(), browser.newContext()]);
  const [host, guest] = await Promise.all(contexts.map(c => c.newPage()));
  try {
    for (const page of [host, guest]) {
      await page.goto(gameUrl.href);
      await page.locator("#homeNavBattleButton").click();
      await page.locator("#onlinePrivateMatchButton").click();
    }
    await host.locator("#onlineCreateRoomButton").click();
    await expect.poll(() => host.evaluate(() => window.__chibattle.state.online.role)).toBe("host");
    await guest.locator("#onlineRoomInput").fill(await host.evaluate(() => window.__chibattle.state.online.roomCode));
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
      for (const life of [1, 20]) {
        const side = role === "host" ? "player" : "opponent";
        const id = await host.evaluate(({ side, life }) => {
          const api = window.__chibattle, s = api.state;
          api.startCardTest("aggro_princess");
          s.preBattleToken += 1000;
          Object.assign(s, { phase: "battle", screen: "battle", gameOver: false, gameWinner: null,
            currentSide: side, actionTurn: 8, environment: null, noAttackUntilActionTurn: 0 });
          for (const owner of ["player", "opponent"]) {
            Object.assign(s.players[owner], { life: owner === side ? life : 1,
              will: 10, maxWill: 10, hand: [], lifeShieldUntilTurn: 0, lifeFloorShields: [],
              board: { teacher: null, seats: Array(9).fill(null) } });
          }
          const card = api.makeBoardCard(api.createCardFromBase("aggro_princess", side));
          card.playedOnTurn = 0; s.players[side].board.seats[0] = card;
          s.players[side].hand = [api.createCardFromBase("aggro_walk", side)];
          api.render();
          return card.instanceId;
        }, { side, life });
        await expect.poll(() => guest.evaluate(id =>
          Object.values(window.__chibattle.state.players).some(p => p.board.seats.some(c => c?.instanceId === id)), id)).toBe(true);
        if (life === 20) {
          // Use the actual target-selection UI so the guest sends a command
          // and the host executes the shared item effect.
          await actor.evaluate(() => {
            const api = window.__chibattle;
            api.beginItemUse(api.state.players.player.hand.find(c => c.baseId === "aggro_walk"));
          });
          await actor.locator(`[data-card-id="${id}"].board-card`).click();
          await expect.poll(() => host.evaluate(side => {
            const p = window.__chibattle.state.players[side];
            return { attack: p.board.seats[0].attack, hp: p.board.seats[0].maxHp, life: p.life };
          }, side)).toEqual({ attack: 3, hp: 1, life: 18 });
          await expect.poll(() => guest.evaluate(id => {
            const p = Object.values(window.__chibattle.state.players)
              .find(p => p.board.seats.some(c => c?.instanceId === id));
            const card = p.board.seats.find(c => c?.instanceId === id);
            return { attack: card.attack, hp: card.maxHp, life: p.life };
          }, id)).toEqual({ attack: 3, hp: 1, life: 18 });
        }
        await actor.evaluate(() => {
          window.__chibattle.state.selectedAttacker = { owner: "player", zone: "seat", index: 0 };
        });
        const lifeTarget = actor.locator('[data-life-target="opponent"]');
        await expect(lifeTarget).toBeVisible();
        await expect(lifeTarget).toBeEnabled();
        // The life target pulses continuously when the cursor remains over
        // it from the preceding case. Send its click event without requiring
        // a stationary bounding box; the normal online handler still runs.
        await lifeTarget.dispatchEvent("click");
        for (const page of [host, guest]) {
          await expect.poll(() => page.evaluate(() => window.__chibattle.state.gameOver)).toBe(true);
        }
        const targetSide = side === "player" ? "opponent" : "player";
        expect(await host.evaluate(({ side, targetSide }) => {
          const s = window.__chibattle.state;
          return { life: s.players[side].life, enemyLife: s.players[targetSide].life, winner: s.gameWinner };
        }, { side, targetSide })).toEqual(life === 1
          ? { life: 0, enemyLife: 1, winner: targetSide }
          : { life: 17, enemyLife: 0, winner: side });
        // A win is visible before the asynchronous attack has finished.
        // Do not replace the board for the next case until its final command
        // acknowledgement and animation cleanup have both completed.
        await expect.poll(() => host.evaluate(() => {
          const s = window.__chibattle.state;
          return !s.attackInProgress && !s.online.isHandlingRemoteCommand;
        })).toBe(true);
        await expect.poll(() => guest.evaluate(() =>
          !window.__chibattle.state.online.pendingTurnCommandId)).toBe(true);
      }
    }
  } finally {
    await Promise.all(contexts.map(c => c.close()));
  }
});
