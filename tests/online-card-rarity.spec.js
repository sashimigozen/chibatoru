const { test, expect } = require("@playwright/test");
const { spawn } = require("node:child_process");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const port = 18788;
const wsUrl = `ws://127.0.0.1:${port}`;
const gameFileUrl = pathToFileURL(path.join(__dirname, "..", "index.html"));
gameFileUrl.searchParams.set("ws", wsUrl);
const gameUrl = gameFileUrl.href;
let serverProcess;

test.beforeAll(async () => {
  serverProcess = spawn(process.execPath, [path.join(__dirname, "..", "server", "server.js")], {
    env: { ...process.env, PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"]
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("オンラインテストサーバーの起動がタイムアウトしました。")), 5000);
    serverProcess.stdout.on("data", (chunk) => {
      if (!String(chunk).includes("listening")) return;
      clearTimeout(timer);
      resolve();
    });
    serverProcess.once("error", reject);
  });
});

test.afterAll(() => {
  if (serverProcess && !serverProcess.killed) serverProcess.kill("SIGTERM");
});

function cardStyleSave({ specialtyId, cardId, mode, prism = false }) {
  return {
    unlocked: { [specialtyId]: true },
    selected: { [cardId]: mode },
    ...(prism ? { prismUnlocked: { [cardId]: true } } : {})
  };
}

async function enterPrivateRoom(page) {
  await page.goto(gameUrl);
  await page.locator("#homeNavBattleButton").click();
  await page.locator("#onlinePrivateMatchButton").click();
}

