const { test, expect } = require("@playwright/test");
const { spawn } = require("node:child_process");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const port = 18787;
const externalWsUrl = process.env.CHIBATORU_TEST_WS_URL || "";
const wsUrl = externalWsUrl || `ws://127.0.0.1:${port}`;
const gameFileUrl = pathToFileURL(path.join(__dirname, "..", "index.html"));
gameFileUrl.searchParams.set("ws", wsUrl);
const gameUrl = gameFileUrl.href;
let serverProcess;

test.beforeAll(async () => {
  if (externalWsUrl) return;
  serverProcess = spawn(process.execPath, [path.join(__dirname, "..", "server", "server.js")], {
    env: { ...process.env, PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"]
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("オンラインテストサーバーの起動がタイムアウトしました。")), 5000);
    const onData = (chunk) => {
      if (!String(chunk).includes("listening")) return;
      clearTimeout(timer);
      resolve();
    };
    serverProcess.stdout.on("data", onData);
    serverProcess.once("error", reject);
    serverProcess.once("exit", (code) => {
      if (code !== null && code !== 0) reject(new Error(`オンラインテストサーバーが終了しました: ${code}`));
    });
  });
});

test.afterAll(() => {
  if (serverProcess && !serverProcess.killed) serverProcess.kill("SIGTERM");
});

async function connectPlayers(browser) {
  const hostContext = await browser.newContext();
  const guestContext = await browser.newContext();
  const host = await hostContext.newPage();
  const guest = await guestContext.newPage();
  await Promise.all([host.goto(gameUrl), guest.goto(gameUrl)]);

  for (const page of [host, guest]) {
    await page.locator("#homeBattleButton").click();
    await page.locator("#onlinePrivateMatchButton").click();
  }
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
    await expect(page.locator("#onlineReadyButton")).toBeEnabled();
  }
  await host.locator("#onlineReadyButton").click();
  await guest.locator("#onlineReadyButton").click();
  await expect.poll(() => host.evaluate(() => (
    window.__chibattle.state.online.localReady && window.__chibattle.state.online.remoteReady
  ))).toBe(true);
  await expect(host.locator("#onlineStartButton")).toBeEnabled();
  await host.locator("#onlineStartButton").click();
  await expect.poll(() => host.evaluate(() => window.__chibattle.state.online.started)).toBe(true);
  await expect.poll(() => guest.evaluate(() => window.__chibattle.state.online.started)).toBe(true);
  await expect.poll(() => guest.evaluate(() => window.__chibattle.state.screen)).toBe("battle");

  return { hostContext, guestContext, host, guest };
}

async function prepareBattle(host, guest, sourceSide) {
  const itemId = await host.evaluate((side) => {
    const api = window.__chibattle;
    api.state.screen = "battle";
    api.state.phase = "battle";
    api.state.currentSide = side;
    api.state.gameOver = false;
    api.state.online.started = true;
    api.state.players.player.maxWill = 10;
    api.state.players.player.will = 10;
    api.state.players.opponent.maxWill = 10;
    api.state.players.opponent.will = 10;
    api.state.players.player.deck = Array.from({ length: 8 }, () => api.createCardFromBase("general_student", "player"));
    api.state.players.opponent.deck = Array.from({ length: 8 }, () => api.createCardFromBase("general_student", "opponent"));
    const item = api.createCardFromBase("course_registration_party", side);
    api.state.players[side].hand = [item];
    api.onlineBroadcastState(true);
    return item.instanceId;
  }, sourceSide);
  await expect.poll(() => guest.evaluate(() => window.__chibattle.state.screen)).toBe("battle");
  return itemId;
}

