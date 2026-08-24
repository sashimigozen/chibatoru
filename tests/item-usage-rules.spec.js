const { test, expect } = require("@playwright/test");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const gameUrl = pathToFileURL(path.join(__dirname, "..", "index.html")).href;

test("持ち物の使用可否と対象条件が効果処理と一致する", async ({ page }) => {
  await page.goto(gameUrl);

  const result = await page.evaluate(() => {
    const api = window.__chibattle;
    const { state } = api;

    function resetBattle() {
      state.phase = "battle";
      state.currentSide = "player";
      state.gameOver = false;
      state.aiThinking = false;
      state.actionTurn = 1;
      state.pendingCardPlay = null;
      state.players.player.life = 20;
      state.players.opponent.life = 20;
      ["player", "opponent"].forEach((side) => {
        state.players[side].will = 10;
        state.players[side].hand = [];
        state.players[side].deck = [];
        state.players[side].trash = [];
        state.players[side].late = [];
        state.players[side].board.seats = Array(9).fill(null);
        state.players[side].board.teacher = null;
      });
    }

    function card(baseId, owner = "player") {
      return api.createCardFromBase(baseId, owner);
    }

    function attendee(baseId, owner = "player") {
      return api.makeBoardCard(card(baseId, owner));
    }

    const checks = {};

    resetBattle();
    const titleMatch = card("aiben_vs_nyotei_title_match");
    state.players.player.hand = [titleMatch];
    checks.titleMatchUsable = api.canUseHandCardNow(titleMatch);
    checks.titleMatchResolved = api.resolveTitleMatch("player", titleMatch, "aiben", [], false);
    checks.titleMatchPlacedBothSides = state.players.player.board.seats.some((entry) => entry?.baseId === "aiben")
      && state.players.opponent.board.seats.some((entry) => entry?.baseId === "nyotei");

    resetBattle();
    const blockedTitleMatch = card("aiben_vs_nyotei_title_match");
    state.players.player.hand = [blockedTitleMatch];
    state.players.player.board.seats = Array.from({ length: 9 }, () => attendee("general_student"));
    state.players.opponent.board.seats = Array.from({ length: 9 }, () => attendee("general_student", "opponent"));
    checks.titleMatchBlockedWithoutSeats = !api.canUseHandCardNow(blockedTitleMatch);

    resetBattle();
    const ownTarget = attendee("general_student");
    const padlock = card("padlock");
    state.players.player.board.seats[0] = ownTarget;
    state.players.player.hand = [padlock];
    checks.padlockUsableOnFullHp = api.canUseHandCardNow(padlock)
      && api.canUseItemOnBoardTarget(padlock, "player", "seat", 0);
    checks.padlockResolved = api.castItemOnCard("player", padlock, "player", "seat", 0, false);
    const generatedKey = state.players.player.hand.find((entry) => entry.baseId === "key");
    checks.keyGenerated = Boolean(generatedKey);
    checks.padlockCannotStack = !api.canUseItemOnBoardTarget(card("padlock"), "player", "seat", 0);
    checks.keyUsableOnOwnAttendee = Boolean(generatedKey)
      && api.canUseHandCardNow(generatedKey)
      && api.canUseItemOnBoardTarget(generatedKey, "player", "seat", 0);
    checks.printedEffectDisabledWhileLocked = !api.canUsePrintedCardEffects(ownTarget);
    checks.ownKeyResolved = api.castItemOnCard("player", generatedKey, "player", "seat", 0, false);
    checks.padlockMovedToTrash = state.players.player.trash.some((entry) => entry.baseId === "padlock");
    checks.printedEffectRestoredAfterUnlock = api.canUsePrintedCardEffects(ownTarget);

    resetBattle();
    const enemyTarget = attendee("general_student", "opponent");
    enemyTarget.padlockEquipment = card("padlock", "opponent");
    state.players.opponent.board.seats[0] = enemyTarget;
    const enemyKey = card("key");
    state.players.player.hand = [enemyKey];
    checks.keyUsableOnEnemyAttendee = api.canUseHandCardNow(enemyKey)
      && api.canUseItemOnBoardTarget(enemyKey, "opponent", "seat", 0);
    checks.enemyKeyResolved = api.castItemOnCard("player", enemyKey, "opponent", "seat", 0, false);
    checks.enemyPadlockMovedToOwnerTrash = state.players.opponent.trash.some((entry) => entry.baseId === "padlock");

    resetBattle();
    const keyWithoutLock = card("key");
    state.players.player.board.seats[0] = attendee("general_student");
    state.players.player.hand = [keyWithoutLock];
    checks.keyBlockedWithoutPadlock = !api.canUseHandCardNow(keyWithoutLock)
      && !api.canUseItemOnBoardTarget(keyWithoutLock, "player", "seat", 0);

    resetBattle();
    const aggroTarget = attendee("general_student");
    const aggroEater = card("aggro_eater");
    state.players.player.life = 19;
    state.players.player.board.seats[0] = aggroTarget;
    state.players.player.hand = [aggroEater];
    checks.aggroEaterUsableAtFullHp = api.canUseHandCardNow(aggroEater);
    checks.aggroEaterResolved = api.castItemOnCard("player", aggroEater, "player", "seat", 0, false);
    checks.aggroEaterHealedLife = state.players.player.life === 20;

    resetBattle();
    const bentoTarget = attendee("general_student");
    const bento = card("bento");
    state.players.player.board.seats[0] = bentoTarget;
    state.players.player.hand = [bento];
    checks.bentoBlockedAtFullHp = !api.canUseHandCardNow(bento);
    bentoTarget.currentHp -= 1;
    checks.bentoUsableWhenWounded = api.canUseHandCardNow(bento)
      && api.canUseItemOnBoardTarget(bento, "player", "seat", 0);

    resetBattle();
    checks.unusableCardsRemainBlocked = ["alpha", "beta", "suspicious_document"].every((baseId) => {
      const unusable = card(baseId);
      state.players.player.hand = [unusable];
      return !api.canUseHandCardNow(unusable);
    });

    return checks;
  });

  Object.entries(result).forEach(([name, passed]) => {
    expect(passed, name).toBe(true);
  });
});

