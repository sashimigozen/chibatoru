const { test, expect } = require("@playwright/test");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const gameUrl = pathToFileURL(path.join(__dirname, "..", "index.html")).href;

test.beforeEach(async ({ page }) => {
  await page.goto(gameUrl);
  await page.evaluate(() => {
    const api = window.__chibattle;
    api.startCardTest("enemy_boss");
    api.state.testMode = false;
    api.state.currentSide = "player";
    api.state.players.player.board = { teacher: null, seats: Array(9).fill(null) };
    api.state.players.opponent.board = { teacher: null, seats: Array(9).fill(null) };
    api.state.players.player.hand = [];
    api.state.players.player.will = 10;
  });
});

test("手札の幹部と別名の敵で条件を満たし、空席に敵を2人出す", async ({ page }) => {
  const result = await page.evaluate(async () => {
    const api = window.__chibattle;
    const player = api.state.players.player;
    player.board.seats[0] = api.makeBoardCard(api.createCardFromBase("true_enemy", "player"));
    const boss = api.createCardFromBase("enemy_boss", "player");
    player.hand.push(boss);
    const text = api.cardRulesText(boss);
    const played = api.placeCardFromHand("player", boss.instanceId, "seat", "player", 1, false);
    await api.waitForOrderedAttendance();
    return {
      played,
      text,
      boss: player.board.seats[1]?.baseId,
      summoned: player.board.seats.filter((card) => card?.baseId === "enemy_student").length
    };
  });
  expect(result.played).toBe(true);
  expect(result.text).toBe("このカードを手札から出席させたとき、自分の講義室にカード名に「敵」を含む出席者が2人以上いる場合、自分の空いている席マスに「敵」を2人出席させる。");
  expect(result.boss).toBe("enemy_boss");
  expect(result.summoned).toBe(2);
});

test("自分の敵が幹部だけなら発動せず、相手の敵は数えない", async ({ page }) => {
  const result = await page.evaluate(async () => {
    const api = window.__chibattle;
    const player = api.state.players.player;
    api.state.players.opponent.board.seats[0] = api.makeBoardCard(api.createCardFromBase("enemy_student", "opponent"));
    const boss = api.createCardFromBase("enemy_boss", "player");
    player.hand.push(boss);
    const played = api.placeCardFromHand("player", boss.instanceId, "seat", "player", 1, false);
    await api.waitForOrderedAttendance();
    return { played, summoned: player.board.seats.filter((card) => card?.baseId === "enemy_student").length };
  });
  expect(result).toEqual({ played: true, summoned: 0 });
});

test("効果で出席した幹部は敵を生成しない", async ({ page }) => {
  const result = await page.evaluate(async () => {
    const api = window.__chibattle;
    const player = api.state.players.player;
    player.board.seats[0] = api.makeBoardCard(api.createCardFromBase("true_enemy", "player"));
    const boss = api.makeBoardCard(api.createCardFromBase("enemy_boss", "player"));
    const attended = api.attendCard("player", boss, "seat", 1, {
      attendanceSource: api.ATTENDANCE_SOURCE.GENERATED
    });
    await api.waitForOrderedAttendance();
    return {
      attended: Boolean(attended),
      summoned: player.board.seats.filter((card) => card?.baseId === "enemy_student").length
    };
  });
  expect(result).toEqual({ attended: true, summoned: 0 });
});

test("ver.0.23.9のお知らせにカード改装が表示される", async ({ page }) => {
  await page.goto(gameUrl);
  await page.locator("#homeUpdatesButton").click();
  const entry = page.locator(".update-entry").filter({ has: page.locator("summary", { hasText: "ver.0.23.9" }) });
  await expect(entry).toHaveCount(1);
  await expect(entry.locator(".update-change")).toHaveCount(8);
  await expect(entry.locator(".update-change").filter({ has: page.locator("strong", { hasText: /^U太の装備効果$/ }) }).locator(".update-after"))
    .toContainText("U太以外の出席者は、装備カードを装備しただけでは陽気を持ちません");
  await expect(entry.locator(".update-change").filter({ has: page.locator("strong", { hasText: /^敵の幹部$/ }) }).locator(".update-after"))
    .toContainText("カード名に「敵」を含む出席者が2人以上");
  await expect(entry.locator(".update-change").filter({ has: page.locator("strong", { hasText: /^怖い質問$/ }) }).locator(".update-after"))
    .toContainText("生成専用カード");
  await expect(entry.locator(".update-change").filter({ has: page.locator("strong", { hasText: /^アカデミックムーブ$/ }) }).locator(".update-after"))
    .toContainText("このターンに出席した出席者だけ");
  await expect(entry.locator(".update-change").filter({ has: page.locator("strong", { hasText: /^カードテスト$/ }) }).locator(".update-after"))
    .toContainText("必要な進化素材、対象、山札上部、相手の手札、環境カード、校外エリアのカード");
});
