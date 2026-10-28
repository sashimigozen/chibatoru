const { test, expect } = require("@playwright/test");
const { spawn } = require("node:child_process");
const net = require("node:net");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
let server, gameUrl;

test.beforeAll(async () => {
  const port = await new Promise(resolve => {
    const probe = net.createServer();
    probe.listen(0, "127.0.0.1", () => { const port = probe.address().port; probe.close(() => resolve(port)); });
  });
  gameUrl = pathToFileURL(path.join(__dirname, "..", "index.html"));
  gameUrl.searchParams.set("ws", `ws://127.0.0.1:${port}`);
  server = spawn(process.execPath, [path.join(__dirname, "..", "server", "server.js")], {
    env: { ...process.env, PORT: String(port) }, stdio: ["ignore", "pipe", "pipe"]
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("server startup timeout")), 5000);
    server.stdout.on("data", chunk => { if (String(chunk).includes("listening")) { clearTimeout(timer); resolve(); } });
    server.once("error", reject);
  });
});
test.afterAll(() => server?.kill("SIGTERM"));

test("実WebSocketでホスト・ゲスト双方の負荷付与・2人破壊・手札からの無料出席が同期する", async ({ browser }) => {
  test.setTimeout(120000);
  const contexts = await Promise.all([browser.newContext(), browser.newContext()]);
  const [host, guest] = await Promise.all(contexts.map(context => context.newPage()));
  const errors = [];
  try {
    for (const page of [host, guest]) {
      page.on("pageerror", error => errors.push(error.message));
      await page.goto(gameUrl.href);
      await page.locator("#homeNavBattleButton").click();
      await page.locator("#onlinePrivateMatchButton").click();
    }
    await host.locator("#onlineCreateRoomButton").click();
    await expect.poll(() => host.evaluate(() => state.online.role)).toBe("host");
    await guest.locator("#onlineRoomInput").fill(await host.evaluate(() => state.online.roomCode));
    await guest.locator("#onlineJoinRoomButton").click();
    for (const page of [host, guest]) {
      await expect.poll(() => page.evaluate(() => state.online.connected)).toBe(true);
      await page.evaluate(() => {
        state.deckBuilder.counts.player = createAutoDeckCounts();
        document.getElementById("onlineDeckSelect").dispatchEvent(new Event("change", { bubbles: true }));
      });
      await page.locator("#onlineReadyButton").click();
    }
    await expect.poll(() => host.evaluate(() => state.online.remoteReady)).toBe(true);
    await host.locator("#onlineStartButton").click();
    await expect.poll(() => guest.evaluate(() => state.online.started)).toBe(true);

    for (const [actor, side] of [[host, "player"], [guest, "opponent"]]) {
      for (const id of ["philosophy_cheating", "namen_tenno", "brother_capital"]) {
        const setup = await host.evaluate(({ id, side }) => {
          startCardTest(id);
          state.testMode = false; state.training.skipAnimations = true;
          state.currentSide = side; state.environment = null;
          for (const owner of ["player", "opponent"]) Object.assign(state.players[owner], {
            hand: [], deck: [], trash: [], late: [], board: { teacher: null, seats: Array(9).fill(null) },
            will: 10, maxWill: 10, life: 20
          });
          const own = state.players[side], otherSide = oppositeSide(side), other = state.players[otherSide];
          const item = createCardFromBase(id, side); own.hand = [item];
          if (id === "philosophy_cheating") {
            other.hand = [createCardFromBase("general_teacher", otherSide), createCardFromBase("cafeteria", otherSide)];
            other.hand[1].handLoadLevel = 1;
          }
          if (id === "namen_tenno") {
            ["cafeteria_lady", "vampire", "zombie"].forEach((base, i) => { other.board.seats[i] = makeBoardCard(createCardFromBase(base, otherSide)); });
          }
          if (id === "brother_capital") {
            own.will = 6;
            own.hand.push(createCardFromBase("best_friend", side), createCardFromBase("general_student", side));
            own.deck = [createCardFromBase("loud_student", side)];
          }
          render();
          return { seq: state.online.lastSnapshotSeq, itemId: item.instanceId };
        }, { id, side });
        await expect.poll(() => guest.evaluate(() => state.online.lastSnapshotSeq)).toBeGreaterThanOrEqual(setup.seq);
        for (const page of [host, guest]) await expect.poll(() => page.evaluate(() => battlePresentationBusy())).toBe(false);
        await actor.evaluate(itemId => beginItemUse(state.players.player.hand.find(card => card.instanceId === itemId)), setup.itemId);
        await expect.poll(() => actor.evaluate(() => Boolean(state.pendingCardChoice))).toBe(true);
        await actor.evaluate(id => {
          const choice = state.pendingCardChoice;
          const targets = id === "philosophy_cheating" ? [choice.cards[1]] : choice.cards.slice(0, 2);
          targets.forEach(card => toggleCardChoiceCard(card.instanceId));
          confirmCardChoiceSelection();
        }, id);
        if (id === "philosophy_cheating") {
          const targetOwner = side === "player" ? "opponent" : "player";
          await expect.poll(() => host.evaluate(owner => state.players[owner].hand[1]?.handLoadLevel, targetOwner)).toBe(2);
          const holder = actor === host ? guest : host;
          await expect.poll(() => holder.evaluate(() => state.players.player.hand[1]?.handLoadLevel)).toBe(2);
          expect(await host.evaluate(owner => state.players[owner].hand.length, targetOwner)).toBe(2);
        } else if (id === "namen_tenno") {
          await expect.poll(() => host.evaluate(side => state.players[oppositeSide(side)].board.seats.filter(Boolean).length, side)).toBe(1);
          for (const page of [host, guest]) expect(await page.evaluate(() => [state.players.player.life, state.players.opponent.life])).toEqual([20, 20]);
        } else {
          for (const index of [0, 1]) {
            await expect.poll(() => actor.evaluate(() => Boolean(state.pendingCopiedCard))).toBe(true);
            await expect.poll(() => actor.evaluate(() => battlePresentationBusy())).toBe(false);
            expect(await actor.evaluate(index => placePendingCopiedCard("seat", "player", index), index)).toBe(true);
            await expect.poll(() => host.evaluate(({ side, index }) => Boolean(state.players[side].board.seats[index]), { side, index })).toBe(true);
          }
          for (const page of [host, guest]) {
            const owner = page === host ? side : side === "player" ? "opponent" : "player";
            await expect.poll(() => page.evaluate(owner => state.players[owner].will, owner)).toBe(0);
            expect(await page.evaluate(owner => state.players[owner].board.seats.slice(0, 2).map(card => card?.lastAttendanceSource), owner)).toEqual(["hand", "hand"]);
          }
          await expect.poll(() => actor.evaluate(() => state.players.player.hand.map(card => card.baseId))).toEqual(["loud_student"]);
        }
      }
    }
    expect(errors).toEqual([]);
  } finally {
    await Promise.all(contexts.map(context => context.close()));
  }
});