test("タイトルマッチは0枚選択、既存の対、各自の捨札数を正しく処理する", async ({ page }) => {
  await page.goto(gameUrl);

  const result = await page.evaluate(() => {
    const api = window.__chibattle;
    const { state } = api;

    function resetBattle() {
      state.phase = "battle";
      state.currentSide = "player";
      state.gameOver = false;
      state.aiThinking = false;
      state.actionTurn = 1;
      state.pendingCardChoice = null;
      state.pendingCardPlay = null;
      state.pendingRemoteHandTrim = null;
      state.selectedHandId = null;
      state.selectedAttacker = null;
      state.log = [];
      ["player", "opponent"].forEach((side) => {
        state.players[side].will = 10;
        state.players[side].hand = [];
        state.players[side].deck = [];
        state.players[side].trash = [];
        state.players[side].late = [];
        state.players[side].board.seats = Array(9).fill(null);
        state.players[side].board.teacher = null;
      });
    }

    function card(baseId, owner = "player") {
      return api.createCardFromBase(baseId, owner);
    }

    function attendee(baseId, owner = "player") {
      return api.makeBoardCard(card(baseId, owner));
    }

    const checks = {};

    resetBattle();
    const onlyTitleMatch = card("aiben_vs_nyotei_title_match");
    state.players.player.hand = [onlyTitleMatch];
    api.beginItemUse(onlyTitleMatch);
    const aibenChoice = state.pendingCardChoice?.cards.find((entry) => entry.baseId === "aiben");
    checks.onlyTitleMatchOpened = state.pendingCardChoice?.mode === "title_match" && Boolean(aibenChoice);
    state.pendingCardChoice.selectedIds = [aibenChoice.instanceId];
    api.confirmCardChoiceSelection();
    checks.onlyTitleMatchResolved = state.pendingCardChoice === null
      && !state.players.player.hand.some((entry) => entry.instanceId === onlyTitleMatch.instanceId)
      && state.players.player.trash.some((entry) => entry.instanceId === onlyTitleMatch.instanceId)
      && state.players.player.board.seats.some((entry) => entry?.baseId === "aiben")
      && state.players.opponent.board.seats.some((entry) => entry?.baseId === "nyotei")
      && state.log.some((entry) => entry.includes(onlyTitleMatch.name));

    resetBattle();
    const repeatedTitleMatch = card("aiben_vs_nyotei_title_match");
    state.players.player.board.seats[0] = attendee("aiben");
    state.players.opponent.board.seats[0] = attendee("nyotei", "opponent");
    state.players.player.hand = [repeatedTitleMatch];
    checks.existingPairUsable = api.canUseHandCardNow(repeatedTitleMatch);
    api.beginItemUse(repeatedTitleMatch);
    const nyoteiChoice = state.pendingCardChoice?.cards.find((entry) => entry.baseId === "nyotei");
    state.pendingCardChoice.selectedIds = [nyoteiChoice.instanceId];
    api.confirmCardChoiceSelection();
    checks.existingPairResolved = !state.players.player.hand.some((entry) => entry.instanceId === repeatedTitleMatch.instanceId)
      && state.players.player.board.seats.filter((entry) => entry?.baseId === "aiben" || entry?.baseId === "nyotei").length === 2
      && state.players.opponent.board.seats.filter((entry) => entry?.baseId === "aiben" || entry?.baseId === "nyotei").length === 2;

    resetBattle();
    const titleMatch = card("aiben_vs_nyotei_title_match");
    const ownDiscardCards = [card("general_student"), card("general_teacher"), card("bento")];
    const opponentDiscardCard = card("general_student", "opponent");
    const ownAiben = attendee("aiben");
    const opponentNyotei = attendee("nyotei", "opponent");
    state.players.player.board.seats[0] = ownAiben;
    state.players.opponent.board.seats[0] = opponentNyotei;
    state.players.player.hand = [titleMatch, ...ownDiscardCards];
    state.players.opponent.hand = [opponentDiscardCard];
    const ownBefore = { attack: ownAiben.attack, maxHp: ownAiben.maxHp, currentHp: ownAiben.currentHp };
    const opponentBefore = {
      attack: opponentNyotei.attack,
      maxHp: opponentNyotei.maxHp,
      currentHp: opponentNyotei.currentHp
    };
    const resolved = api.resolveTitleMatch(
      "player",
      titleMatch,
      "aiben",
      ownDiscardCards.map((entry) => entry.instanceId),
      false,
      { opponentDiscardIds: [opponentDiscardCard.instanceId] }
    );
    checks.perSideDiscardBuffs = resolved
      && ownAiben.attack === ownBefore.attack + 3
      && ownAiben.maxHp === ownBefore.maxHp + 3
      && ownAiben.currentHp === ownBefore.currentHp + 3
      && opponentNyotei.attack === opponentBefore.attack + 1
      && opponentNyotei.maxHp === opponentBefore.maxHp + 1
      && opponentNyotei.currentHp === opponentBefore.currentHp + 1
      && state.log[0]?.includes("+3/+3")
      && state.log[0]?.includes("+1/+1");

    return checks;
  });

  Object.entries(result).forEach(([name, passed]) => {
    expect(passed, name).toBe(true);
  });
});

