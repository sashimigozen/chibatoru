const { test, expect } = require("@playwright/test");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const gameUrl = pathToFileURL(path.join(__dirname, "..", "index.html")).href;

test.beforeEach(async ({ page }) => {
  await page.goto(gameUrl);
  await page.evaluate(() => {
    const api = window.__chibattle;
    api.startCardTest("general_student");
    api.state.screen = "battle";
    api.state.phase = "battle";
    api.state.currentSide = "player";
    for (const side of ["player", "opponent"]) {
      api.state.players[side].board = { teacher: null, seats: Array(9).fill(null) };
      api.state.players[side].hand = [];
      api.state.players[side].attendancesThisTurn = 0;
      api.state.players[side].will = 20;
    }
  });
});

test("ベストフレンドはバカでかいカードに隣接すると強化され、その効果ダメージを受けない", async ({ page }) => {
  const result = await page.evaluate(() => {
    const api = window.__chibattle;
    const friend = api.makeBoardCard(api.createCardFromBase("best_friend", "player"));
    const big = api.makeBoardCard(api.createCardFromBase("loud_members", "player"));
    const target = api.makeBoardCard(api.createCardFromBase("general_student", "opponent"));
    api.state.players.player.board.seats[0] = friend;
    api.state.players.player.board.seats[1] = big;
    api.state.players.opponent.board.seats[0] = target;
    api.applyBoardAuras();
    const buffed = { attack: friend.attack, hp: friend.maxHp };
    const damage = api.dealDamageToCard(friend, 2, big);
    const hpAfterDamage = friend.currentHp;
    api.resolveEndTurnEffects("player");
    return {
      buffed,
      damage,
      hpAfterDamage,
      targetHpAfterTurn: target.currentHp,
      rules: api.cardRulesText(api.createCardFromBase("best_friend", "player"))
    };
  });

  expect(result.buffed).toEqual({ attack: 3, hp: 4 });
  expect(result.damage).toBe(0);
  expect(result.hpAfterDamage).toBe(4);
  expect(result.targetHpAfterTurn).toBe(2);
  expect(result.rules).toContain("「バカでかい」とつくカードの効果によるダメージを受けない");
  expect(result.rules).not.toContain("3ダメージ");
});

test("ベストフレンドは手札から出席した場合だけバカでかいカードを1枚引く", async ({ page }) => {
  const result = await page.evaluate(() => {
    const api = window.__chibattle;
    const first = api.createCardFromBase("loud_student", "player");
    const second = api.createCardFromBase("loud_typing_student", "player");
    api.state.players.player.deck = [api.createCardFromBase("ruler", "player"), first, second];
    const friend = api.makeBoardCard(api.createCardFromBase("best_friend", "player"));
    api.attendCard("player", friend, "seat", 0, { attendanceSource: api.ATTENDANCE_SOURCE.HAND });
    const handAfterFirst = api.state.players.player.hand.map((card) => card.instanceId);
    const generated = api.makeBoardCard(api.createCardFromBase("best_friend", "player"));
    api.attendCard("player", generated, "seat", 3, { attendanceSource: api.ATTENDANCE_SOURCE.GENERATED });
    return { drewFirst: handAfterFirst.includes(first.instanceId), drewSecond: handAfterFirst.includes(second.instanceId),
      handSizeAfterGenerated: api.state.players.player.hand.length,
      secondStillInDeck: api.state.players.player.deck.some((card) => card.instanceId === second.instanceId) };
  });
  expect(result).toEqual({ drewFirst: true, drewSecond: false, handSizeAfterGenerated: 1, secondStillInDeck: true });
});

test("敵はTRPGサークルメンバーがいる間だけ戦意-1と攻撃力+5を得て、4枚以上入れられる", async ({ page }) => {
  const result = await page.evaluate(() => {
    const api = window.__chibattle;
    const enemy = api.makeBoardCard(api.createCardFromBase("enemy_student", "player"));
    const inHand = api.createCardFromBase("enemy_student", "player");
    api.state.players.player.hand = [inHand];
    api.state.players.player.board.seats[0] = enemy;
    const before = api.effectiveCardCost(inHand);
    api.state.players.opponent.board.seats[0] = api.makeBoardCard(api.createCardFromBase("trpg_member", "opponent"));
    api.applyBoardAuras();
    const active = { cost: api.effectiveCardCost(inHand), attack: enemy.attack, cheerful: api.hasKeyword(enemy, "陽気") };
    api.state.players.opponent.board.seats[0] = null;
    api.applyBoardAuras();
    return { before, active, after: api.effectiveCardCost(inHand), limit: api.maxCopiesForCard("enemy_student") };
  });

  expect(result).toEqual({ before: 2, active: { cost: 1, attack: 6, cheerful: true }, after: 2, limit: 60 });
});

