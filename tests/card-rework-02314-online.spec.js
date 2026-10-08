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

test("ホストのアクティングアウトマンはゲストの2回目の出席を止めて同期する", async ({ browser }) => {
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
      api.startCardTest("acting_out_man");
      const { state } = api;
      state.testMode = false;
      state.currentSide = "opponent";
      for (const side of ["player", "opponent"]) {
        const player = state.players[side];
        player.board = { teacher: null, seats: Array(9).fill(null) };
        player.hand = [];
        player.trash = [];
        player.life = 20;
        player.will = 6;
      }
      const actor = api.makeBoardCard(api.createCardFromBase("acting_out_man", "player"));
      state.players.player.board.seats[0] = actor;
      const first = api.createCardFromBase("general_student", "opponent");
      const second = api.createCardFromBase("general_student", "opponent");
      state.players.opponent.hand = [first, second];
      state.environment = null;
      api.onlineBroadcastState(true);
      return { firstId: first.instanceId, secondId: second.instanceId,
        seq: state.online.lastSnapshotSeq };
    });
    await expect.poll(() => guest.evaluate(() => window.__chibattle.state.online.lastSnapshotSeq))
      .toBeGreaterThanOrEqual(setup.seq);
    await expect.poll(() => guest.evaluate(() => {
      const { state } = window.__chibattle;
      return { phase: state.phase, currentSide: state.currentSide,
        hand: state.players.player.hand.map((card) => card.baseId), actorHp: state.players.opponent.board.seats[0]?.currentHp };
    })).toEqual({ phase: "battle", currentSide: "player",
      hand: ["general_student", "general_student"], actorHp: 3 });
    await guest.evaluate((id) => window.__chibattle.playCard(id, "seat", "player", 0), setup.firstId);
    for (const page of [host, guest]) {
      await expect.poll(() => page.evaluate(() => {
        const api = window.__chibattle;
        const side = api.state.online.role === "host" ? "opponent" : "player";
        return {
          first: api.state.players[side].board.seats[0]?.baseId,
          attendanceCount: api.state.players[side].attendancesThisTurn,
          secondAvailable: api.canPlaceCard(side, api.state.players[side].hand[0], "seat", side, 1)
        };
      })).toEqual({ first: "general_student", attendanceCount: 1, secondAvailable: false });
    }
    await guest.evaluate((id) => window.__chibattle.playCard(id, "seat", "player", 1), setup.secondId);
    await expect.poll(() => guest.evaluate(() => window.__chibattle.state.online.pendingTurnCommandId)).toBeFalsy();
    for (const page of [host, guest]) {
      const result = await page.evaluate(() => {
        const api = window.__chibattle;
        const side = api.state.online.role === "host" ? "opponent" : "player";
        return { second: api.state.players[side].board.seats[1]?.baseId || null,
          held: api.state.players[side].hand.some((card) => card.baseId === "general_student"),
          will: api.state.players[side].will };
      });
      expect(result).toEqual({ second: null, held: true, will: 4 });
    }
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
});

