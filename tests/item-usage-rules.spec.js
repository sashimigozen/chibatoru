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
      state.suitStudentAttendanceCount = 0;
      state.pendingCardPlay = null;
      state.players.player.life = 20;
      state.players.opponent.life = 20;
      ["player", "opponent"].forEach((side) => {
        state.players[side].will = 10;
        state.players[side].internTurnsRemaining = 0;
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
    const aggroArmy = card("aggro_army");
    state.players.player.hand = [aggroArmy];
    checks.aggroArmyUsableWithoutTarget = api.canUseHandCardNow(aggroArmy);
    checks.aggroArmyResolved = api.castImmediateItem("player", aggroArmy, false);
    checks.aggroArmyGeneratedEachCard = ["aggro_student", "aggro_king", "aggro_queen"]
      .every((baseId) => state.players.player.hand.filter((entry) => entry.baseId === baseId).length === 1);
    checks.aggroArmyPaidTwoWill = state.players.player.will === 8;
    checks.aggroArmyMovedToTrash = state.players.player.trash.some((entry) => entry.baseId === "aggro_army");

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
    const suitedOwnTarget = attendee("yocchan");
    suitedOwnTarget.hasAttacked = true;
    suitedOwnTarget.earphoneEquipment = {
      ...card("earphones"),
      attachedTo: suitedOwnTarget.instanceId,
      attachedAtTurn: state.actionTurn
    };
    const suitedOwnTargetId = suitedOwnTarget.instanceId;
    state.players.player.board.seats[4] = suitedOwnTarget;
    state.players.opponent.board.teacher = attendee("general_teacher", "opponent");
    const ownBustSuit = card("bust_suit");
    state.players.player.hand = [ownBustSuit];
    checks.bustSuitUsableOnEitherClassroomStudent = api.canUseHandCardNow(ownBustSuit)
      && api.canUseItemOnBoardTarget(ownBustSuit, "player", "seat", 4);
    checks.bustSuitBlockedOnTeacher = !api.canUseItemOnBoardTarget(ownBustSuit, "opponent", "teacher", null);
    checks.bustSuitOwnTargetResolved = api.castItemOnCard("player", ownBustSuit, "player", "seat", 4, false);
    const transformedOwn = state.players.player.board.seats[4];
    checks.bustSuitOwnTargetBecameBaseSuitStudent = transformedOwn?.baseId === "suit_student"
      && transformedOwn.name === "スーツを着た学生"
      && transformedOwn.type === "student"
      && transformedOwn.attack === 1
      && transformedOwn.currentHp === 1
      && transformedOwn.instanceId === suitedOwnTargetId;
    checks.bustSuitPreservedEquipmentAndAttackState = transformedOwn?.hasAttacked === true
      && transformedOwn.earphoneEquipment?.baseId === "earphones"
      && transformedOwn.earphoneEquipment?.attachedTo === suitedOwnTargetId;
    checks.bustSuitCountedAndConsumed = state.suitStudentAttendanceCount === 1
      && state.players.player.will === 9
      && state.players.player.trash.some((entry) => entry.baseId === "bust_suit");

    resetBattle();
    const enemyStudent = attendee("loud_student", "opponent");
    state.players.opponent.board.seats[7] = enemyStudent;
    const enemyBustSuit = card("bust_suit");
    state.players.player.hand = [enemyBustSuit];
    checks.bustSuitEnemyTargetAllowed = api.canUseItemOnBoardTarget(enemyBustSuit, "opponent", "seat", 7)
      && api.castItemOnCard("player", enemyBustSuit, "opponent", "seat", 7, false);
    const transformedEnemy = state.players.opponent.board.seats[7];
    checks.bustSuitEnemyOwnerAndPositionRemain = transformedEnemy?.baseId === "suit_student"
      && transformedEnemy.owner === "opponent"
      && state.players.opponent.board.seats[7] === transformedEnemy
      && state.suitStudentAttendanceCount === 1;

    resetBattle();
    state.players.player.board.seats[0] = attendee("general_student");
    state.players.opponent.board.seats[0] = attendee("loud_student", "opponent");
    const firstIntern = card("intern");
    state.players.player.hand = [firstIntern];
    checks.internImmediatelyUsable = api.canUseHandCardNow(firstIntern)
      && api.castImmediateItem("player", firstIntern, false);
    checks.internStartedTwoTurnsEach = state.players.player.internTurnsRemaining === 2
      && state.players.opponent.internTurnsRemaining === 2;
    const firstPlayerTransform = api.resolveInternEndTurnEffect("player");
    const firstOpponentTransform = api.resolveInternEndTurnEffect("opponent");
    checks.internTransformsEachPlayersOwnStudent = firstPlayerTransform?.baseId === "suit_student"
      && firstPlayerTransform.owner === "player"
      && firstOpponentTransform?.baseId === "suit_student"
      && firstOpponentTransform.owner === "opponent"
      && state.players.player.internTurnsRemaining === 1
      && state.players.opponent.internTurnsRemaining === 1;

    const secondIntern = card("intern");
    state.players.player.hand = [secondIntern];
    checks.internReuseResetsInsteadOfStacking = api.castImmediateItem("player", secondIntern, false)
      && state.players.player.internTurnsRemaining === 2
      && state.players.opponent.internTurnsRemaining === 2;
    const noPlayerTarget = api.resolveInternEndTurnEffect("player");
    checks.internConsumesTurnWithoutTarget = noPlayerTarget === null
      && state.players.player.internTurnsRemaining === 1;

    const equippedStudent = attendee("yocchan");
    equippedStudent.hasAttacked = true;
    equippedStudent.earphoneEquipment = {
      ...card("earphones"),
      attachedTo: equippedStudent.instanceId,
      attachedAtTurn: state.actionTurn
    };
    state.players.player.board.seats[1] = equippedStudent;
    const secondPlayerTransform = api.resolveInternEndTurnEffect("player");
    checks.internSecondOwnTurnEndsEffectAndPreservesState = secondPlayerTransform?.baseId === "suit_student"
      && secondPlayerTransform.hasAttacked === true
      && secondPlayerTransform.earphoneEquipment?.baseId === "earphones"
      && state.players.player.internTurnsRemaining === 0;

    state.players.opponent.board.seats[1] = attendee("general_student", "opponent");
    const secondOpponentTransform = api.resolveInternEndTurnEffect("opponent");
    const noOpponentTarget = api.resolveInternEndTurnEffect("opponent");
    checks.internRunsExactlyTwiceForOpponent = secondOpponentTransform?.baseId === "suit_student"
      && noOpponentTarget === null
      && state.players.opponent.internTurnsRemaining === 0
      && state.suitStudentAttendanceCount === 4;

    resetBattle();
    state.screen = "battle";
    state.players.player.will = 7;
    const ghidorahEffect3 = card("king_ghidorah_bed");
    state.players.player.hand = [ghidorahEffect3];
    checks.kingGhidorahCostsFourBelowEight = api.effectiveCardCost(ghidorahEffect3) === 4;
    checks.kingGhidorahSingleBodyDamage = api.resolveKingGhidorahBed("player", ghidorahEffect3, "3", null, null, false)
      && state.players.player.will === 3
      && state.players.opponent.life === 16
      && state.players.player.trash.some((entry) => entry.baseId === "king_ghidorah_bed");

    resetBattle();
    state.screen = "battle";
    state.players.player.will = 7;
    const ghidorahEffect2 = card("king_ghidorah_bed");
    const ghidorahDiscard = card("general_student");
    const ghidorahDestroyTarget = attendee("loud_student", "opponent");
    state.players.player.hand = [ghidorahEffect2, ghidorahDiscard];
    state.players.opponent.board.seats[4] = ghidorahDestroyTarget;
    checks.kingGhidorahSingleDestroy = api.resolveKingGhidorahBed(
      "player",
      ghidorahEffect2,
      "2",
      ghidorahDiscard.instanceId,
      { owner: "opponent", zone: "seat", index: 4 },
      false
    )
      && state.players.player.will === 3
      && state.players.opponent.board.seats[4] === null
      && state.players.player.trash.some((entry) => entry.instanceId === ghidorahDiscard.instanceId)
      && state.players.opponent.trash.some((entry) => entry.instanceId === ghidorahDestroyTarget.instanceId);

    resetBattle();
    state.screen = "battle";
    state.players.player.will = 8;
    const forcedGhidorah = card("king_ghidorah_bed");
    const protectedDiscard = card("general_student");
    const diesToFirstEffect = attendee("general_student", "opponent");
    state.players.player.hand = [forcedGhidorah, protectedDiscard];
    state.players.opponent.board.seats[4] = diesToFirstEffect;
    checks.kingGhidorahCostsEightAtThreshold = api.effectiveCardCost(forcedGhidorah) === 8;
    checks.kingGhidorahForcedAllSkipsSecondWithoutDiscard = api.resolveKingGhidorahBed(
      "player",
      forcedGhidorah,
      "3",
      protectedDiscard.instanceId,
      { owner: "opponent", zone: "seat", index: 4 },
      false
    )
      && state.players.player.will === 0
      && state.players.opponent.life === 16
      && state.players.opponent.board.seats[4] === null
      && state.players.player.hand.some((entry) => entry.instanceId === protectedDiscard.instanceId)
      && !state.players.player.trash.some((entry) => entry.instanceId === protectedDiscard.instanceId);

    resetBattle();
    state.screen = "battle";
    state.players.player.will = 10;
    const allGhidorah = card("king_ghidorah_bed");
    const allDiscard = card("bento");
    const allTarget = attendee("loud_student", "opponent");
    const allAoeVictim = attendee("general_student", "opponent");
    state.players.player.hand = [allGhidorah, allDiscard];
    state.players.opponent.board.seats[4] = allTarget;
    state.players.opponent.board.seats[0] = allAoeVictim;
    checks.kingGhidorahForcedAllResolvesInOrder = api.resolveKingGhidorahBed(
      "player",
      allGhidorah,
      "1",
      allDiscard.instanceId,
      { owner: "opponent", zone: "seat", index: 4 },
      false
    )
      && state.players.player.will === 2
      && state.players.opponent.life === 16
      && state.players.opponent.board.seats[0] === null
      && state.players.opponent.board.seats[4] === null
      && state.players.player.trash.some((entry) => entry.instanceId === allDiscard.instanceId)
      && state.players.opponent.trash.some((entry) => entry.instanceId === allTarget.instanceId);

    resetBattle();
    state.screen = "battle";
    state.players.player.will = 7;
    const choiceGhidorah = card("king_ghidorah_bed");
    const choiceDiscard = card("bento");
    state.players.player.hand = [choiceGhidorah, choiceDiscard];
    state.players.opponent.board.seats[2] = attendee("loud_student", "opponent");
    api.beginItemUse(choiceGhidorah);
    const openedEffectChoice = state.pendingCardChoice?.mode === "king_ghidorah_effect";
    state.pendingCardChoice.selectedIds = ["king_ghidorah_effect_2"];
    api.confirmCardChoiceSelection();
    const openedDiscardChoice = state.pendingCardChoice?.mode === "king_ghidorah_discard";
    state.pendingCardChoice.selectedIds = [choiceDiscard.instanceId];
    api.confirmCardChoiceSelection();
    const waitingForBoardTarget = state.pendingKingGhidorahBed?.discardId === choiceDiscard.instanceId;
    api.handleBoardCardClick("opponent", "seat", 2);
    const waitingForDestroyConfirmation = state.pendingKingGhidorahBed?.target?.index === 2
      && state.players.opponent.board.seats[2]?.baseId === "loud_student";
    api.confirmSelectedItemTargets();
    checks.kingGhidorahUsesEffectChoiceThenDestroyConfirmation = openedEffectChoice
      && openedDiscardChoice
      && waitingForBoardTarget
      && waitingForDestroyConfirmation
      && state.players.player.will === 3
      && state.players.opponent.board.seats[2] === null
      && state.players.player.trash.some((entry) => entry.instanceId === choiceDiscard.instanceId);

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

test("一手戻るとやめるはカードテスト中だけ表示される", async ({ page }) => {
  await page.goto(gameUrl);

  const result = await page.evaluate(() => {
    const api = window.__chibattle;
    const displays = () => ({
      undo: getComputedStyle(document.getElementById("battleTestUndoButton")).display,
      exit: getComputedStyle(document.getElementById("battleTestExitButton")).display
    });
    const bothHidden = () => Object.values(displays()).every((display) => display === "none");

    api.startCardTest("general_student");
    const cardTestDisplays = displays();
    const visibleInCardTest = api.isActiveCardTestBattle()
      && cardTestDisplays.undo !== "none"
      && cardTestDisplays.exit !== "none";
    const returnedFromTest = api.returnFromCardTestToDeck() && api.state.screen === "deck";

    api.state.screen = "battle";
    api.state.phase = "battle";
    api.state.testMode = false;
    api.state.testCardBaseId = null;
    api.render();
    const hiddenInSolo = bothHidden();

    api.state.testMode = true;
    api.state.testCardBaseId = "general_student";
    api.state.tutorial.active = true;
    api.render();
    const hiddenInTutorial = bothHidden();

    api.state.tutorial.active = false;
    api.state.online.role = "guest";
    api.render();
    const hiddenOnline = bothHidden();
    const blockedOutsideTest = !api.isActiveCardTestBattle()
      && api.returnFromCardTestToDeck() === false
      && api.state.screen === "battle";

    return { visibleInCardTest, returnedFromTest, hiddenInSolo, hiddenInTutorial, hiddenOnline, blockedOutsideTest };
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

test("すべての装備カードを状態欄の「装」アイコンで統一表示する", async ({ page }) => {
  await page.goto(gameUrl);

  const result = await page.evaluate(() => {
    const api = window.__chibattle;
    const makeAttendee = (baseId = "general_student") => api.makeBoardCard(api.createCardFromBase(baseId, "player"));
    const equipmentCases = [
      ...["accelerate", "chameleon", "yuta_umbrella", "red_happi"].map((baseId) => {
        const card = makeAttendee("yuta");
        card.yutaEquipments = [{ baseId }];
        return { baseId, card };
      }),
      (() => {
        const card = makeAttendee();
        card.padlockEquipment = api.createCardFromBase("padlock", "player");
        return { baseId: "padlock", card };
      })(),
      (() => {
        const card = makeAttendee();
        card.earphoneEquipment = api.createCardFromBase("earphones", "player");
        return { baseId: "earphones", card };
      })()
    ];

    const cases = equipmentCases.map(({ baseId, card }) => {
      const parts = api.statusPartsForCard(card, true);
      const markup = api.fieldCardTemplate(card);
      const currentEffects = api.battleCardCurrentEffectsTemplate(card);
      const equipmentName = api.CARD_BASES[baseId].name;
      return {
        baseId,
        detected: api.hasEquipmentCard(card),
        iconCount: parts.filter((part) => part.tone === "equipment-status" && part.title === "装備カードあり").length,
        inStatusArea: markup.includes("status-icon equipment-status") && !markup.includes("field-card-equipment-mark"),
        detailListsEquipment: api.equipmentDetailText(card).includes(equipmentName),
        previewListsEquipment: currentEffects.markup.includes(`装備：${equipmentName}`)
          && Object.values(currentEffects.details).some((detail) => detail.title === `装備：${equipmentName}`)
      };
    });

    const multiple = makeAttendee("dark_yuta");
    multiple.yutaEquipments = [{ baseId: "accelerate" }, { baseId: "red_happi" }];
    const multipleIconCount = api.statusPartsForCard(multiple, true)
      .filter((part) => part.tone === "equipment-status").length;

    const plain = makeAttendee();
    const plainHasNoIcon = !api.hasEquipmentCard(plain)
      && api.statusPartsForCard(plain, true).every((part) => part.tone !== "equipment-status");

    const preview = document.createElement("div");
    preview.innerHTML = api.fieldCardTemplate(equipmentCases.at(-1).card);
    document.body.appendChild(preview);
    const icon = preview.querySelector(".equipment-status");
    const renderedGlyph = getComputedStyle(icon, "::before").content.replaceAll('"', "");
    preview.remove();
    const legacyYellowDecorationRemoved = [...document.querySelectorAll("style")]
      .every((style) => !style.textContent.includes(".equipped"));

    const padlocked = equipmentCases.find((entry) => entry.baseId === "padlock").card;
    const padlockParts = api.statusPartsForCard(padlocked, true);
    const padlockRestriction = api.battleCardRestrictionEntries(padlocked);
    const padlockShowsAttackUnavailable = padlockRestriction.some((entry) => entry.label === "攻撃不可：南京錠")
      && api.cardStatusDetailText(padlocked).includes("攻撃不可");
    const padlockHasNoStopIcon = !padlockParts.some((part) => part.icon === "止");

    api.state.screen = "battle";
    api.state.phase = "battle";
    api.state.players.player.board.seats = Array(9).fill(null);
    api.state.players.player.board.teacher = null;
    api.state.players.player.board.seats[0] = padlocked;
    api.render();
    const renderedPadlock = document.querySelector(`[data-card-id="${padlocked.instanceId}"]`);
    const padlockUsesChainOverlay = renderedPadlock?.classList.contains("attack-locked") === true;

    api.showBattleCardPreview(equipmentCases.find((entry) => entry.baseId === "earphones").card);
    const tappedPreviewShowsEarphones = document.getElementById("battleCardPreview").textContent.includes("装備：イヤホン");

    return {
      cases,
      multipleIconCount,
      plainHasNoIcon,
      renderedGlyph,
      legacyYellowDecorationRemoved,
      padlockShowsAttackUnavailable,
      padlockHasNoStopIcon,
      padlockUsesChainOverlay,
      tappedPreviewShowsEarphones
    };
  });

  result.cases.forEach(({ baseId, detected, iconCount, inStatusArea, detailListsEquipment, previewListsEquipment }) => {
    expect(detected, `${baseId}: 装備判定`).toBe(true);
    expect(iconCount, `${baseId}: アイコン数`).toBe(1);
    expect(inStatusArea, `${baseId}: 状態欄`).toBe(true);
    expect(detailListsEquipment, `${baseId}: 装備名`).toBe(true);
    expect(previewListsEquipment, `${baseId}: カード確認`).toBe(true);
  });
  expect(result.multipleIconCount).toBe(1);
  expect(result.plainHasNoIcon).toBe(true);
  expect(result.renderedGlyph).toBe("装");
  expect(result.legacyYellowDecorationRemoved).toBe(true);
  expect(result.padlockShowsAttackUnavailable).toBe(true);
  expect(result.padlockHasNoStopIcon).toBe(true);
  expect(result.padlockUsesChainOverlay).toBe(true);
  expect(result.tappedPreviewShowsEarphones).toBe(true);
});

test("指名破壊は対象を選んだ後に破壊するボタンで確定する", async ({ page }) => {
  await page.goto(gameUrl);

  const prepareSingleDestroy = async (baseId, zone, index) => page.evaluate(({ baseId, zone, index }) => {
    const api = window.__chibattle;
    api.startCardTest(baseId);
    const item = api.state.players.player.hand.find((card) => card.baseId === baseId);
    const target = zone === "teacher"
      ? api.state.players.opponent.board.teacher
      : api.state.players.opponent.board.seats[index];
    api.beginItemUse(item);
    api.handleBoardCardClick("opponent", zone, index);
    return { itemId: item.instanceId, targetId: target.instanceId };
  }, { baseId, zone, index });

  const destroyButton = page.locator("#itemTargetConfirmButton");
  const endTurnButton = page.locator("#endTurnButton");

  const seriouslyHit = await prepareSingleDestroy("seriously_hit", "seat", 4);
  await expect(page.locator(`[data-card-id="${seriouslyHit.targetId}"]`)).toHaveClass(/selected/);
  await expect(destroyButton).toBeVisible();
  await expect(destroyButton).toHaveText("破壊する");
  await expect(destroyButton).toHaveClass(/destroy-confirm/);
  await expect(endTurnButton).toBeHidden();
  expect(await page.evaluate(() => Boolean(window.__chibattle.state.players.opponent.board.seats[4]))).toBe(true);
  await destroyButton.click();
  expect(await page.evaluate(() => ({
    target: window.__chibattle.state.players.opponent.board.seats[4],
    itemInTrash: window.__chibattle.state.players.player.trash.some((card) => card.baseId === "seriously_hit")
  }))).toEqual({ target: null, itemInTrash: true });

  const favoriteNumber = await prepareSingleDestroy("favorite_number_s", "teacher", null);
  await expect(page.locator(`[data-card-id="${favoriteNumber.targetId}"]`)).toHaveClass(/selected/);
  await expect(destroyButton).toHaveText("破壊する");
  expect(await page.evaluate(() => Boolean(window.__chibattle.state.players.opponent.board.teacher))).toBe(true);
  await destroyButton.click();
  expect(await page.evaluate(() => ({
    target: window.__chibattle.state.players.opponent.board.teacher,
    copiedTeacher: window.__chibattle.state.players.player.hand.some((card) => card.baseId === "general_teacher")
  }))).toEqual({ target: null, copiedTeacher: true });

  const panpanTargets = await page.evaluate(() => {
    const api = window.__chibattle;
    api.startCardTest("panpan");
    const item = api.state.players.player.hand.find((card) => card.baseId === "panpan");
    const friendly = api.state.players.player.board.seats[4];
    const enemy = api.state.players.opponent.board.seats[4];
    api.beginItemUse(item);
    api.handleBoardCardClick("player", "seat", 4);
    return { friendlyId: friendly.instanceId, enemyId: enemy.instanceId };
  });
  await expect(destroyButton).toHaveText("自分の出席者を確定");
  await destroyButton.click();
  await page.evaluate(() => window.__chibattle.handleBoardCardClick("opponent", "seat", 4));
  await expect(page.locator(`[data-card-id="${panpanTargets.friendlyId}"]`)).toHaveClass(/selected/);
  await expect(page.locator(`[data-card-id="${panpanTargets.enemyId}"]`)).toHaveClass(/selected/);
  await expect(destroyButton).toHaveText("破壊する");
  expect(await page.evaluate(() => [
    Boolean(window.__chibattle.state.players.player.board.seats[4]),
    Boolean(window.__chibattle.state.players.opponent.board.seats[4])
  ])).toEqual([true, true]);
  await destroyButton.click();
  expect(await page.evaluate(() => [
    window.__chibattle.state.players.player.board.seats[4],
    window.__chibattle.state.players.opponent.board.seats[4]
  ])).toEqual([null, null]);

  const ghidorahTargetId = await page.evaluate(() => {
    const api = window.__chibattle;
    api.startCardTest("king_ghidorah_bed");
    const item = api.state.players.player.hand.find((card) => card.baseId === "king_ghidorah_bed");
    const discard = api.state.players.player.hand.find((card) => card.instanceId !== item.instanceId);
    const target = api.state.players.opponent.board.seats[4];
    api.state.players.player.will = 7;
    api.state.selectedHandId = item.instanceId;
    api.state.pendingKingGhidorahBed = {
      itemId: item.instanceId,
      effectMode: "2",
      discardId: discard.instanceId,
      target: null
    };
    api.render();
    api.handleBoardCardClick("opponent", "seat", 4);
    return target.instanceId;
  });
  await expect(page.locator(`[data-card-id="${ghidorahTargetId}"]`)).toHaveClass(/selected/);
  await expect(destroyButton).toHaveText("破壊する");
  expect(await page.evaluate(() => Boolean(window.__chibattle.state.players.opponent.board.seats[4]))).toBe(true);
  await destroyButton.click();
  expect(await page.evaluate(() => ({
    target: window.__chibattle.state.players.opponent.board.seats[4],
    ghidorahInTrash: window.__chibattle.state.players.player.trash.some((card) => card.baseId === "king_ghidorah_bed"),
    discardedCount: window.__chibattle.state.players.player.trash.length
  }))).toEqual({ target: null, ghidorahInTrash: true, discardedCount: 2 });
});