test("オンライン対戦では両プレイヤーが選んだ高レアリティを双方の画面へ反映する", async ({ browser }) => {
  const hostContext = await browser.newContext();
  const guestContext = await browser.newContext();
  const host = await hostContext.newPage();
  const guest = await guestContext.newPage();
  const pageErrors = [];
  for (const page of [host, guest]) page.on("pageerror", (error) => pageErrors.push(error.message));
  const hostProfile = { username: "ホスト本人", avatarId: "cap", favoriteCardId: "king_ghidorah_bed", favoriteCardStyle: "prism", commentParts: ["U太", "最強", "だぞ"] };
  const guestProfile = { username: "ゲスト本人", avatarId: "smile", favoriteCardId: "vampire", favoriteCardStyle: "secretRare", commentParts: ["カニ", "しか勝たん", "で草"] };
  try {
    await host.addInitScript(({ save, profile }) => {
      localStorage.setItem("chibattle-dungeon-card-styles-v1", JSON.stringify(save));
      localStorage.setItem("chibattle-player-profile-v1", JSON.stringify(profile));
    }, { save: {
      ...cardStyleSave({ specialtyId: "king_ghidorah_bed", cardId: "king_ghidorah_bed", mode: "prism", prism: true }),
      cardUnlocks: { general_student: { ultraRare: true } },
      selected: { king_ghidorah_bed: 'prism', general_student: 'ultraRare' }
    }, profile: hostProfile });
    await guest.addInitScript(({ save, profile }) => {
      localStorage.setItem("chibattle-dungeon-card-styles-v1", JSON.stringify(save));
      localStorage.setItem("chibattle-player-profile-v1", JSON.stringify(profile));
    }, { save: cardStyleSave({ specialtyId: "cafeteria", cardId: "vampire", mode: "reward" }), profile: guestProfile });
    await Promise.all([enterPrivateRoom(host), enterPrivateRoom(guest)]);

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
    }
    await host.locator("#onlineReadyButton").click();
    await guest.locator("#onlineReadyButton").click();
    await expect.poll(() => host.evaluate(() => window.__chibattle.state.online.remoteCardStyles.vampire)).toBe("secretRare");
    await expect.poll(() => guest.evaluate(() => window.__chibattle.state.online.remoteCardStyles.general_student)).toBe("ultraRare");
    await expect.poll(() => guest.evaluate(() => window.__chibattle.state.online.remoteCardStyles.king_ghidorah_bed)).toBe("prism");
    await expect.poll(() => host.evaluate(() => (
      window.__chibattle.state.online.localReady && window.__chibattle.state.online.remoteReady
    ))).toBe(true);
    await host.locator("#onlineStartButton").click();
    await expect.poll(() => host.evaluate(() => window.__chibattle.state.online.started)).toBe(true);
    await expect.poll(() => guest.evaluate(() => window.__chibattle.state.online.started)).toBe(true);

    expect(await host.evaluate(() => window.__chibattle.state.profile)).toEqual(hostProfile);
    expect(await guest.evaluate(() => window.__chibattle.state.profile)).toEqual(guestProfile);

    // After receiving the start snapshot, the guest's acknowledgement must
    // still send the guest's own profile and rarity, not the host's profile.
    await guest.evaluate(() => {
      const connection = window.__chibattle.state.online.conn;
      const send = connection.send.bind(connection);
      connection.send = (message) => {
        if (message.profileSync && message.profileAck) window.__profileSyncAck = message;
        return send(message);
      };
    });
    await host.evaluate((profile) => {
      const online = window.__chibattle.state.online;
      online.conn.send({ type: "playReveal", protocol: 1, profileSync: true, profileRole: "host", profile });
    }, hostProfile);
    await expect.poll(() => guest.evaluate(() => window.__profileSyncAck?.profile)).toEqual(guestProfile);
    expect(await guest.evaluate(() => window.__profileSyncAck.cardStyles)).toEqual({ vampire: "secretRare" });
    await expect.poll(() => host.evaluate(() => window.__chibattle.state.online.remoteProfile)).toEqual(guestProfile);

    // A reconnect or a missed lobby update must not make the battle depend on
    // transient lobby state. The next authoritative snapshot restores styles.
    await guest.evaluate(() => {
      const online = window.__chibattle.state.online;
      online.localCardStyles = {};
      online.remoteCardStyles = {};
      online.hostCardStyles = {};
      online.guestCardStyles = {};
      online.remoteProfile = {};
    });

    const seq = await host.evaluate(() => {
      const api = window.__chibattle;
      api.state.phase = "battle";
      api.state.players.player.board.seats = Array(9).fill(null);
      api.state.players.opponent.board.seats = Array(9).fill(null);
      api.state.players.player.board.seats[0] = api.makeBoardCard(api.createCardFromBase("king_ghidorah_bed", "player"));
      api.state.players.player.board.seats[1] = api.makeBoardCard(api.createCardFromBase("general_student", "player"));
      api.state.players.opponent.board.seats[0] = api.makeBoardCard(api.createCardFromBase("vampire", "opponent"));
      api.render();
      api.onlineBroadcastState(true);
      return api.state.online.lastSnapshotSeq;
    });
    await expect.poll(() => guest.evaluate(() => window.__chibattle.state.online.lastSnapshotSeq)).toBeGreaterThanOrEqual(seq);
    expect(await guest.evaluate(() => window.__chibattle.state.profile)).toEqual(guestProfile);
    expect(await guest.evaluate(() => JSON.parse(localStorage.getItem("chibattle-player-profile-v1")))).toEqual(guestProfile);
    expect(await guest.evaluate(() => window.__chibattle.state.online.remoteProfile)).toEqual(hostProfile);
    await expect(host.locator("#playerBoardTitle")).toHaveText("ホスト本人の講義室");
    await expect(host.locator("#opponentBoardTitle")).toHaveText("ゲスト本人の講義室");
    await expect(guest.locator("#playerBoardTitle")).toHaveText("ゲスト本人の講義室");
    await expect(guest.locator("#opponentBoardTitle")).toHaveText("ホスト本人の講義室");
    expect(await guest.evaluate(() => ({
      local: window.__chibattle.state.online.localCardStyles,
      remote: window.__chibattle.state.online.remoteCardStyles
    }))).toEqual({
      local: { vampire: "secretRare" },
      remote: { king_ghidorah_bed: "prism", general_student: "ultraRare" }
    });

    for (const page of [host, guest]) {
      await expect(page.locator('.board-card[data-base-id="king_ghidorah_bed"]')).toHaveClass(/reward-prism/);
      await expect(page.locator('.board-card[data-base-id="vampire"]')).toHaveClass(/reward-foil/);
      await expect(page.locator('.board-card[data-base-id="vampire"]')).toHaveClass(/rarity-secret-rare/);
      await expect(page.locator('.board-card[data-base-id="general_student"]')).toHaveClass(/rarity-ultra-rare/);
      await expect(page.locator('.board-card[data-base-id="general_student"] .rarity-mirror-surface')).toHaveCount(1);
    }

    await host.evaluate(() => {
      const api = window.__chibattle;
      api.showCardPlayAnimation(api.createCardFromBase("king_ghidorah_bed", "player"), "trash");
    });
    await expect(guest.locator("#playRevealCard .card")).toHaveClass(/reward-prism/);
    await Promise.all([host.evaluate(() => window.__chibattle.hidePlayReveal()), guest.evaluate(() => window.__chibattle.hidePlayReveal())]);

    await host.evaluate(() => {
      const api = window.__chibattle;
      api.showCardPlayAnimation(api.createCardFromBase("vampire", "opponent"), "trash");
    });
    await expect(guest.locator("#playRevealCard .card")).toHaveClass(/reward-foil/);

    // Rejoin the same live room through the real reconnect path.
    const connectionToken = await guest.evaluate(() => {
      const online = window.__chibattle.state.online;
      online.conn.close();
      return online.connToken;
    });
    await expect.poll(() => guest.evaluate(() => window.__chibattle.state.online.connToken), { timeout: 10000 }).toBeGreaterThan(connectionToken);
    await expect.poll(() => guest.evaluate(() => window.__chibattle.state.online.connected)).toBe(true);
    await expect.poll(() => host.evaluate(() => window.__chibattle.state.online.remoteProfile)).toEqual(guestProfile);
    expect(await guest.evaluate(() => window.__chibattle.state.profile)).toEqual(guestProfile);
    await expect(guest.locator('.board-card[data-base-id="king_ghidorah_bed"]')).toHaveClass(/reward-prism/);
    await expect(guest.locator('.board-card[data-base-id="vampire"]')).toHaveClass(/reward-foil/);
    expect(pageErrors).toEqual([]);
  } finally {
    await hostContext.close();
    await guestContext.close();
  }
});

