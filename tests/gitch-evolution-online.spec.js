const { test, expect } = require("@playwright/test");
const { spawn } = require("node:child_process");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const port = 18811;
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

async function openBattle(host, guest) {
  for (const page of [host, guest]) {
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
}


test("木っち・技議っち・偽魏義ッ血・怨念をホストとゲストの両視点で同期する", async ({ browser }) => {
  test.setTimeout(60000);
  const contexts = await Promise.all([browser.newContext(), browser.newContext()]);
  const [host, guest] = await Promise.all(contexts.map(c => c.newPage()));
  const errors = [];
  try {
    for (const page of [host, guest]) page.on("pageerror", e => errors.push(e.message));
    await openBattle(host, guest);
    for (const side of ["player", "opponent"]) {
      const actor = side === "player" ? host : guest;
      for (const baseId of ["wood_gitch", "gitch", "gigi_blood", "grudge"]) {
        const setup = await host.evaluate(({ side, baseId }) => {
          const api = window.__chibattle;
          api.startCardTest(baseId);
          api.state.testMode = false; api.state.currentSide = side; api.state.environment = null;
          for (const owner of ["player", "opponent"]) {
            const own = api.state.players[owner];
            own.board.seats.fill(null); own.board.teacher = null; own.hand = []; own.trash = [];
            own.will = 10; own.maxWill = 10; own.life = 20; own.attendancesThisTurn = 0;
            own.deck = Array.from({ length: 8 }, () => api.createCardFromBase("general_student", owner));
          }
          const own = api.state.players[side], card = api.createCardFromBase(baseId, side);
          own.hand = [card, api.createCardFromBase("ruler", side)];
          const parentId = api.CARD_BASES[baseId].evolutionFrom;
          if (parentId) {
            const parent = api.makeBoardCard(api.createCardFromBase(parentId, side));
            parent.playedOnTurn = api.state.actionTurn - 1;
            own.board.seats[4] = parent;
          }
          api.render();
          return { id: card.instanceId, seq: api.state.online.lastSnapshotSeq };
        }, { side, baseId });
        await expect.poll(() => guest.evaluate(() => window.__chibattle.state.online.lastSnapshotSeq)).toBeGreaterThanOrEqual(setup.seq);
        await actor.evaluate(({ id, baseId }) => {
          const api = window.__chibattle;
          if (baseId === "grudge") api.beginItemUse(api.state.players.player.hand.find(c => c.instanceId === id));
          else api.playCard(id, "seat", "player", 4);
        }, { id: setup.id, baseId });
        const expectedHand = baseId === "wood_gitch" ? ["ruler", "wood_gitch"]
          : baseId === "gitch" ? ["ruler", "general_student", "general_student"]
          : baseId === "gigi_blood" ? ["grudge"] : ["ruler"];
        for (const page of [host, guest]) {
          const viewSide = page === host ? side : side === "player" ? "opponent" : "player";
          await expect.poll(() => page.evaluate(viewSide => window.__chibattle.state.players[viewSide].hand.length, viewSide)).toBe(expectedHand.length);
          if (page === host || page === actor) {
            await expect.poll(() => page.evaluate(viewSide => window.__chibattle.state.players[viewSide].hand.map(c => c.baseId), viewSide)).toEqual(expectedHand);
          } else {
            expect(await page.evaluate(viewSide => window.__chibattle.state.players[viewSide].hand.every(c => !c.baseId), viewSide)).toBe(true);
          }
          expect(await page.evaluate(({ viewSide, baseId }) => {
            const api = window.__chibattle, own = api.state.players[viewSide];
            const other = viewSide === "player" ? "opponent" : "player";
            return { will: own.will, deck: own.deck.length,
              generated: [...own.board.seats, own.board.teacher].filter(c => c?.baseId === "wood_gitch").length,
              life: api.state.players[other].life,
              pending: Boolean(api.state.pendingCardChoice || api.state.pendingCopiedCard) };
          }, { viewSide, baseId })).toEqual({ will: 10 - { wood_gitch: 3, gitch: 0, gigi_blood: 8, grudge: 1 }[baseId],
            deck: baseId === "gitch" ? 6 : 8, generated: baseId === "wood_gitch" ? 1 : baseId === "gitch" ? 2 : 0,
            life: baseId === "grudge" ? 18 : 20, pending: false });
        }
        const positions = await host.evaluate(side => [...window.__chibattle.state.players[side].board.seats, window.__chibattle.state.players[side].board.teacher].map(c => c?.instanceId || null), side);
        const guestSide = side === "player" ? "opponent" : "player";
        expect(await guest.evaluate(side => [...window.__chibattle.state.players[side].board.seats, window.__chibattle.state.players[side].board.teacher].map(c => c?.instanceId || null), guestSide)).toEqual(positions);
      }
    }
    expect(errors).toEqual([]);
  } finally { await Promise.all(contexts.map(c => c.close())); }
});