test("バカでかい壁は盤面から1行目の学生2人を選んで効果を発動する", async ({ page }) => {
  await page.goto(gameUrl);

  const result = await page.evaluate(() => {
    const api = window.__chibattle;
    api.startCardTest("big_wall");
    const item = api.state.players.player.hand.find((card) => card.baseId === "big_wall");
    const first = api.state.players.player.board.seats[0];
    const second = api.state.players.player.board.seats[2];
    const initialWill = api.state.players.player.will;

    api.beginItemUse(item);
    const openedOnBoard = api.state.pendingMultiItem?.mode === "big_wall"
      && api.state.pendingCardChoice === null;
    api.handleBoardCardClick("player", "seat", 0);
    api.handleBoardCardClick("player", "seat", 2);
    const selectedTwo = api.state.pendingMultiItem?.targets.length === 2;
    api.confirmSelectedItemTargets();

    return {
      openedOnBoard,
      selectedTwo,
      itemConsumed: !api.state.players.player.hand.some((card) => card.instanceId === item.instanceId),
      spentWill: api.state.players.player.will === initialWill - 4,
      firstBuffed: first.currentHp === 3 && first.keywords.includes("注目"),
      secondBuffed: second.currentHp === 4 && second.keywords.includes("注目"),
      selectionCleared: api.state.pendingMultiItem === null && api.state.selectedHandId === null
    };
  });

  Object.entries(result).forEach(([name, passed]) => {
    expect(passed, name).toBe(true);
  });
});
test("履修登録結論パは選んだ5枚を番号順に引き、拒否時は戦意2を回復する", async ({ page }) => {
  await page.goto(gameUrl);

  const result = await page.evaluate(() => {
    const api = window.__chibattle;

    api.startCardTest("course_registration_party");
    const consentItem = api.state.players.player.hand.find((card) => card.baseId === "course_registration_party");
    api.openCourseRegistrationConsent({ mode: "test", sourceName: consentItem.name });
    const consentDisplay = {
      modalVisible: !document.getElementById("courseRegistrationConsentModal").classList.contains("hidden"),
      cardVisible: document.getElementById("courseRegistrationConsentCard").textContent.includes("履修登録結論パ"),
      textVisible: document.getElementById("courseRegistrationConsentText").textContent.includes("選んだカードを選んだ順番で1枚ずつ手札に加える。"),
      acceptVisible: document.getElementById("courseRegistrationAcceptButton").textContent === "了承する",
      rejectVisible: document.getElementById("courseRegistrationRejectButton").textContent === "拒否する"
    };
    api.rejectCourseRegistrationConsent();

    api.startCardTest("course_registration_party");
    const acceptedItem = api.state.players.player.hand.find((card) => card.baseId === "course_registration_party");
    api.openCourseRegistrationChoice(acceptedItem);
    const choice = api.state.pendingCardChoice;
    const selectionUsesDeckChoice = choice?.mode === "course_registration"
      && choice.min === 5
      && choice.max === 5
      && choice.cards.length === api.state.players.player.deck.length;
    const orderedIds = [4, 1, 3, 0, 2].map((index) => choice.cards[index].instanceId);
    orderedIds.forEach((instanceId) => {
      document.querySelector(`#threeGesturesHand [data-card-id="${instanceId}"]`).click();
    });
    const displayedOrder = orderedIds.map((instanceId) => (
      document.querySelector(`#threeGesturesHand [data-card-id="${instanceId}"] .choice-order-badge`)?.textContent
    ));
    api.confirmCardChoiceSelection();
    const acceptedResolved = api.state.courseRegistration?.remainingTurns?.player === 5
      && api.state.courseRegistration?.remainingTurns?.opponent === 5
      && api.state.courseRegistration.drawQueues.player.map((card) => card.instanceId).join(",") === orderedIds.join(",")
      && api.state.courseRegistration.drawQueues.opponent.length === 5
      && displayedOrder.join(",") === "1,2,3,4,5"
      && orderedIds.every((id) => !api.state.players.player.trash.some((card) => card.instanceId === id));

    const firstDraw = api.drawCourseRegistrationCard("player");
    const selectedCardAdded = firstDraw.drawn?.instanceId === orderedIds[0]
      && api.state.pendingCardChoice === null
      && api.state.players.player.hand.some((card) => card.instanceId === orderedIds[0])
      && api.state.courseRegistration.remainingTurns.player === 4
      && api.state.courseRegistration.remainingTurns.opponent === 5;
    const laterDraws = Array.from({ length: 4 }, () => api.drawCourseRegistrationCard("player").drawn?.instanceId);
    const selectedOrderPreserved = laterDraws.join(",") === orderedIds.slice(1).join(",");

    api.startCardTest("course_registration_party");
    const rejectedItem = api.state.players.player.hand.find((card) => card.baseId === "course_registration_party");
    const willBeforeRejection = api.state.players.player.will;
    const rejected = api.resolveCourseRegistrationRejection("player", rejectedItem, { renderAfter: false });
    const rejectionResolved = rejected
      && api.state.players.player.will === willBeforeRejection
      && !api.state.players.player.hand.some((card) => card.instanceId === rejectedItem.instanceId)
      && api.state.players.player.trash.some((card) => card.instanceId === rejectedItem.instanceId);

    return { ...consentDisplay, selectionUsesDeckChoice, acceptedResolved, selectedCardAdded, selectedOrderPreserved, rejectionResolved };
  });

  Object.entries(result).forEach(([name, passed]) => {
    expect(passed, name).toBe(true);
  });
});