test("双方のスタバ学生が引いたガン詰め講師の効果選択を同期する", async ({ browser }) => {
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
      api.startCardTest("starbucks_student");
      const { state } = api;
      state.testMode = false;
      state.currentSide = "opponent";
      for (const side of ["player", "opponent"]) {
        const player = state.players[side];
        player.board = { teacher: null, seats: Array(9).fill(null) };
        player.hand = [];
        player.deck = [];
        player.trash = [];
        player.life = 20;
        player.will = 7;
      }
      const student = api.createCardFromBase("starbucks_student", "opponent");
      state.players.opponent.hand = [student];
      state.players.opponent.trash = [api.createCardFromBase("cornering_lecturer", "opponent")];
      api.onlineBroadcastState(true);
      return { studentId: student.instanceId, seq: state.online.lastSnapshotSeq };
    });
    await expect.poll(() => guest.evaluate(() => window.__chibattle.state.online.lastSnapshotSeq))
      .toBeGreaterThanOrEqual(setup.seq);
    await expect.poll(() => guest.evaluate(() => {
      const { state } = window.__chibattle;
      return { currentSide: state.currentSide, hand: state.players.player.hand.map((card) => card.baseId),
        trash: state.players.player.trash.map((card) => card.baseId) };
    })).toEqual({ currentSide: "player", hand: ["starbucks_student"], trash: ["cornering_lecturer"] });
    await guest.evaluate((id) => window.__chibattle.playCard(id, "seat", "player", 0), setup.studentId);
    await expect.poll(() => guest.evaluate(() => window.__chibattle.state.pendingCardChoice?.mode))
      .toBe("starbucks_cornering_online_response");
    await guest.evaluate(() => {
      const api = window.__chibattle;
      api.state.pendingCardChoice.selectedIds = ["cornering_lecturer_generate"];
      api.confirmCardChoiceSelection();
    });
    for (const page of [host, guest]) {
      await expect.poll(() => page.evaluate(() => {
        const api = window.__chibattle;
        const side = api.state.online.role === "host" ? "opponent" : "player";
        const player = api.state.players[side];
        return { student: player.board.seats[0]?.baseId, studentHp: player.board.seats[0]?.currentHp,
          teacher: player.board.teacher?.baseId, source: player.board.teacher?.lastAttendanceSource,
          generated: player.deck.filter((card) => card.baseId === "scary_question").length,
          will: player.will };
      })).toEqual({ student: "starbucks_student", studentHp: 2, teacher: "cornering_lecturer",
        source: "hand", generated: 10, will: 0 });
    }
    await expect.poll(() => guest.evaluate(() => window.__chibattle.state.online.pendingTurnCommandId)).toBeFalsy();

    const hostSetup = await host.evaluate(() => {
      const api = window.__chibattle;
      const { state } = api;
      state.currentSide = "player";
      for (const side of ["player", "opponent"]) {
        const player = state.players[side];
        player.board = { teacher: null, seats: Array(9).fill(null) };
        player.hand = [];
        player.deck = [];
        player.trash = [];
        player.will = 7;
        player.attendancesThisTurn = 0;
      }
      const student = api.createCardFromBase("starbucks_student", "player");
      state.players.player.hand = [student];
      state.players.player.trash = [api.createCardFromBase("cornering_lecturer", "player")];
      api.onlineBroadcastState(true);
      return { studentId: student.instanceId, seq: state.online.lastSnapshotSeq };
    });
    await expect.poll(() => guest.evaluate(() => window.__chibattle.state.online.lastSnapshotSeq))
      .toBeGreaterThanOrEqual(hostSetup.seq);
    await host.evaluate((id) => window.__chibattle.playCard(id, "seat", "player", 0), hostSetup.studentId);
    await expect.poll(() => host.evaluate(() => window.__chibattle.state.pendingCardChoice?.mode))
      .toBe("starbucks_cornering_teacher");
    await host.evaluate(() => {
      const api = window.__chibattle;
      api.state.pendingCardChoice.selectedIds = ["cornering_lecturer_generate"];
      api.confirmCardChoiceSelection();
    });
    for (const page of [host, guest]) {
      await expect.poll(() => page.evaluate(() => {
        const api = window.__chibattle;
        const side = api.state.online.role === "host" ? "player" : "opponent";
        const player = api.state.players[side];
        return { student: player.board.seats[0]?.baseId, teacher: player.board.teacher?.baseId,
          source: player.board.teacher?.lastAttendanceSource,
          generated: player.deck.filter((card) => card.baseId === "scary_question").length };
      })).toEqual({ student: "starbucks_student", teacher: "cornering_lecturer",
        source: "hand", generated: 10 });
    }
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
});

test("ゲストの敵の敵は順番選択なしで山札へ戻して両者に同期する", async ({ browser }) => {
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
    for (const page of [host, guest]) {
      await expect.poll(() => page.evaluate(() => {
        const api = window.__chibattle;
        const side = api.state.online.role === "host" ? "opponent" : "player";
        const player = api.state.players[side];
        return ["enemy_student", "true_enemy"].every((baseId) => player.deck.some((card) => card.baseId === baseId))
          && player.board.seats[4]?.baseId === "enemy_enemy"
          && !player.board.seats[0] && !player.board.seats[1];
      })).toBe(true);
    }
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
});