test("アクティングアウトマンは相手の2回目の出席を止め、場を離れると解除する", async ({ page }) => {
  const result = await page.evaluate(() => {
    const api = window.__chibattle;
    const actor = api.makeBoardCard(api.createCardFromBase("acting_out_man", "opponent"));
    api.state.players.opponent.board.seats[0] = actor;
    const first = api.attendCard("player", api.makeBoardCard(api.createCardFromBase("general_student", "player")), "seat", 0);
    const secondCard = api.makeBoardCard(api.createCardFromBase("general_student", "player"));
    const blocked = api.canPlaceCard("player", secondCard, "seat", "player", 1);
    const forced = api.attendCard("player", secondCard, "seat", 1);
    api.state.players.opponent.board.seats[0] = null;
    const available = api.canPlaceCard("player", secondCard, "seat", "player", 1);
    const afterRemoval = api.attendCard("player", secondCard, "seat", 1);
    return { first: Boolean(first), blocked, forced: Boolean(forced), available, afterRemoval: Boolean(afterRemoval) };
  });

  expect(result).toEqual({ first: true, blocked: false, forced: false, available: true, afterRemoval: true });
});

test("バカでかい声の学生は他の出席者へ1ダメージを与え、ベストフレンドと隣接すると超陽気を持つ", async ({ page }) => {
  const result = await page.evaluate(() => {
    const api = window.__chibattle;
    const friend = api.makeBoardCard(api.createCardFromBase("best_friend", "player"));
    const ally = api.makeBoardCard(api.createCardFromBase("general_student", "player"));
    const opponent = api.makeBoardCard(api.createCardFromBase("general_student", "opponent"));
    api.state.players.player.board.seats[0] = friend;
    api.state.players.player.board.seats[3] = ally;
    api.state.players.opponent.board.seats[0] = opponent;
    const loud = api.makeBoardCard(api.createCardFromBase("loud_student", "player"));
    api.attendCard("player", loud, "seat", 1, { attendanceSource: api.ATTENDANCE_SOURCE.HAND });
    api.applyBoardAuras();
    return {
      friendHp: friend.currentHp,
      allyHp: ally.currentHp,
      opponentHp: opponent.currentHp,
      loudHp: loud.currentHp,
      hyperCheerful: api.hasKeyword(loud, "超陽気")
    };
  });

  expect(result).toEqual({ friendHp: 4, allyHp: 1, opponentHp: 1, loudHp: 9, hyperCheerful: true });
});

test("スタディアブローダーの2回出席で高負荷になり、ターン終了ダメージと破棄禁止が働く", async ({ page }) => {
  const result = await page.evaluate(() => {
    const api = window.__chibattle;
    const player = api.state.players.player;
    const opponent = api.state.players.opponent;
    const loaded = api.createCardFromBase("general_student", "opponent");
    opponent.hand = [loaded];
    const first = api.makeBoardCard(api.createCardFromBase("signal_professor_m", "player"));
    const second = api.makeBoardCard(api.createCardFromBase("signal_professor_m", "player"));
    api.attendCard("player", first, "teacher", null, { attendanceSource: api.ATTENDANCE_SOURCE.HAND });
    const oneLoad = loaded.handLoadLevel;
    api.attendCard("player", second, "seat", 0, { attendanceSource: api.ATTENDANCE_SOURCE.HAND });
    const highLoad = loaded.handLoadLevel;
    const third = api.makeBoardCard(api.createCardFromBase("signal_professor_m", "player"));
    api.attendCard("player", third, "seat", 1, { attendanceSource: api.ATTENDANCE_SOURCE.HAND });
    const cappedLoad = loaded.handLoadLevel;
    const text = api.cardRulesText(loaded);
    api.state.currentSide = "opponent";
    opponent.life = 20;
    api.resolveEndTurnEffects("opponent");
    const life = opponent.life;
    const discardAllowed = api.moveHandCardToTrash("opponent", loaded, { effectDiscard: true });
    const stillInHand = opponent.hand.some((card) => card.instanceId === loaded.instanceId);
    const stillOutOfTrash = !opponent.trash.some((card) => card.instanceId === loaded.instanceId);
    opponent.will = 10;
    const played = api.placeCardFromHand("opponent", loaded.instanceId, "seat", "opponent", 0, false);
    return { oneLoad, highLoad, cappedLoad, text, life, discardAllowed, stillInHand, stillOutOfTrash, played,
      boardLoad: opponent.board.seats[0]?.handLoadLevel ?? null, playerLife: player.life };
  });

  expect(result.oneLoad).toBe(1);
  expect(result.highLoad).toBe(2);
  expect(result.cappedLoad).toBe(2);
  expect(result.text).toContain("[高負荷]");
  expect(result.life).toBe(18);
  expect(result.discardAllowed).toBe(false);
  expect(result.stillInHand).toBe(true);
  expect(result.stillOutOfTrash).toBe(true);
  expect(result.played).toBe(true);
  expect(result.boardLoad).toBe(0);
});