test("やめるはカードテスト中だけ表示され、通常対戦では使用できない", async ({ page }) => {
  await page.goto(gameUrl);

  const result = await page.evaluate(() => {
    const api = window.__chibattle;
    api.startCardTest("general_student");
    const visibleInCardTest = api.isActiveCardTestBattle()
      && !document.getElementById("battleTestExitButton").classList.contains("hidden");
    const returnedFromTest = api.returnFromCardTestToDeck() && api.state.screen === "deck";

    api.state.screen = "battle";
    api.state.phase = "battle";
    api.state.testMode = false;
    api.state.testCardBaseId = null;
    const blockedOutsideTest = !api.isActiveCardTestBattle()
      && api.returnFromCardTestToDeck() === false
      && api.state.screen === "battle";

    return { visibleInCardTest, returnedFromTest, blockedOutsideTest };
  });

  Object.entries(result).forEach(([name, passed]) => {
    expect(passed, name).toBe(true);
  });
});

test("履修登録結論パの使用者側5枚選択はオンライン同期後も保持される", async ({ page }) => {
  await page.goto(gameUrl);

  const result = await page.evaluate(() => {
    const api = window.__chibattle;
    api.startCardTest("course_registration_party");
    api.state.online.role = "guest";
    api.state.online.started = true;

    const cards = api.state.players.player.deck;
    api.state.pendingCardChoice = {
      mode: "course_registration_online_source_response",
      title: "履修登録結論パ",
      message: "自分のデッキから、今後引きたい順番でカードを5枚選んでください。",
      cards: [...cards],
      selectedIds: cards.slice(0, 2).map((card) => card.instanceId),
      min: 5,
      max: 5,
      confirmLabel: "この順番で確定",
      requestId: "course-registration-source-test"
    };

    const preserved = api.preserveOnlineCourseRegistrationChoice();
    api.state.pendingCardChoice = null;
    api.restoreOnlineCourseRegistrationChoice(preserved);

    return {
      choiceRestored: api.state.pendingCardChoice?.mode === "course_registration_online_source_response",
      deckCardsRestored: api.state.pendingCardChoice?.cards.length === cards.length,
      selectedCardsRestored: api.state.pendingCardChoice?.selectedIds.length === 2,
      requestRestored: api.state.pendingCardChoice?.requestId === "course-registration-source-test"
    };
  });

  Object.entries(result).forEach(([name, passed]) => {
    expect(passed, name).toBe(true);
  });
});

