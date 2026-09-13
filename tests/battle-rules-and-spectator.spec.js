const { test, expect } = require("@playwright/test");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const gameUrl = pathToFileURL(path.join(__dirname, "..", "index.html")).href;

test("対戦中の非公開カードと山札はホームと共通の背面を使い、既存比率を保つ", async ({ page }) => {
  await page.goto(gameUrl);
  const result = await page.evaluate(() => {
    const api = window.__chibattle;
    api.state.screen = "battle";
    api.state.phase = "battle";
    api.state.players.opponent.hand = [
      api.createCardFromBase("general_student", "opponent"),
      api.createCardFromBase("aggro_student", "opponent")
    ];
    api.render();
    const back = document.querySelector("#opponentHand .card-back");
    const deck = document.getElementById("opponentDeckPile");
    const backRect = back.getBoundingClientRect();
    return {
      backImage: getComputedStyle(back).backgroundImage,
      deckImage: getComputedStyle(deck).backgroundImage,
      backRatio: backRect.width / backRect.height
    };
  });
  expect(result.backImage).toContain("assets/card-back.png");
  expect(result.deckImage).toContain("assets/card-back.png");
  expect(result.backRatio).toBeCloseTo(21 / 32, 2);
});

test("オンライン観戦者には両プレイヤーの手札を表向きで表示する", async ({ page }) => {
  await page.goto(gameUrl);
  const result = await page.evaluate(() => {
    const api = window.__chibattle;
    const playerCard = api.createCardFromBase("general_student", "player");
    const opponentCard = api.createCardFromBase("aggro_student", "opponent");
    const snapshot = api.onlineTransformSnapshotForSpectator({
      players: {
        player: { hand: [playerCard] },
        opponent: { hand: [opponentCard] }
      },
      message: "",
      log: []
    });
    api.state.online.role = "spectator";
    document.body.dataset.online = "spectator";
    api.state.screen = "battle";
    api.state.phase = "battle";
    api.state.players.player.hand = snapshot.players.player.hand;
    api.state.players.opponent.hand = snapshot.players.opponent.hand;
    api.render();
    return {
      hands: snapshot.players,
      playerText: document.getElementById("playerHand").textContent,
      opponentText: document.getElementById("opponentHand").textContent,
      playerBacks: document.querySelectorAll("#playerHand .card-back").length,
      opponentBacks: document.querySelectorAll("#opponentHand .card-back").length
    };
  });
  expect(result.hands.player.hand[0].name).toBe("一般学生");
  expect(result.hands.opponent.hand[0].name).toBe("アグロ大学生");
  expect(result.playerText).toContain("一般学生");
  expect(result.opponentText).toContain("アグロ大学生");
  expect(result.playerBacks).toBe(0);
  expect(result.opponentBacks).toBe(0);
});

test("ソロVS AIでカオスルールを選び、同名40枚のまま対戦を開始できる", async ({ page }) => {
  await page.goto(gameUrl);
  await page.evaluate(() => {
    const api = window.__chibattle;
    api.state.deckBuilder.chaosDecks = {
      "カオス確認用": { counts: { general_student: 40 } }
    };
    api.startSoloBattleFromHome();
  });

  await page.selectOption("#soloRuleSelect", "chaos");
  await page.locator("#soloPlayerSlot").click();
  await page.locator("#soloDeckGrid .deck-library-card", { hasText: "カオス確認用" }).click();
  await page.locator("#soloAiSlot").click();
  await page.locator("#soloDeckGrid .deck-library-card", { hasText: "カオス確認用" }).click();
  await expect(page.locator("#soloBattleStartButton")).toBeEnabled();
  await page.locator("#soloBattleStartButton").click();

  const result = await page.evaluate(() => ({
    ruleId: window.__chibattle.state.battleRuleId,
    deckLength: window.__chibattle.state.players.player.deck.length,
    originalCopies: window.__chibattle.state.players.player.originalDeckCounts.general_student,
    valid: window.__chibattle.state.players.player.deckValid.valid
  }));
  expect(result).toEqual({ ruleId: "chaos", deckLength: 40, originalCopies: 40, valid: true });
});

test("トレーニングでCPU同士を開始し、両方の初期手札を公開する", async ({ page }) => {
  await page.goto(gameUrl);
  await page.evaluate(() => {
    const api = window.__chibattle;
    api.state.deckBuilder.chaosDecks = {
      "CPU観戦確認用": { counts: { general_student: 40 } }
    };
    api.startSoloBattleFromHome();
  });

  await page.selectOption("#soloRuleSelect", "chaos");
  await page.locator("#soloLeftControllerButton").click();
  await page.locator("#soloPlayerSlot").click();
  await page.locator("#soloDeckGrid .deck-library-card", { hasText: "CPU観戦確認用" }).click();
  await page.locator("#soloAiSlot").click();
  await page.locator("#soloDeckGrid .deck-library-card", { hasText: "CPU観戦確認用" }).click();
  await page.locator("#soloBattleStartButton").click();

  await page.waitForFunction(() => {
    const api = window.__chibattle;
    return api.state.phase === "dealing"
      && api.state.players.player.hand.length > 0
      && api.state.players.opponent.hand.length > 0;
  });
  await expect(page.locator("#initialDealHand .training-initial-hand-group")).toHaveCount(2);
  await expect(page.locator("#initialDealHand")).toContainText("左側CPU");
  await expect(page.locator("#initialDealHand")).toContainText("右側CPU");
});

