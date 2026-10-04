const { test, expect } = require("@playwright/test");
const { spawn } = require("node:child_process");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const port = 18809;
const gameUrl = pathToFileURL(path.join(__dirname, "..", "index.html"));
gameUrl.searchParams.set("ws", `ws://127.0.0.1:${port}`);
let server;

test.beforeAll(async () => {
  server = spawn(process.execPath, [path.join(__dirname, "..", "server", "server.js")], {
    env: { ...process.env, PORT: String(port) }, stdio: ["ignore", "pipe", "pipe"]
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("テストサーバー起動タイムアウト")), 5000);
    server.stdout.on("data", (chunk) => {
      if (!String(chunk).includes("listening")) return;
      clearTimeout(timer);
      resolve();
    });
    server.once("error", reject);
  });
});
test.afterAll(() => server?.kill("SIGTERM"));

test("オンライン双方で10枚なら使用・相手の4枚選択を同期し、11枚なら使用も消費も拒否する", async ({ browser }) => {
  const contexts = await Promise.all([browser.newContext(), browser.newContext()]);
  const [host, guest] = await Promise.all(contexts.map((context) => context.newPage()));
  const errors = [];
  try {
    for (const page of [host, guest]) {
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(gameUrl.href);
      await page.locator("#homeNavBattleButton").click();
      await page.locator("#onlinePrivateMatchButton").click();
    }
    await host.locator("#onlineCreateRoomButton").click();
    await expect.poll(() => host.evaluate(() => window.__chibattle.state.online.role)).toBe("host");
    const room = await host.evaluate(() => window.__chibattle.state.online.roomCode);
    await guest.locator("#onlineRoomInput").fill(room);
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
    await expect.poll(() => guest.evaluate(() => window.__chibattle.state.online.started)).toBe(true);

    for (const role of ["host", "guest"]) {
      const actor = role === "host" ? host : guest;
      const target = role === "host" ? guest : host;
      const side = role === "host" ? "player" : "opponent";
      for (const [ownCount, targetCount] of [[11, 10], [10, 11], [10, 10]]) {
        const setup = await host.evaluate(({ side, ownCount, targetCount }) => {
          const api = window.__chibattle;
          api.startCardTest("thin_item");
          api.state.currentSide = side;
          api.state.testMode = false;
          const other = side === "player" ? "opponent" : "player";
          for (const owner of [side, other]) {
            const count = owner === side ? ownCount : targetCount;
            const player = api.state.players[owner];
            player.hand = Array.from({ length: count }, () => api.createCardFromBase("general_student", owner));
            player.deck = [];
            player.trash = [];
            player.will = 10;
          }
          const item = api.createCardFromBase("thin_item", side);
          api.state.players[side].hand[0] = item;
          api.render();
          return { id: item.instanceId, seq: api.state.online.lastSnapshotSeq };
        }, { side, ownCount, targetCount });
        await expect.poll(() => guest.evaluate(() => window.__chibattle.state.online.lastSnapshotSeq)).toBeGreaterThanOrEqual(setup.seq);
        const allowed = ownCount <= 10 && targetCount <= 10;
        expect(await actor.evaluate((id) => {
          const api = window.__chibattle;
          return api.canUseHandCardNow(api.state.players.player.hand.find((card) => card.instanceId === id));
        }, setup.id)).toBe(allowed);
        if (!allowed) {
          await actor.evaluate((id) => {
            const api = window.__chibattle;
            api.beginItemUse(api.state.players.player.hand.find((card) => card.instanceId === id));
          }, setup.id);
          const rejected = await host.evaluate(({ side, id }) => {
            const api = window.__chibattle;
            const before = JSON.stringify(api.state.players);
            const used = api.castImmediateItem(side, api.state.players[side].hand.find((card) => card.instanceId === id), false);
            return { used, unchanged: before === JSON.stringify(api.state.players), pending: Boolean(api.state.pendingCardChoice || api.state.pendingRemoteHandTrim) };
          }, { side, id: setup.id });
          expect(rejected).toEqual({ used: false, unchanged: true, pending: false });
          continue;
        }
        await actor.evaluate((id) => {
          const api = window.__chibattle;
          api.beginItemUse(api.state.players.player.hand.find((card) => card.instanceId === id));
        }, setup.id);
        await expect.poll(() => target.evaluate(() => Boolean(window.__chibattle.state.pendingCardChoice))).toBe(true);
        const kept = await target.evaluate(() => {
          const api = window.__chibattle;
          const ids = api.state.players.player.hand.slice(0, 4).map((card) => card.instanceId);
          api.state.pendingCardChoice.selectedIds = ids;
          api.confirmCardChoiceSelection();
          return ids;
        });
        await expect.poll(() => actor.evaluate(() => window.__chibattle.state.players.opponent.hand.length)).toBe(4);
        await expect.poll(() => target.evaluate(() => window.__chibattle.state.players.player.hand.length)).toBe(4);
        expect(await target.evaluate(() => window.__chibattle.state.players.player.hand.map((card) => card.instanceId))).toEqual(kept);
        for (const page of [host, guest]) {
          const sourceSide = page === host ? side : side === "player" ? "opponent" : "player";
          const result = await page.evaluate((sourceSide) => {
            const api = window.__chibattle;
            const other = sourceSide === "player" ? "opponent" : "player";
            return { ownHand: api.state.players[sourceSide].hand.length, will: api.state.players[sourceSide].will,
              targetDeck: api.state.players[other].deck.length };
          }, sourceSide);
          expect(result).toEqual({ ownHand: 9, will: 6, targetDeck: 6 });
        }
      }
    }
    expect(errors).toEqual([]);
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
});