test("高負荷は手札からの効果破棄を防ぐが、山札から校外エリアへは送れる", async ({ page }) => {
  const result = await page.evaluate(() => {
    const api = window.__chibattle;
    const card = api.createCardFromBase("general_student", "player");
    card.handLoadLevel = 2;
    api.state.players.player.hand = [card];
    const blocked = api.moveToTrash("player", card);
    api.state.players.player.hand = [];
    api.state.players.player.deck = [card];
    api.state.players.player.deck.shift();
    const moved = Boolean(api.moveToTrash("player", card, { sourceZone: "deck" }));
    return { blocked, moved, inTrash: api.state.players.player.trash.some((entry) => entry.instanceId === card.instanceId) };
  });

  expect(result).toEqual({ blocked: false, moved: true, inTrash: true });
});

test("手札の負荷は紫、高負荷は赤の透過色で表示し、手札を離れると解除する", async ({ page }) => {
  const cardIds = await page.evaluate(() => {
    const api = window.__chibattle;
    const loaded = api.createCardFromBase("general_student", "player");
    const highLoaded = api.createCardFromBase("general_teacher", "player");
    loaded.handLoadLevel = 1;
    highLoaded.handLoadLevel = 2;
    api.state.players.player.hand = [loaded, highLoaded];
    api.render();
    return { loaded: loaded.instanceId, highLoaded: highLoaded.instanceId };
  });

  const loaded = page.locator(`.player-hand .hand-card[data-card-id="${cardIds.loaded}"]`);
  const highLoaded = page.locator(`.player-hand .hand-card[data-card-id="${cardIds.highLoaded}"]`);
  await expect(loaded).toHaveClass(/\bhand-load\b/);
  await expect(highLoaded).toHaveClass(/\bhand-high-load\b/);

  const overlayColors = await page.evaluate(({ loadedId, highLoadedId }) => {
    const color = (id) => getComputedStyle(document.querySelector(`[data-card-id="${id}"] .card-face`), "::after").backgroundColor;
    return { loaded: color(loadedId), highLoaded: color(highLoadedId) };
  }, { loadedId: cardIds.loaded, highLoadedId: cardIds.highLoaded });
  expect(overlayColors.loaded).toBe("rgba(119, 62, 181, 0.24)");
  expect(overlayColors.highLoaded).toBe("rgba(211, 47, 61, 0.24)");

  await page.evaluate((instanceId) => {
    const api = window.__chibattle;
    const card = api.state.players.player.hand.find((entry) => entry.instanceId === instanceId);
    api.state.players.player.hand = api.state.players.player.hand.filter((entry) => entry.instanceId !== instanceId);
    api.state.players.player.board.seats[0] = api.makeBoardCard(card);
    api.render();
  }, cardIds.loaded);
  await expect(page.locator(`.board-card[data-card-id="${cardIds.loaded}"]`)).not.toHaveClass(/hand-load|hand-high-load/);
});

test("ver.0.23.8のお知らせにカード変更、新カード、負荷のルールを表示する", async ({ page }) => {
  await page.goto(gameUrl);
  await page.locator("#homeUpdatesButton").click();
  const entry = page.locator(".update-entry").filter({ has: page.locator("summary", { hasText: "ver.0.23.8" }) });
  await expect(entry).toHaveCount(1);
  await expect(entry.locator(".update-change")).toHaveCount(16);
  for (const name of ["ベストフレンド", "敵", "アクティングアウトマン", "バカでかい声の学生", "パチンウニー", "スタディアブローダー"]) {
    await expect(entry.locator(".update-before strong").filter({ hasText: new RegExp(`^${name}$`) })).toHaveCount(1);
  }
  await expect(entry.locator(".update-change").filter({ has: page.locator(".update-before strong", { hasText: /^敵$/ }) }).locator(".update-after"))
    .toContainText("戦意2／攻撃力1／体力2");
  await expect(entry.locator(".update-after", { hasText: "スタディアブローダー" })).toContainText("戦意10／攻撃力2／体力4");
  await expect(entry.locator(".update-after", { hasText: "[高負荷]" })).toContainText("手札から校外エリアへ送れず");
  await expect(entry.locator(".update-after", { hasText: "ストレスヘアー" })).toContainText("装備カードは通常、1人につき1枚まで");
  await expect(entry.locator(".update-after", { hasText: "帽子男" })).toContainText("学生／共通カード／戦意5／攻撃力3／体力3");
  await expect(entry.locator(".update-after", { hasText: "三敵" })).toContainText("学生／展開・敵増殖／戦意3／攻撃力1／体力2");
});
