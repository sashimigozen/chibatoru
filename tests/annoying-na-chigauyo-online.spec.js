const { test, expect } = require("@playwright/test");
const { spawn } = require("node:child_process");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const port = 18810;
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

test("ホスト・ゲストのちがうよは最大戦意に関係なく、戻した手札の半分を引く", async ({ browser }) => {
  const contexts = await Promise.all([browser.newContext(), browser.newContext()]);
  const [host, guest] = await Promise.all(contexts.map((context) => context.newPage()));
  const errors = [];
  try {
    for (const page of [host, guest]) page.on("pageerror", (error) => errors.push(error.message));
    await openBattle(host, guest);
    for (const side of ["player", "opponent"]) {
      const actor = side === "player" ? host : guest;
      for (const [ownMax, otherMax] of [[9, 10], [10, 9], [10, 10]]) {
        const setup = await host.evaluate(({ side, ownMax, otherMax }) => {
          const api = window.__chibattle;
          api.startCardTest("chigauyo");
          api.state.currentSide = side;
          api.state.testMode = false;
          const other = side === "player" ? "opponent" : "player";
          for (const owner of [side, other]) {
            const player = api.state.players[owner];
            player.maxWill = owner === side ? ownMax : otherMax;
            player.will = owner === side ? 3 : 0;
            player.hand = [api.createCardFromBase("general_student", owner)];
            player.deck = Array.from({ length: 8 }, () => api.createCardFromBase("general_teacher", owner));
            player.trash = [];
          }
          const item = api.createCardFromBase("chigauyo", side);
          api.state.players[side].hand.unshift(item);
          api.render();
          return { id: item.instanceId, seq: api.state.online.lastSnapshotSeq };
        }, { side, ownMax, otherMax });
        await expect.poll(() => guest.evaluate(() => window.__chibattle.state.online.lastSnapshotSeq)).toBeGreaterThanOrEqual(setup.seq);
        expect(await actor.evaluate((id) => {
          const api = window.__chibattle;
          return api.canUseHandCardNow(api.state.players.player.hand.find((card) => card.instanceId === id));
        }, setup.id)).toBe(true);
        await actor.evaluate((id) => {
          const api = window.__chibattle;
          api.beginItemUse(api.state.players.player.hand.find((card) => card.instanceId === id));
        }, setup.id);
        for (const page of [host, guest]) {
          await expect.poll(() => page.evaluate(() => ["player", "opponent"].map((owner) => window.__chibattle.state.players[owner].hand.length))).toEqual([1, 1]);
          const actorSide = page === actor ? "player" : "opponent";
          expect(await page.evaluate((actorSide) => {
            const own = window.__chibattle.state.players[actorSide];
            return { will: own.will, deck: own.deck.length, used: own.trash.some((card) => card.baseId === "chigauyo") };
          }, actorSide)).toEqual({ will: 0, deck: 8, used: true });
        }
      }
    }
    expect(errors).toEqual([]);
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
});

test("ホスト・ゲストの煩わしいなぁは戦意5・残り1回を同期し各自のターン終了で消える", async ({ browser }) => {
  const contexts = await Promise.all([browser.newContext(), browser.newContext()]);
  const [host, guest] = await Promise.all(contexts.map((context) => context.newPage()));
  const errors = [];
  try {
    for (const page of [host, guest]) page.on("pageerror", (error) => errors.push(error.message));
    await openBattle(host, guest);
    for (const side of ["player", "opponent"]) {
      const actor = side === "player" ? host : guest;
      const setup = await host.evaluate((side) => {
        const api = window.__chibattle;
        api.startCardTest("annoying_na");
        api.state.currentSide = side;
        api.state.testMode = false;
        api.state.environment = null;
        for (const owner of ["player", "opponent"]) {
          const player = api.state.players[owner];
          player.board.seats = Array(9).fill(null);
          player.board.teacher = null;
          player.hand = [];
          player.turnActionTaken = false;
        }
        const item = api.createCardFromBase("annoying_na", side);
        api.state.players[side].hand = [item];
        api.state.players[side].will = 5;
        api.render();
        return { id: item.instanceId, seq: api.state.online.lastSnapshotSeq };
      }, side);
      await expect.poll(() => guest.evaluate(() => window.__chibattle.state.online.lastSnapshotSeq)).toBeGreaterThanOrEqual(setup.seq);
      await actor.evaluate((id) => {
        const api = window.__chibattle;
        api.beginItemUse(api.state.players.player.hand.find((card) => card.instanceId === id));
      }, setup.id);
      for (const page of [host, guest]) {
        await expect.poll(() => page.evaluate(() => ["player", "opponent"].map((owner) => window.__chibattle.state.players[owner].effectUseLockTurnsRemaining))).toEqual([1, 1]);
        const actorSide = page === actor ? "player" : "opponent";
        expect(await page.evaluate((actorSide) => window.__chibattle.state.players[actorSide].will, actorSide)).toBe(0);
        await expect(page.locator("#playerActiveEffectsSummary")).toContainText("煩わしいなぁ");
        await expect(page.locator("#opponentActiveEffectsSummary")).toContainText("煩わしいなぁ");
      }
      for (const owner of [side, side === "player" ? "opponent" : "player"]) {
        await host.evaluate((owner) => {
          const api = window.__chibattle;
          api.resolveEndTurnEffects(owner);
          api.render();
        }, owner);
        for (const page of [host, guest]) {
          const viewSide = page === host ? owner : owner === "player" ? "opponent" : "player";
          await expect.poll(() => page.evaluate((viewSide) => window.__chibattle.state.players[viewSide].effectUseLockTurnsRemaining, viewSide)).toBe(0);
          await expect(page.locator(`#${viewSide}ActiveEffectsSummary`)).toHaveText("現在なし");
        }
      }
    }
    expect(errors).toEqual([]);
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
});
