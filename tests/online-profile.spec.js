const { test, expect } = require("@playwright/test");
const { spawn } = require("node:child_process");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const port = 18790;
const storageKey = "chibattle-player-profile-v1";
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

async function profilePage(browser, profile) {
  const context = await browser.newContext();
  await context.addInitScript(({ key, value }) => {
    localStorage.setItem(key, JSON.stringify(value));
  }, { key: storageKey, value: profile });
  const page = await context.newPage();
  await page.goto(gameUrl);
  await page.locator("#homeBattleButton").click();
  return { context, page };
}

test("ランダムマッチで双方のプロフィール名とアイコンを相手にも表示する", async ({ browser }) => {
  const leftProfile = { username: "左プレイヤー", avatarId: "glasses", favoriteCardId: "yocchan", favoriteCardStyle: "normal" };
  const rightProfile = { username: "右プレイヤー", avatarId: "robot_antenna", favoriteCardId: "king_ghidorah_bed", favoriteCardStyle: "prism" };
  const left = await profilePage(browser, leftProfile);
  const right = await profilePage(browser, rightProfile);

  try {
    await left.page.locator("#onlineRandomMatchButton").click();
    await right.page.locator("#onlineRandomMatchButton").click();
    await expect.poll(() => left.page.evaluate(() => window.__chibattle.state.online.connected)).toBe(true);
    await expect.poll(() => right.page.evaluate(() => window.__chibattle.state.online.connected)).toBe(true);

    await left.page.evaluate(() => {
      window.__chibattle.state.online.remoteProfile = {
        username: "チバトル学生",
        avatarId: "user",
        favoriteCardId: ""
      };
      window.__chibattle.render();
    });
    await right.page.evaluate(() => {
      window.__chibattle.state.online.remoteProfile = {
        username: "チバトル学生",
        avatarId: "user",
        favoriteCardId: ""
      };
      window.__chibattle.render();
    });
    await right.page.evaluate((profile) => {
      window.__chibattle.state.online.conn.send({
        type: "playReveal",
        protocol: 1,
        profileSync: true,
        profileRole: window.__chibattle.state.online.role,
        profile
      });
    }, rightProfile);

    await expect(left.page.locator("#onlineRandomLocalPlayerName")).toHaveText("左プレイヤー");
    await expect(left.page.locator("#onlineRandomRemotePlayerName")).toHaveText("右プレイヤー");
    await expect(left.page.locator("#onlineRandomLocalAvatar")).toHaveClass(/avatar-glasses/);
    await expect(left.page.locator("#onlineRandomRemoteAvatar")).toHaveClass(/avatar-robot-antenna/);

    await expect(right.page.locator("#onlineRandomLocalPlayerName")).toHaveText("右プレイヤー");
    await expect(right.page.locator("#onlineRandomRemotePlayerName")).toHaveText("左プレイヤー");
    await expect(right.page.locator("#onlineRandomLocalAvatar")).toHaveClass(/avatar-robot-antenna/);
    await expect(right.page.locator("#onlineRandomRemoteAvatar")).toHaveClass(/avatar-glasses/);

    await left.page.locator("#onlineRandomRemoteAvatar").click();
    await expect(left.page.locator("#profileViewerModal")).toBeVisible();
    await expect(left.page.locator("#profileViewerName")).toHaveText("右プレイヤー");
    await expect(left.page.locator("#profileViewerFavoriteName")).toHaveText("キングギドラベッド");
    await expect(left.page.locator("#profileViewerFavoriteCard .card")).toHaveClass(/reward-prism/);
    await expect(left.page.locator("#profileViewerAvatar")).toHaveClass(/avatar-robot-antenna/);
    await left.page.locator("#profileViewerCloseButton").click();

    await left.page.evaluate(() => {
      window.__chibattle.state.screen = "battle";
      window.__chibattle.render();
    });
    await right.page.evaluate(() => {
      window.__chibattle.state.screen = "battle";
      window.__chibattle.render();
    });
    await expect(left.page.locator("#playerBoardTitle")).toHaveText("左プレイヤーの講義室");
    await expect(left.page.locator("#opponentBoardTitle")).toHaveText("右プレイヤーの講義室");
    await expect(right.page.locator("#playerBoardTitle")).toHaveText("右プレイヤーの講義室");
    await expect(right.page.locator("#opponentBoardTitle")).toHaveText("左プレイヤーの講義室");
  } finally {
    await left.context.close();
    await right.context.close();
  }
});

test("プライベートマッチでも双方のプロフィール名とアイコンを表示する", async ({ browser }) => {
  const host = await profilePage(browser, {
    username: "部屋主",
    avatarId: "cap",
    favoriteCardId: "general_teacher"
  });
  const guest = await profilePage(browser, {
    username: "参加者",
    avatarId: "smile",
    favoriteCardId: "general_student"
  });

  try {
    await host.page.locator("#onlinePrivateMatchButton").click();
    await guest.page.locator("#onlinePrivateMatchButton").click();
    await host.page.locator("#onlineCreateRoomButton").click();
    await expect.poll(() => host.page.evaluate(() => window.__chibattle.state.online.role)).toBe("host");
    const roomCode = await host.page.evaluate(() => window.__chibattle.state.online.roomCode);
    await guest.page.locator("#onlineRoomInput").fill(roomCode);
    await guest.page.locator("#onlineJoinRoomButton").click();
    await expect.poll(() => host.page.evaluate(() => window.__chibattle.state.online.connected)).toBe(true);
    await expect.poll(() => guest.page.evaluate(() => window.__chibattle.state.online.connected)).toBe(true);

    await expect(host.page.locator("#onlineLocalPlayerName")).toHaveText("部屋主");
    await expect(host.page.locator("#onlineRemotePlayerName")).toHaveText("参加者");
    await expect(host.page.locator("#onlineLocalPlayerAvatar")).toHaveClass(/avatar-cap/);
    await expect(host.page.locator("#onlineRemotePlayerAvatar")).toHaveClass(/avatar-smile/);

    await expect(guest.page.locator("#onlineLocalPlayerName")).toHaveText("参加者");
    await expect(guest.page.locator("#onlineRemotePlayerName")).toHaveText("部屋主");
    await expect(guest.page.locator("#onlineLocalPlayerAvatar")).toHaveClass(/avatar-smile/);
    await expect(guest.page.locator("#onlineRemotePlayerAvatar")).toHaveClass(/avatar-cap/);

    await guest.page.locator("#onlineLocalProfileButton").click();
    await expect(guest.page.locator("#profileViewerName")).toHaveText("参加者");
    await expect(guest.page.locator("#profileViewerFavoriteName")).toHaveText("一般学生");
    await guest.page.locator("#profileViewerCloseButton").click();
    await guest.page.locator("#onlineRemoteProfileButton").click();
    await expect(guest.page.locator("#profileViewerName")).toHaveText("部屋主");
    await expect(guest.page.locator("#profileViewerFavoriteName")).toHaveText("一般教師");
  } finally {
    await host.context.close();
    await guest.context.close();
  }
});
