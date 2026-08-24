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
