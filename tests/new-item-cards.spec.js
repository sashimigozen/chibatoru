const { test, expect } = require("@playwright/test");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const gameUrl = pathToFileURL(path.join(__dirname, "..", "index.html")).href;

test.beforeEach(async ({ page }) => {
  await page.goto(gameUrl);
});

test("新しい持ち物5種を⚪︎表記と既存文体で登録する", async ({ page }) => {
  const result = await page.evaluate(() => {
    const api = window.__chibattle;
    return [
      "classroom_change",
      "annoying_na",
      "childhood_memory_tutuapp",
      "jailbreak_tutuapp",
      "efficient_experiment_method"
    ].map((baseId) => {
      const card = api.createCardFromBase(baseId, "player");
      return {
        baseId,
        name: card.name,
        cost: card.cost,
        type: card.type,
        category: card.category,
        generated: Boolean(api.CARD_BASES[baseId].generated),
        text: api.cardRulesText(card)
      };
    });
  });

  expect(result.map((entry) => entry.name)).toEqual([
    "教室変更",
    "煩わしいなぁ",
    "-幼き日の思い出-⚪︎u⚪︎uApp",
    "ジェイルブレイクソフト-⚪︎u⚪︎uApp",
    "効率的な実験法"
  ]);
  expect(result.map((entry) => entry.cost)).toEqual([6, 4, 3, 3, 3]);
  expect(result.every((entry) => entry.type === "item")).toBe(true);
  expect(result.find((entry) => entry.baseId === "jailbreak_tutuapp").generated).toBe(true);
  expect(result.find((entry) => entry.baseId === "classroom_change").text)
    .toBe("相手の講義室にいる出席者すべてを遅刻ゾーンに置き、それらに[遅刻1]を付与する。");

  const sources = ["index.html", "card_rules.txt", "カード管理台帳.html"]
    .map((file) => fs.readFileSync(path.join(__dirname, "..", file), "utf8"));
  for (const source of sources) {
    expect(source).toContain("ジェイルブレイクソフト-⚪︎u⚪︎uApp");
    expect(source).not.toContain("ジェイルブレイクソフト-TuTuApp");
  }
});

test("教室変更は相手の出席者を遅刻1にし、戻れない出席者を校外へ送る", async ({ page }) => {
  const result = await page.evaluate(() => {
    const api = window.__chibattle;
    const { state } = api;
    api.startCardTest("classroom_change");
    state.phase = "battle";
    state.currentSide = "player";
    state.players.player.will = 10;
    state.players.player.hand = [];
    state.players.opponent.board.seats.fill(null);
    state.players.opponent.board.teacher = null;
    state.players.opponent.late = [];
    state.players.opponent.trash = [];

    const returning = api.makeBoardCard(api.createCardFromBase("general_student", "opponent"));
    returning.attack = 4;
    returning.currentHp = 1;
    const blocked = api.makeBoardCard(api.createCardFromBase("strong_student", "opponent"));
    state.players.opponent.board.seats[1] = returning;
    state.players.opponent.board.seats[0] = blocked;
    const item = api.createCardFromBase("classroom_change", "player");
    state.players.player.hand = [item];
    api.castImmediateItem("player", item, false);

    const lateBefore = state.players.opponent.late.map((entry) => ({
      id: entry.card.instanceId,
      remaining: entry.remaining,
      preserve: entry.preserveBoardState
    }));
    state.players.opponent.board.seats[0] = api.makeBoardCard(api.createCardFromBase("aggro_student", "opponent"));
    api.resolveLateZone("opponent");
    return {
      lateBefore,
      returnedAttack: state.players.opponent.board.seats[1]?.attack,
      returnedHp: state.players.opponent.board.seats[1]?.currentHp,
      blockedSentToTrash: state.players.opponent.trash.some((card) => card.instanceId === blocked.instanceId)
    };
  });

  expect(result.lateBefore).toHaveLength(2);
  expect(result.lateBefore.every((entry) => entry.remaining === 1 && entry.preserve)).toBe(true);
  expect(result.returnedAttack).toBe(4);
  expect(result.returnedHp).toBe(1);
  expect(result.blockedSentToTrash).toBe(true);
});