test("旧クライアントの対戦同期でもゲスト・観戦者のプロフィールと編集状態を上書きしない", async ({ page }) => {
  await page.goto(gameUrl);
  const result = await page.evaluate(() => {
    const api = window.__chibattle;
    api.state.online.role = "host";
    api.state.profile.username = "部屋主";
    api.state.online.remoteProfile = { username: "参加者", avatarId: "smile", favoriteCardId: "vampire", favoriteCardStyle: "reward" };
    const snapshot = api.onlineCreateSnapshot();
    const excluded = ["profile", "profileEditor", "profileViewer", "deckBuilder", "online"];
    const leaked = excluded.filter((key) => Object.hasOwn(snapshot.state, key));
    const preserved = [];
    for (const role of ["guest", "spectator"]) {
      api.state.online.role = role;
      const localProfile = { ...api.state.profile, username: "この端末の本人" };
      const localEditor = { ...api.state.profileEditor, cardSearch: "編集中の検索" };
      const localDecks = api.state.deckBuilder;
      const localOnline = api.state.online;
      api.state.profile = localProfile;
      api.state.profileEditor = localEditor;
      api.state.profileViewer = null;
      api.onlineHandleMessage({
        type: "gameState", protocol: 1,
        snapshot: {
          ...snapshot, seq: api.state.online.lastSnapshotSeq + 1,
          state: { ...snapshot.state, profile: snapshot.profiles.host, profileEditor: {}, profileViewer: {}, deckBuilder: {}, online: {} }
        }
      });
      preserved.push({
        role,
        profile: JSON.stringify(api.state.profile) === JSON.stringify(localProfile),
        editor: api.state.profileEditor === localEditor,
        viewer: api.state.profileViewer === null,
        decks: api.state.deckBuilder === localDecks,
        online: api.state.online === localOnline,
        hostName: api.state.online.hostProfile.username,
        guestName: api.state.online.guestProfile.username
      });
    }
    return { leaked, preserved };
  });
  expect(result.leaked).toEqual([]);
  expect(result.preserved).toEqual(["guest", "spectator"].map((role) => ({
    role, profile: true, editor: true, viewer: true, decks: true, online: true,
    hostName: "部屋主", guestName: "参加者"
  })));
});

test("プロフィール再同期でレアリティも復元し、省略された部屋情報や古い同期で自分の設定を失わない", async ({ page }) => {
  await page.addInitScript((save) => {
    localStorage.setItem("chibattle-dungeon-card-styles-v1", JSON.stringify(save));
  }, cardStyleSave({ specialtyId: "cafeteria", cardId: "vampire", mode: "reward" }));
  await page.goto(gameUrl);
  const result = await page.evaluate(() => {
    const api = window.__chibattle;
    const online = api.state.online;
    online.role = "guest";
    online.clientId = "guest-client";
    online.remoteClientId = "host-client";
    online.roomSessionId = "profile-test-room";
    online.connected = true;
    api.onlineHandleMessage({
      type: "playReveal", protocol: 1, senderId: "host-client", roomSessionId: online.roomSessionId,
      profileSync: true, profileAck: true, profileRole: "host",
      profile: { username: "相手本人", avatarId: "glasses", favoriteCardId: "king_ghidorah_bed", favoriteCardStyle: "prism" },
      cardStyles: { king_ghidorah_bed: "prism" }
    });
    api.onlineHandleMessage({
      type: "roomState", protocol: 1, senderId: "server", roomSessionId: online.roomSessionId,
      roomStateSeq: 1,
      players: [
        { role: "host", clientId: "host-client" },
        { role: "guest", clientId: "guest-client", cardStyles: {} }
      ]
    });
    const retained = { remoteName: online.remoteProfile.username, remote: online.remoteCardStyles, local: online.localCardStyles };
    api.onlineHandleMessage({
      type: "playReveal", protocol: 1, senderId: "host-client", roomSessionId: online.roomSessionId,
      profileSync: true, profileAck: true, profileRole: "host",
      profile: { username: "相手本人", avatarId: "glasses", favoriteCardId: "king_ghidorah_bed", favoriteCardStyle: "normal" },
      cardStyles: {}
    });
    return { retained, cleared: online.remoteCardStyles, favoriteStyle: online.remoteProfile.favoriteCardStyle };
  });
  expect(result).toEqual({
    retained: { remoteName: "相手本人", remote: { king_ghidorah_bed: "prism" }, local: { vampire: "secretRare" } },
    cleared: {}, favoriteStyle: "normal"
  });
});