for (const sourceSide of ["player", "opponent"]) {
  test(`${sourceSide === "player" ? "ホスト" : "ゲスト"}が講義を選ぶと双方に講義と表示し、再同期では重複表示しない`, async ({ browser }) => {
    const { hostContext, guestContext, host, guest } = await connectPlayers(browser);
    try {
      await host.evaluate((side) => {
        const api = window.__chibattle;
        const { state } = api;
        state.screen = "battle";
        state.phase = "battle";
        state.currentSide = side;
        state.actionTurn = 3;
        state.gameOver = false;
        state.aiThinking = false;
        state.environment = null;
        state.effectFeedbackEvents = [];
        for (const owner of ["player", "opponent"]) {
          state.players[owner].board.seats = Array(9).fill(null);
          state.players[owner].board.teacher = null;
        }
        const teacher = api.makeBoardCard(api.createCardFromBase("general_teacher", side));
        teacher.playedOnTurn = 0;
        state.players[side].board.teacher = teacher;
        const targetSide = side === "player" ? "opponent" : "player";
        state.players[targetSide].board.seats[0] = api.makeBoardCard(api.createCardFromBase("protein_drinker", targetSide));
        api.render();
        api.onlineBroadcastState(true);
      }, sourceSide);
      const localSide = sourceSide === "player" ? "opponent" : "player";
      await expect.poll(() => guest.evaluate((side) => Boolean(window.__chibattle.state.players[side].board.teacher), localSide)).toBe(true);
      for (const page of [host, guest]) {
        await page.evaluate(() => {
          window.lectureAnnouncementCount = 0;
          document.getElementById("turnOverlay").addEventListener("animationstart", () => {
            if (document.getElementById("turnOverlay").textContent === "講義") window.lectureAnnouncementCount += 1;
          });
        });
      }
      const actor = sourceSide === "player" ? host : guest;
      await actor.locator("#playerProfessorLane .board-card").click();
      await actor.locator("#teacherLectureChoiceButton").click();
      for (const page of [host, guest]) {
        await expect(page.locator("#turnOverlay")).toHaveText("講義");
        await expect.poll(() => page.evaluate(() => window.lectureAnnouncementCount)).toBe(1);
      }
      const events = await host.evaluate(() => window.__chibattle.state.effectFeedbackEvents.filter(event => event.target === "announcement" && event.text === "講義"));
      expect(events).toHaveLength(1);
      const targetSide = sourceSide === "player" ? "opponent" : "player";
      expect(await host.evaluate((side) => window.__chibattle.state.players[side].board.seats[0].currentHp, targetSide)).toBe(6);
      const seq = await host.evaluate(() => {
        window.__chibattle.onlineBroadcastState(true);
        return window.__chibattle.state.online.lastSnapshotSeq;
      });
      await expect.poll(() => guest.evaluate(() => window.__chibattle.state.online.lastSnapshotSeq)).toBeGreaterThanOrEqual(seq);
      // 受信後に予約された演出も含め、再同期で再生しないことを確認する。
      await guest.waitForTimeout(150);
      expect(await guest.evaluate(() => window.lectureAnnouncementCount)).toBe(1);
    } finally {
      await hostContext.close();
      await guestContext.close();
    }
  });
}

test("ホストがカオスルールでデッキを選び準備OKにしても通常ルールへ戻らない", async ({ browser }) => {
  const hostContext = await browser.newContext();
  const guestContext = await browser.newContext();
  const host = await hostContext.newPage();
  const guest = await guestContext.newPage();
  try {
    await Promise.all([host.goto(gameUrl), guest.goto(gameUrl)]);
    for (const page of [host, guest]) {
      await page.locator("#homeBattleButton").click();
      await page.locator("#onlinePrivateMatchButton").click();
      await page.evaluate(() => {
        window.__chibattle.state.deckBuilder.chaosDecks = {
          "カオス動作確認": { counts: { general_student: 40 } }
        };
        window.__chibattle.render();
      });
    }
    await host.locator("#onlineCreateRoomButton").click();
    await expect.poll(() => host.evaluate(() => (
      window.__chibattle.state.online.roomCode || ""
    ))).not.toBe("");
    const roomCode = await host.evaluate(() => window.__chibattle.state.online.roomCode);
    await guest.locator("#onlineRoomInput").fill(roomCode);
    await guest.locator("#onlineJoinRoomButton").click();
    await expect.poll(() => host.evaluate(() => window.__chibattle.state.online.connected)).toBe(true);
    await expect.poll(() => guest.evaluate(() => window.__chibattle.state.online.connected)).toBe(true);

    await host.selectOption("#onlineRuleSelect", "chaos");
    await expect.poll(() => host.evaluate(() => window.__chibattle.state.online.roomRuleId)).toBe("chaos");
    await expect.poll(() => guest.evaluate(() => window.__chibattle.state.online.roomRuleId)).toBe("chaos");
    for (const page of [host, guest]) {
      await page.selectOption("#onlineDeckSelect", { label: "カオス動作確認" });
      await expect(page.locator("#onlineReadyButton")).toBeEnabled();
    }

    await host.locator("#onlineReadyButton").click();
    await expect.poll(() => host.evaluate(() => window.__chibattle.state.online.roomRuleId)).toBe("chaos");
    await expect.poll(() => guest.evaluate(() => window.__chibattle.state.online.roomRuleId)).toBe("chaos");
    await guest.locator("#onlineReadyButton").click();
    await expect.poll(() => guest.evaluate(() => window.__chibattle.state.online.localReady)).toBe(true);
    await expect(guest.locator("#onlineLocalReadyBadge")).toHaveText("準備OK");
    await expect(guest.locator("#onlineReadyButton")).toHaveText("準備を解除");
    await expect.poll(() => host.evaluate(() => (
      window.__chibattle.state.online.localReady && window.__chibattle.state.online.remoteReady
    ))).toBe(true);
    await expect(host.locator("#onlineStartButton")).toBeEnabled();
    await host.locator("#onlineStartButton").click();
    await expect.poll(() => host.evaluate(() => window.__chibattle.state.online.started)).toBe(true);
    await expect.poll(() => guest.evaluate(() => window.__chibattle.state.online.started)).toBe(true);
    expect(await host.evaluate(() => ({
      roomRuleId: window.__chibattle.state.online.roomRuleId,
      battleRuleId: window.__chibattle.state.battleRuleId,
      copies: window.__chibattle.state.players.player.originalDeckCounts.general_student,
      valid: window.__chibattle.state.players.player.deckValid.valid
    }))).toEqual({ roomRuleId: "chaos", battleRuleId: "chaos", copies: 40, valid: true });
  } finally {
    await hostContext.close();
    await guestContext.close();
  }
});

