const { test, expect } = require("@playwright/test");
const { spawn } = require("node:child_process");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const port = 18827;
const gameUrl = pathToFileURL(path.join(__dirname, "..", "index.html"));
gameUrl.searchParams.set("ws", `ws://127.0.0.1:${port}`);
let server;

test.beforeAll(async () => {
  server = spawn(process.execPath, [path.join(__dirname, "..", "server", "server.js")], {
    env: { ...process.env, PORT: String(port) }, stdio: ["ignore", "pipe", "pipe"]
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("オンラインテストサーバー起動タイムアウト")), 5000);
    server.stdout.on("data", (chunk) => {
      if (!String(chunk).includes("listening")) return;
      clearTimeout(timer);
      resolve();
    });
    server.once("error", reject);
  });
});

test.afterAll(() => server?.kill("SIGTERM"));

test("ゲストの敵の敵で選んだ山札上の順番をホストが検証して同期する", async ({ browser }) => {
  const contexts = await Promise.all([browser.newContext(), browser.newContext()]);
  const [host, guest] = await Promise.all(contexts.map((context) => context.newPage()));
  try {
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

    const setup = await host.evaluate(() => {
      const api = window.__chibattle;
      api.startCardTest("enemy_enemy");
      api.state.testMode = false;
      api.state.currentSide = "opponent";
      for (const side of ["player", "opponent"]) {
        const player = api.state.players[side];
        player.board = { teacher: null, seats: Array(9).fill(null) };
        player.hand = [];
        player.deck = [];
        player.trash = [];
        player.will = 10;
      }
      const enemy = api.makeBoardCard(api.createCardFromBase("enemy_student", "opponent"));
      const trueEnemy = api.makeBoardCard(api.createCardFromBase("true_enemy", "opponent"));
      api.state.players.opponent.board.seats[0] = enemy;
      api.state.players.opponent.board.seats[1] = trueEnemy;
      api.state.players.opponent.deck = Array.from({ length: 6 }, () => api.createCardFromBase("general_student", "opponent"));
      const card = api.createCardFromBase("enemy_enemy", "opponent");
      api.state.players.opponent.hand = [card];
      api.render();
      return { cardId: card.instanceId, enemyId: enemy.instanceId, trueEnemyId: trueEnemy.instanceId,
        seq: api.state.online.lastSnapshotSeq };
    });
    await expect.poll(() => guest.evaluate(() => window.__chibattle.state.online.lastSnapshotSeq)).toBeGreaterThanOrEqual(setup.seq);
    await guest.evaluate((cardId) => window.__chibattle.playCard(cardId, "seat", "player", 4), setup.cardId);
    await expect.poll(() => guest.evaluate(() => window.__chibattle.state.pendingCardChoice?.mode)).toBe("enemy_enemy_order");
    await guest.evaluate(([first, second]) => {
      const api = window.__chibattle;
      api.state.pendingCardChoice.selectedIds = [first, second];
      api.confirmCardChoiceSelection();
    }, [setup.trueEnemyId, setup.enemyId]);
    for (const page of [host, guest]) {
      await expect.poll(() => page.evaluate(() => {
        const api = window.__chibattle;
        const side = api.state.online.role === "host" ? "opponent" : "player";
        return api.state.players[side].deck.slice(0, 2).map((card) => card.baseId);
      })).toEqual(["true_enemy", "enemy_student"]);
    }
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
});

test("ゲストの真の敵から出た三敵の順番選択を通信で完了できる", async ({ browser }) => {
  const contexts = await Promise.all([browser.newContext(), browser.newContext()]);
  const [host, guest] = await Promise.all(contexts.map((context) => context.newPage()));
  try {
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

    await host.evaluate(() => {
      const api = window.__chibattle;
      api.startCardTest("true_enemy");
      api.state.testMode = false;
      api.state.currentSide = "opponent";
      for (const side of ["player", "opponent"]) {
        const player = api.state.players[side];
        player.board = { teacher: null, seats: Array(9).fill(null) };
        player.hand = [];
        player.deck = [];
        player.trash = [];
      }
      const attacker = api.makeBoardCard(api.createCardFromBase("true_enemy", "opponent"));
      api.state.players.opponent.board.seats[0] = attacker;
      api.state.players.opponent.deck = [api.createCardFromBase("triple_enemy", "opponent"),
        api.createCardFromBase("enemy_horde", "opponent"),
        api.createCardFromBase("enemy_student", "opponent")];
      api.markCardAttackUsed(attacker);
      api.render();
      api.onlineBroadcastState(true);
    });
    await expect.poll(() => guest.evaluate(() => window.__chibattle.state.pendingCardChoice?.mode))
      .toBe("triple_enemy_online_response");
    await guest.evaluate(() => {
      const api = window.__chibattle;
      const choice = api.state.pendingCardChoice;
      const enemy = choice.cards.find((card) => card.baseId === "enemy_student");
      const horde = choice.cards.find((card) => card.baseId === "enemy_horde");
      choice.selectedIds = [enemy.instanceId, horde.instanceId];
      api.confirmCardChoiceSelection();
    });
    for (const page of [host, guest]) {
      await expect.poll(() => page.evaluate(() => {
        const api = window.__chibattle;
        const side = api.state.online.role === "host" ? "opponent" : "player";
        const board = api.state.players[side].board.seats.filter(Boolean).map((card) => card.baseId);
        return { horde: board.includes("enemy_horde"), enemyCount: board.filter((id) => id === "enemy_student").length };
      })).toEqual({ horde: true, enemyCount: 2 });
    }
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
});