test("対戦開始処理が専攻ルールを通常ルールへ戻さない", async ({ page }) => {
  await page.goto(gameUrl);
  const result = await page.evaluate(() => {
    const api = window.__chibattle;
    const counts = {};
    [
      "general_student", "absolute_woman", "fridge_thief", "classroom", "environment_setup",
      "go_away", "happy_experience", "hondara", "water_2l", "word_increaser"
    ].forEach((baseId) => { counts[baseId] = 3; });
    ["adjective_student", "cancel_student", "eaten_student", "hurried_student", "lazy_student"]
      .forEach((baseId) => { counts[baseId] = 2; });
    counts.general_student -= 1;
    counts.tokyo_tech_bro = 1;
    api.state.deckBuilder.counts.player = counts;
    api.state.deckBuilder.counts.opponent = counts;
    const descriptor = { format: "specialty", specialtyId: "late", name: "専攻確認用" };
    api.initializeGame({ ruleId: "specialty", playerDeckDescriptor: descriptor, opponentDeckDescriptor: descriptor });
    return {
      ruleId: api.state.battleRuleId,
      aceCopies: api.state.players.player.originalDeckCounts.tokyo_tech_bro,
      valid: api.state.players.player.deckValid.valid
    };
  });
  expect(result).toEqual({ ruleId: "specialty", aceCopies: 1, valid: true });
});

test("ルール情報のないデッキ更新では選択済みルールを通常へ戻さない", async ({ page }) => {
  await page.goto(gameUrl);
  const result = await page.evaluate(() => {
    const api = window.__chibattle;
    api.state.online.roomRuleId = "chaos";
    const missingChanged = api.onlineApplyRoomRuleId(undefined);
    const invalidChanged = api.onlineApplyRoomRuleId("unknown-rule");
    return { ruleId: api.state.online.roomRuleId, missingChanged, invalidChanged };
  });
  expect(result).toEqual({ ruleId: "chaos", missingChanged: false, invalidChanged: false });
});

test("デッキ形式を省略したルーム状態でもゲストのカオス・専攻デッキ形式を維持する", async ({ page }) => {
  await page.goto(gameUrl);
  const result = await page.evaluate(() => {
    const api = window.__chibattle;
    const chaosName = api.onlineDeckDescriptorValue({ format: "chaos", kind: "saved", name: "カオス確認" });
    const specialtyName = api.onlineDeckDescriptorValue({
      format: "specialty",
      kind: "saved",
      name: "遅刻専攻確認",
      specialtyId: "late"
    });
    const chaos = api.onlineDeckDescriptorFromMessage({
      deckName: chaosName,
      deckFormat: undefined,
      specialtyId: undefined
    });
    const specialty = api.onlineDeckDescriptorFromMessage({
      deckName: specialtyName,
      deckFormat: undefined,
      specialtyId: undefined
    });
    return { chaos, specialty };
  });
  expect(result.chaos).toEqual({ format: "chaos", kind: "saved", specialtyId: "", name: "カオス確認" });
  expect(result.specialty).toEqual({
    format: "specialty",
    kind: "saved",
    specialtyId: "late",
    name: "遅刻専攻確認"
  });
});

test("オンライン準備画面の対戦者欄に保存デッキ名を表示しない", async ({ page }) => {
  await page.goto(gameUrl);
  const texts = await page.evaluate(() => {
    const api = window.__chibattle;
    const counts = {};
    [
      "general_student", "aggro_student", "aggro_king", "single_cell", "adjective_student", "yuta", "aggro_queen",
      "ae_student", "hurried_student", "lazy_student", "cancel_student", "back_question_student", "best_friend", "laughing_front_student"
    ].forEach((baseId) => { counts[baseId] = 3; });
    api.state.screen = "online";
    api.state.online.role = "host";
    api.state.online.localDeckName = "chibattle-online-deck-v1|normal|saved||%E7%A7%98%E5%AF%86%E3%81%AE%E8%87%AA%E5%88%86%E3%83%87%E3%83%83%E3%82%AD";
    api.state.online.remoteDeckName = "chibattle-online-deck-v1|normal|saved||%E7%A7%98%E5%AF%86%E3%81%AE%E7%9B%B8%E6%89%8B%E3%83%87%E3%83%83%E3%82%AD";
    api.state.deckBuilder.savedDecks["秘密の自分デッキ"] = { counts };
    api.state.online.localDeckCounts = counts;
    api.state.online.remoteDeckCounts = counts;
    api.state.online.remoteDeckValid = true;
    api.render();
    return {
      info: document.getElementById("onlineDeckInfo").textContent,
      local: document.getElementById("onlineLocalDeckText").textContent,
      remote: document.getElementById("onlineRemoteDeckText").textContent
    };
  });
  expect(`${texts.info} ${texts.local} ${texts.remote}`).not.toContain("秘密の");
  expect(texts.local).toContain("通常デッキ");
  expect(texts.remote).toBe("非公開");
});