test("専攻ルールでゲストが準備OKにした状態をゲスト画面でも維持する", async ({ browser }) => {
  const hostContext = await browser.newContext();
  const guestContext = await browser.newContext();
  const host = await hostContext.newPage();
  const guest = await guestContext.newPage();
  try {
    await Promise.all([host.goto(gameUrl), guest.goto(gameUrl)]);
    for (const page of [host, guest]) {
      await page.locator("#homeBattleButton").click();
      await page.locator("#onlinePrivateMatchButton").click();
      await page.evaluate(() => {
        const counts = {};
        [
          "general_student", "absolute_woman", "fridge_thief", "classroom", "environment_setup",
          "go_away", "happy_experience", "hondara", "water_2l", "word_increaser"
        ].forEach((baseId) => { counts[baseId] = 3; });
        ["adjective_student", "cancel_student", "eaten_student", "hurried_student", "lazy_student"]
          .forEach((baseId) => { counts[baseId] = 2; });
        counts.general_student -= 1;
        counts.tokyo_tech_bro = 1;
        window.__chibattle.state.deckBuilder.specialtyDecks = {
          "遅刻専攻動作確認": { counts, specialtyId: "late" }
        };
        window.__chibattle.render();
      });
    }
    await host.locator("#onlineCreateRoomButton").click();
    await expect.poll(() => host.evaluate(() => window.__chibattle.state.online.roomCode || "")).not.toBe("");
    const roomCode = await host.evaluate(() => window.__chibattle.state.online.roomCode);
    await guest.locator("#onlineRoomInput").fill(roomCode);
    await guest.locator("#onlineJoinRoomButton").click();
    await expect.poll(() => guest.evaluate(() => window.__chibattle.state.online.connected)).toBe(true);

    await host.selectOption("#onlineRuleSelect", "specialty");
    await expect.poll(() => guest.evaluate(() => window.__chibattle.state.online.roomRuleId)).toBe("specialty");
    for (const page of [host, guest]) {
      await page.selectOption("#onlineDeckSelect", { label: "遅刻専攻動作確認" });
      await expect(page.locator("#onlineReadyButton")).toBeEnabled();
    }

    await host.locator("#onlineReadyButton").click();
    await guest.locator("#onlineReadyButton").click();
    await expect.poll(() => guest.evaluate(() => window.__chibattle.state.online.localReady)).toBe(true);
    await expect(guest.locator("#onlineLocalReadyBadge")).toHaveText("準備OK");
    await expect(guest.locator("#onlineReadyButton")).toHaveText("準備を解除");
    await expect.poll(() => host.evaluate(() => window.__chibattle.state.online.remoteReady)).toBe(true);
    await expect(host.locator("#onlineStartButton")).toBeEnabled();
  } finally {
    await hostContext.close();
    await guestContext.close();
  }
});

test("ホストが履修登録結論パを使用するとゲストの了承・拒否画面が同期後も残る", async ({ browser }) => {
  const players = await connectPlayers(browser);
  try {
    const itemId = await prepareBattle(players.host, players.guest, "player");
    await players.host.evaluate((id) => {
      const api = window.__chibattle;
      const item = api.state.players.player.hand.find((card) => card.instanceId === id);
      api.openCourseRegistrationChoice(item);
    }, itemId);

    await expect(players.guest.locator("#courseRegistrationConsentModal")).not.toHaveClass(/hidden/);
    await expect(players.guest.locator("#courseRegistrationAcceptButton")).toBeVisible();
    await expect(players.guest.locator("#courseRegistrationRejectButton")).toBeVisible();
    await players.host.evaluate(() => window.__chibattle.onlineBroadcastState(true));
    await expect(players.guest.locator("#courseRegistrationConsentModal")).not.toHaveClass(/hidden/);
    await players.guest.locator("#courseRegistrationAcceptButton").click();
    await expect.poll(() => players.guest.evaluate(() => (
      window.__chibattle.state.pendingCardChoice?.mode
    ))).toBe("course_registration_online_response");
  } finally {
    await players.hostContext.close();
    await players.guestContext.close();
  }
});