test("ゲストの三敵から出た復活の敵は校外の敵を選んで同期できる", async ({ browser }) => {
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
      api.startCardTest("triple_enemy");
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
      const player = api.state.players.opponent;
      const triple = api.createCardFromBase("triple_enemy", "opponent");
      const revive = api.createCardFromBase("enemy_revive", "opponent");
      const enemy = api.createCardFromBase("enemy_student", "opponent");
      player.hand = [triple];
      player.deck = [revive];
      player.trash = [enemy];
      api.render();
      api.onlineBroadcastState(true);
      return { tripleId: triple.instanceId, reviveId: revive.instanceId, enemyId: enemy.instanceId };
    });
    await expect.poll(() => guest.evaluate((id) => window.__chibattle.state.players.player.hand
      .some((card) => card.instanceId === id), setup.tripleId)).toBe(true);
    await guest.evaluate((id) => window.__chibattle.playCard(id, "seat", "player", 4), setup.tripleId);
    await expect.poll(() => guest.evaluate(() => window.__chibattle.state.pendingCardChoice?.mode))
      .toBe("triple_enemy");
    await guest.locator(`#threeGesturesHand [data-card-id="${setup.reviveId}"]`).click();
    await guest.locator("#threeGesturesConfirmButton").click();
    await expect.poll(() => guest.evaluate(() => window.__chibattle.state.pendingCardChoice?.mode))
      .toBe("enemy_revive_online_response");
    await expect(guest.locator("#threeGesturesConfirmButton")).toBeEnabled();
    await guest.locator(`#threeGesturesHand [data-card-id="${setup.enemyId}"]`).click();
    await guest.locator("#threeGesturesConfirmButton").click();
    for (const page of [host, guest]) {
      await expect.poll(() => page.evaluate((ids) => {
        const api = window.__chibattle;
        const side = api.state.online.role === "host" ? "opponent" : "player";
        const player = api.state.players[side];
        return [ids.tripleId, ids.reviveId, ids.enemyId]
          .every((id) => player.board.seats.some((card) => card?.instanceId === id))
          && !player.trash.some((card) => card.instanceId === ids.enemyId);
      }, setup)).toBe(true);
    }
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
});

for (const scenario of [
  { name: "全員", revealed: ["enemy_horde", "enemy_student"], selected: ["enemy_student", "enemy_horde"], expected: { horde: true, enemyCount: 2, hordeInHand: false } },
  { name: "一部", revealed: ["enemy_horde", "enemy_student"], selected: ["enemy_student"], expected: { horde: false, enemyCount: 1, hordeInHand: true } },
  { name: "0人", revealed: ["enemy_horde", "enemy_student"], selected: [], expected: { horde: false, enemyCount: 0, hordeInHand: true } },
  { name: "候補1人を残す", revealed: ["enemy_horde"], selected: [], expected: { horde: false, enemyCount: 0, hordeInHand: true } }
]) test(`ゲストの真の敵から出た三敵は${scenario.name}を選んで同期できる`, async ({ browser }) => {
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

    await host.evaluate((revealed) => {
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
        ...revealed.map((baseId) => api.createCardFromBase(baseId, "opponent"))];
      api.markCardAttackUsed(attacker);
      api.render();
      api.onlineBroadcastState(true);
    }, scenario.revealed);
    await expect.poll(() => guest.evaluate(() => window.__chibattle.state.pendingCardChoice?.mode))
      .toBe("triple_enemy_online_response");
    await expect(guest.locator("#threeGesturesConfirmButton")).toBeEnabled();
    await guest.evaluate((selected) => {
      const api = window.__chibattle;
      const choice = api.state.pendingCardChoice;
      choice.selectedIds = selected.map((baseId) => choice.cards.find((card) => card.baseId === baseId).instanceId);
      api.confirmCardChoiceSelection();
    }, scenario.selected);
    for (const page of [host, guest]) {
      await expect.poll(() => page.evaluate(() => {
        const api = window.__chibattle;
        const side = api.state.online.role === "host" ? "opponent" : "player";
        const board = api.state.players[side].board.seats.filter(Boolean).map((card) => card.baseId);
        return { horde: board.includes("enemy_horde"), enemyCount: board.filter((id) => id === "enemy_student").length,
          hordeInHand: api.state.players[side].hand.some((card) => card.baseId === "enemy_horde") };
      })).toEqual(scenario.expected);
    }
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
});
