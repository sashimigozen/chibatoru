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

test("ハンディジェットエンジンの自分1枚・相手2枚の校外送りをホストとゲストで同期する", async ({ browser }) => {
  test.setTimeout(60000);
  const contexts = await Promise.all([browser.newContext(), browser.newContext()]);
  const [host, guest] = await Promise.all(contexts.map(c => c.newPage()));
  const errors = [];
  try {
    for (const page of [host, guest]) page.on("pageerror", e => errors.push(e.message));
    await openBattle(host, guest);
    for (const side of ["player", "opponent"]) {
      const actor = side === "player" ? host : guest;
      const setup = await host.evaluate(side => {
        const api = window.__chibattle;
        api.startCardTest("handy_jet_engine");
        api.state.testMode = false; api.state.currentSide = side;
        for (const owner of ["player", "opponent"]) {
          const own = api.state.players[owner];
          own.hand = (owner === side ? ["handy_jet_engine", "ruler", "bento"] : ["general_student", "general_teacher", "cafeteria"])
            .map(id => api.createCardFromBase(id, owner));
          own.trash = []; own.will = 10;
        }
        const id = api.state.players[side].hand[0].instanceId;
        api.render();
        return { id, seq: api.state.online.lastSnapshotSeq };
      }, side);
      await expect.poll(() => guest.evaluate(() => window.__chibattle.state.online.lastSnapshotSeq)).toBeGreaterThanOrEqual(setup.seq);
      await actor.evaluate(id => {
        const api = window.__chibattle;
        api.beginItemUse(api.state.players.player.hand.find(c => c.instanceId === id));
      }, setup.id);
      for (const page of [host, guest]) {
        const viewSide = page === host ? side : side === "player" ? "opponent" : "player";
        await expect.poll(() => page.evaluate(({ viewSide, id }) => {
          const api = window.__chibattle, own = api.state.players[viewSide], other = api.state.players[viewSide === "player" ? "opponent" : "player"];
          return { ownHand: own.hand.length, otherHand: other.hand.length, ownTrash: own.trash.length,
            otherTrash: other.trash.length, sourceCount: own.trash.filter(c => c.instanceId === id).length, will: own.will };
        }, { viewSide, id: setup.id })).toEqual({ ownHand: 1, otherHand: 1, ownTrash: 2, otherTrash: 2, sourceCount: 1, will: 7 });
      }
      const hostTrash = await host.evaluate(() => ["player", "opponent"].map(side => window.__chibattle.state.players[side].trash.map(c => c.instanceId)));
      expect(await guest.evaluate(() => ["opponent", "player"].map(side => window.__chibattle.state.players[side].trash.map(c => c.instanceId)))).toEqual(hostTrash);
    }
    expect(errors).toEqual([]);
  } finally { await Promise.all(contexts.map(c => c.close())); }
});


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
            if (baseId === "wood_gitch") {
              expect(await page.evaluate(viewSide => {
                const api = window.__chibattle, generated = api.state.players[viewSide].hand.at(-1);
                return [api.cardRulesText(generated), api.canUsePrintedCardEffects(generated), generated.noLecture];
              }, viewSide)).toEqual(["効果なし。", false, true]);
            }
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
          if (baseId === "gitch") {
            expect(await page.evaluate(viewSide => {
              const api = window.__chibattle, own = api.state.players[viewSide];
              return { turn: own.board.seats[4].evolvedOnTurn,
                allowed: api.canPlaceCard(viewSide, api.createCardFromBase("gigi_blood", viewSide), "seat", viewSide, 4),
                current: api.state.actionTurn };
            }, viewSide)).toMatchObject({ turn: await page.evaluate(() => window.__chibattle.state.actionTurn), allowed: false });
            expect(await page.evaluate(viewSide => {
              const api = window.__chibattle, board = api.state.players[viewSide].board;
              return [...board.seats, board.teacher].filter(c => c?.baseId === "wood_gitch")
                .map(c => [api.cardRulesText(c), api.canUsePrintedCardEffects(c), c.noLecture]);
            }, viewSide)).toEqual([["効果なし。", false, true], ["効果なし。", false, true]]);
          }
        }
        const positions = await host.evaluate(side => [...window.__chibattle.state.players[side].board.seats, window.__chibattle.state.players[side].board.teacher].map(c => c?.instanceId || null), side);
        const guestSide = side === "player" ? "opponent" : "player";
        expect(await guest.evaluate(side => [...window.__chibattle.state.players[side].board.seats, window.__chibattle.state.players[side].board.teacher].map(c => c?.instanceId || null), guestSide)).toEqual(positions);
        if (baseId === "wood_gitch") {
          // A synchronized generated Wood must not generate another copy when played.
          await actor.evaluate(() => {
            const api = window.__chibattle, generated = api.state.players.player.hand.at(-1);
            api.playCard(generated.instanceId, "seat", "player", 5);
          });
          for (const page of [host, guest]) {
            const viewSide = page === host ? side : guestSide;
            await expect.poll(() => page.evaluate(viewSide => {
              const api = window.__chibattle, own = api.state.players[viewSide];
              return { hand: own.hand.length, text: own.board.seats[5] ? api.cardRulesText(own.board.seats[5]) : null,
                effects: api.canUsePrintedCardEffects(own.board.seats[5]) };
            }, viewSide)).toEqual({ hand: 1, text: "効果なし。", effects: false });
          }
        }
      }
    }
    expect(errors).toEqual([]);
  } finally { await Promise.all(contexts.map(c => c.close())); }
});