test("ゲストが履修登録結論パを使用するとホストに了承・拒否画面が表示される", async ({ browser }) => {
  const players = await connectPlayers(browser);
  try {
    await prepareBattle(players.host, players.guest, "opponent");
    await expect.poll(() => players.guest.evaluate(() => (
      window.__chibattle.state.players.player.hand.some((card) => card.baseId === "course_registration_party")
    ))).toBe(true);
    await players.guest.evaluate(() => {
      const api = window.__chibattle;
      const item = api.state.players.player.hand.find((card) => card.baseId === "course_registration_party");
      api.openCourseRegistrationChoice(item);
    });

    await expect(players.host.locator("#courseRegistrationConsentModal")).not.toHaveClass(/hidden/);
    await expect(players.host.locator("#courseRegistrationAcceptButton")).toBeVisible();
    await expect(players.host.locator("#courseRegistrationRejectButton")).toBeVisible();
    await players.host.locator("#courseRegistrationAcceptButton").click();
    await expect.poll(() => players.host.evaluate(() => (
      window.__chibattle.state.pendingCardChoice?.mode
    ))).toBe("course_registration_host_target");
  } finally {
    await players.hostContext.close();
    await players.guestContext.close();
  }
});

test("ゲスト使用者は次のターン開始時に選択順の先頭カードを自動で引く", async ({ browser }) => {
  const players = await connectPlayers(browser);
  try {
    await prepareBattle(players.host, players.guest, "opponent");
    await expect.poll(() => players.guest.evaluate(() => (
      window.__chibattle.state.players.player.hand.some((card) => card.baseId === "course_registration_party")
    ))).toBe(true);
    await players.guest.evaluate(() => {
      const api = window.__chibattle;
      const item = api.state.players.player.hand.find((card) => card.baseId === "course_registration_party");
      api.openCourseRegistrationChoice(item);
    });

    await expect(players.host.locator("#courseRegistrationConsentModal")).not.toHaveClass(/hidden/);
    await players.host.locator("#courseRegistrationAcceptButton").click();
    await expect.poll(() => players.host.evaluate(() => window.__chibattle.state.pendingCardChoice?.mode))
      .toBe("course_registration_host_target");
    await players.host.evaluate(() => {
      const api = window.__chibattle;
      api.state.pendingCardChoice.selectedIds = api.state.pendingCardChoice.cards.slice(0, 5).map((card) => card.instanceId);
      api.confirmCardChoiceSelection();
    });

    await expect.poll(() => players.guest.evaluate(() => window.__chibattle.state.pendingCardChoice?.mode))
      .toBe("course_registration_online_source_response");
    const orderedGuestIds = await players.guest.evaluate(() => {
      const api = window.__chibattle;
      const selectedIds = [3, 0, 4, 1, 2].map((index) => api.state.pendingCardChoice.cards[index].instanceId);
      api.state.pendingCardChoice.selectedIds = selectedIds;
      api.confirmCardChoiceSelection();
      return selectedIds;
    });
    await expect.poll(() => players.host.evaluate(() => window.__chibattle.state.courseRegistration?.drawQueues?.opponent?.length))
      .toBe(5);
    expect(await players.host.evaluate(() => (
      window.__chibattle.state.courseRegistration.drawQueues.opponent.map((card) => card.instanceId)
    ))).toEqual(orderedGuestIds);

    await players.host.evaluate(() => {
      const api = window.__chibattle;
      api.state.currentSide = "opponent";
      api.startTurn("opponent");
      api.onlineBroadcastState(true);
    });
    const selectedId = orderedGuestIds[0];

    await expect.poll(() => players.host.evaluate((id) => (
      window.__chibattle.state.players.opponent.hand.some((card) => card.instanceId === id)
    ), selectedId)).toBe(true);
    await expect.poll(() => players.guest.evaluate((id) => (
      window.__chibattle.state.players.player.hand.some((card) => card.instanceId === id)
    ), selectedId)).toBe(true);
    expect(await players.guest.evaluate(() => window.__chibattle.state.pendingCardChoice)).toBeNull();
    expect(await players.host.evaluate(() => ({
      guestTurns: window.__chibattle.state.courseRegistration.remainingTurns.opponent,
      hostTurns: window.__chibattle.state.courseRegistration.remainingTurns.player
    }))).toEqual({ guestTurns: 4, hostTurns: 5 });
  } finally {
    await players.hostContext.close();
    await players.guestContext.close();
  }
});