test("煩わしいなぁは開始時だけ使え、指定された使用時効果だけを止める", async ({ page }) => {
  const result = await page.evaluate(() => {
    const api = window.__chibattle;
    const { state } = api;
    api.startCardTest("annoying_na");
    state.phase = "battle";
    state.currentSide = "player";
    state.players.player.will = 10;
    state.players.player.turnActionTaken = false;
    const lock = api.createCardFromBase("annoying_na", "player");
    state.players.player.hand = [lock];
    const used = api.castImmediateItem("player", lock, false);
    const lockCounters = [state.players.player.effectUseLockTurnsRemaining, state.players.opponent.effectUseLockTurnsRemaining];

    const army = api.createCardFromBase("aggro_army", "player");
    state.players.player.hand = [army];
    const suppressed = api.castImmediateItem("player", army, false);
    const generated = state.players.player.hand.some((card) => ["aggro_student", "aggro_king", "aggro_queen"].includes(card.baseId));

    state.players.player.effectUseLockTurnsRemaining = 0;
    state.players.opponent.effectUseLockTurnsRemaining = 0;
    state.players.player.turnActionTaken = true;
    const second = api.createCardFromBase("annoying_na", "player");
    state.players.player.hand = [second];
    const blockedAfterAction = api.castImmediateItem("player", second, false);
    return {
      used,
      counters: lockCounters,
      suppressed,
      generated,
      armyInTrash: state.players.player.trash.some((card) => card.baseId === "aggro_army"),
      blockedAfterAction
    };
  });

  expect(result.used).toBe(true);
  expect(result.counters).toEqual([2, 2]);
  expect(result.suppressed).toBe(true);
  expect(result.generated).toBe(false);
  expect(result.armyInTrash).toBe(true);
  expect(result.blockedAfterAction).toBe(false);
});

test("幼き日の思い出は手札で3回ターン開始を迎えると⚪︎表記のカードへ変化する", async ({ page }) => {
  const result = await page.evaluate(() => {
    const api = window.__chibattle;
    const { state } = api;
    state.players.player.hand = [api.createCardFromBase("childhood_memory_tutuapp", "player")];
    api.resolveHandTurnEffects("player");
    api.resolveHandTurnEffects("player");
    const before = state.players.player.hand[0].baseId;
    api.resolveHandTurnEffects("player");
    return { before, after: state.players.player.hand[0].baseId, name: state.players.player.hand[0].name };
  });
  expect(result).toEqual({
    before: "childhood_memory_tutuapp",
    after: "jailbreak_tutuapp",
    name: "ジェイルブレイクソフト-⚪︎u⚪︎uApp"
  });
});

test("効率的な実験法は学生・教師・持ち物を1枚ずつ手札へ加える", async ({ page }) => {
  const result = await page.evaluate(() => {
    const api = window.__chibattle;
    const { state } = api;
    state.phase = "battle";
    state.currentSide = "player";
    state.players.player.will = 10;
    const item = api.createCardFromBase("efficient_experiment_method", "player");
    state.players.player.hand = [item];
    state.players.player.deck = [
      api.createCardFromBase("general_student", "player"),
      api.createCardFromBase("general_teacher", "player"),
      api.createCardFromBase("hondara", "player")
    ];
    api.castImmediateItem("player", item, false);
    return state.players.player.hand.map((card) => card.type).sort();
  });
  expect(result).toEqual(["item", "student", "teacher"]);
});

test("ジェイルブレイクは両者を無料出席させ、戦意差で使用者側を強化して引く", async ({ page }) => {
  const result = await page.evaluate(() => {
    const api = window.__chibattle;
    const { state } = api;
    state.phase = "battle";
    state.currentSide = "player";
    state.players.player.will = 10;
    state.players.player.board.seats.fill(null);
    state.players.player.board.teacher = null;
    state.players.opponent.board.seats.fill(null);
    state.players.opponent.board.teacher = null;
    const item = api.createCardFromBase("jailbreak_tutuapp", "player");
    const own = api.createCardFromBase("general_student", "player");
    const enemy = api.createCardFromBase("strong_student", "opponent");
    state.players.player.hand = [item, own];
    state.players.opponent.hand = [enemy];
    state.players.player.deck = Array.from({ length: 5 }, () => api.createCardFromBase("hondara", "player"));
    const used = api.resolveJailbreak("player", item, own.instanceId, enemy.instanceId, false);
    const ownBoard = state.players.player.board.seats.find(Boolean);
    const enemyBoard = state.players.opponent.board.seats.find(Boolean);
    return {
      used,
      will: state.players.player.will,
      own: ownBoard ? { attack: ownBoard.attack, hp: ownBoard.currentHp } : null,
      enemy: enemyBoard?.baseId || null,
      handCount: state.players.player.hand.length,
      itemInTrash: state.players.player.trash.some((card) => card.baseId === "jailbreak_tutuapp")
    };
  });
  expect(result).toEqual({
    used: true,
    will: 7,
    own: { attack: 6, hp: 6 },
    enemy: "strong_student",
    handCount: 4,
    itemInTrash: true
  });
});

test("ver.0.23.6の同日更新情報へ5枚を統合する", async ({ page }) => {
  await page.evaluate(() => {
    const api = window.__chibattle;
    api.state.screen = "home";
    api.render();
  });
  await page.locator("#homeUpdatesButton").click();
  const entry = page.locator(".update-entry", { hasText: "2026年9月26日" }).first();
  await expect(entry.locator("summary")).toContainText("ver.0.23.6");
  await entry.locator("summary").click();
  for (const name of ["教室変更", "煩わしいなぁ", "-幼き日の思い出-⚪︎u⚪︎uApp", "ジェイルブレイクソフト-⚪︎u⚪︎uApp", "効率的な実験法"]) {
    await expect(entry.locator(".update-change", { hasText: name }).last()).toBeVisible();
  }
});