test("履修登録結論パの了承・拒否画面はゲスト側のオンライン同期後も保持される", async ({ page }) => {
  await page.goto(gameUrl);

  const result = await page.evaluate(() => {
    const api = window.__chibattle;
    api.startCardTest("course_registration_party");
    api.state.online.role = "guest";
    api.state.online.started = true;
    api.openCourseRegistrationConsent({
      mode: "online_remote_target",
      requestId: "course-registration-consent-test",
      sourceName: "履修登録結論パ"
    });

    const preserved = api.preserveOnlineCourseRegistrationConsent();
    document.getElementById("courseRegistrationConsentModal").classList.add("hidden");
    api.restoreOnlineCourseRegistrationConsent(preserved);

    return {
      consentRestored: !document.getElementById("courseRegistrationConsentModal").classList.contains("hidden"),
      cardRestored: document.getElementById("courseRegistrationConsentCard").textContent.includes("履修登録結論パ"),
      acceptRestored: document.getElementById("courseRegistrationAcceptButton").textContent === "了承する",
      rejectRestored: document.getElementById("courseRegistrationRejectButton").textContent === "拒否する"
    };
  });

  Object.entries(result).forEach(([name, passed]) => {
    expect(passed, name).toBe(true);
  });
});

test("更新情報を追記すると赤い通知が表示され、一度見ると消える", async ({ page }) => {
  await page.goto(gameUrl);
  await page.evaluate(() => localStorage.setItem("chibattle-read-updates-v3", JSON.stringify(["ver.0.19.0"])));
  await page.reload();

  await expect(page.locator("#homeUpdatesDot")).not.toHaveClass(/hidden/);
  await page.locator("#homeUpdatesButton").click();
  await expect(page.locator("#homeUpdatesDot")).toHaveClass(/hidden/);
  await page.reload();
  await expect(page.locator("#homeUpdatesDot")).toHaveClass(/hidden/);
});
