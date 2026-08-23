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
