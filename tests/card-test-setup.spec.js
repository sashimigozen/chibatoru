const { test, expect } = require("@playwright/test");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const gameUrl = pathToFileURL(path.join(__dirname, "..", "index.html")).href;

test("追加カードのテスト開始時に効果条件を満たす手札・盤面・デッキを用意する", async ({ page }) => {
  await page.goto(gameUrl);

  const result = await page.evaluate(() => {
    const api = window.__chibattle;
    const snapshots = {};
    const testIds = [
      "tokyo_tech_bro",
      "summer_teacher",
      "brother_capital",
      "padlock",
      "crotch_febreze",
      "smoke_flare",
      "one_eyed_peek",
      "aggro_army",
      "scout_student",
      "ta_squad",
      "happy_blue_bird",
      "suit_student",
      "bust_suit",
      "big_laughter",
      "lie_pekora",
      "big_wall",
      "forbidden_book",
      "philosophy_cheating",
      "think_so",
      "illegal_cafeteria",
      "namen_tenno",
      "course_registration_party"
    ];

    const boardCards = (side) => {
      const player = api.state.players[side];
      return [...player.board.seats.filter(Boolean), player.board.teacher].filter(Boolean);
    };

    testIds.forEach((baseId) => {
      api.startCardTest(baseId);
      const target = api.state.players.player.hand.find((card) => card.baseId === baseId);
      snapshots[baseId] = {
        usable: Boolean(target && api.canUseHandCardNow(target)),
        effectiveCost: target ? api.effectiveCardCost(target) : null,
        rulesText: target ? api.cardRulesText(target) : "",
        hand: api.state.players.player.hand.map((card) => card.baseId),
        deck: api.state.players.player.deck.map((card) => card.baseId),
        opponentHand: api.state.players.opponent.hand.map((card) => card.baseId),
        playerBoard: boardCards("player").map((card) => ({
          baseId: card.baseId,
          type: card.type,
          hp: card.currentHp
        })),
        opponentBoard: boardCards("opponent").map((card) => ({
          baseId: card.baseId,
          type: card.type,
          hp: card.currentHp
        })),
        late: api.state.players.player.late.map((entry) => entry.card.baseId),
        life: api.state.players.player.life,
        maxWill: api.state.players.player.maxWill,
        playerDeckSize: api.state.players.player.deck.length,
        opponentDeckSize: api.state.players.opponent.deck.length,
        superCheerful: Boolean(target && api.hasKeyword(target, "超陽気"))
      };
    });
    return snapshots;
  });

  Object.entries(result).forEach(([baseId, snapshot]) => {
    expect(snapshot.usable, `${baseId} should be immediately usable`).toBe(true);
  });

  expect(result.tokyo_tech_bro.late).toEqual(expect.arrayContaining(["lazy_student", "cancel_student"]));
  expect(result.summer_teacher.hand).toEqual(expect.arrayContaining(["trendy_student", "extra_people", "kyoto_sound_i"]));
  expect(result.brother_capital.deck.slice(0, 4)).toEqual(expect.arrayContaining([
    "aggro_student", "single_cell", "ae_student", "general_student"
  ]));
  expect(result.crotch_febreze.playerBoard.filter((card) => card.baseId.includes("ae_student"))).toHaveLength(2);
  expect(result.crotch_febreze.opponentBoard.filter((card) => card.type === "teacher").length).toBeGreaterThanOrEqual(2);
  expect(result.smoke_flare.maxWill).toBe(8);
  expect(result.one_eyed_peek.opponentHand.length).toBeGreaterThan(0);
  expect(result.scout_student.opponentBoard).toHaveLength(0);
  expect(result.scout_student.superCheerful).toBe(true);
  expect(result.happy_blue_bird.playerBoard.filter((card) => card.baseId === "happy_blue_bird")).toHaveLength(1);
  expect(result.happy_blue_bird.opponentBoard).toEqual([
    expect.objectContaining({ baseId: "general_student", hp: 1 })
  ]);
  expect(result.suit_student.effectiveCost).toBe(6);
  expect(result.suit_student.rulesText).toContain("出席数：2人");
  expect(result.suit_student.hand.filter((baseId) => baseId === "suit_student")).toHaveLength(2);
  expect(result.suit_student.playerBoard.some((card) => card.baseId === "suit_student")).toBe(true);
  expect(result.suit_student.opponentBoard.some((card) => card.baseId === "suit_student")).toBe(true);
  expect(result.bust_suit.playerBoard.some((card) => card.baseId === "general_student")).toBe(true);
  expect(result.bust_suit.opponentBoard.some((card) => card.type === "student")).toBe(true);
  expect(result.philosophy_cheating.opponentHand.filter((baseId) => ["ruler", "bento"].includes(baseId))).toHaveLength(2);
  expect(result.big_laughter.playerBoard.length).toBeGreaterThanOrEqual(4);
  expect(result.lie_pekora.playerBoard).toHaveLength(result.lie_pekora.opponentBoard.length);
  expect(result.big_wall.playerBoard.filter((card) => ["aggro_student", "general_student"].includes(card.baseId)).length).toBeGreaterThanOrEqual(2);
  expect(result.forbidden_book.life).toBeLessThanOrEqual(10);
  expect(result.think_so.deck).toContain("yuta");
  expect(result.illegal_cafeteria.hand).toContain("classroom");
  expect(result.illegal_cafeteria.playerBoard.some((card) => card.type === "vampire" && card.hp === 1)).toBe(true);
  expect(result.illegal_cafeteria.opponentBoard.some((card) => card.type === "vampire" && card.hp < 10)).toBe(true);
  expect(result.namen_tenno.opponentBoard.filter((card) => card.type === "vampire")).toHaveLength(3);
  expect(result.course_registration_party.playerDeckSize).toBeGreaterThanOrEqual(5);
  expect(result.course_registration_party.opponentDeckSize).toBeGreaterThanOrEqual(5);
});

test("TA軍団は手札から2行目へ出席した場合だけ残りの空きマスへコピーを出席させる", async ({ page }) => {
  await page.goto(gameUrl);

  const result = await page.evaluate(() => {
    const api = window.__chibattle;
    const { state } = api;
    const reset = () => {
      state.phase = "battle";
      state.gameOver = false;
      state.actionTurn = 1;
      state.players.player.board.seats = Array(9).fill(null);
      state.players.player.board.teacher = null;
      state.players.opponent.board.seats = Array(9).fill(null);
      state.players.opponent.board.teacher = null;
    };
    const squad = () => api.makeBoardCard(api.createCardFromBase("ta_squad", "player"));

    reset();
    const placementCard = api.createCardFromBase("ta_squad", "player");
    const placement = {
      secondRow: api.canPlaceCard("player", placementCard, "seat", "player", 4),
      firstRow: api.canPlaceCard("player", placementCard, "seat", "player", 1),
      teacher: api.canPlaceCard("player", placementCard, "teacher", "player", null)
    };

    api.attendCard("player", squad(), "seat", 4, { attendanceSource: api.ATTENDANCE_SOURCE.HAND });
    const handAttendance = state.players.player.board.seats.map((card) => card?.baseId || null);
    const sources = state.players.player.board.seats.map((card) => card?.lastAttendanceSource || null);

    reset();
    api.attendCard("player", squad(), "seat", 4, { attendanceSource: api.ATTENDANCE_SOURCE.EFFECT });
    const effectAttendance = state.players.player.board.seats.map((card) => card?.baseId || null);

    return { placement, handAttendance, sources, effectAttendance };
  });

  expect(result.placement).toEqual({ secondRow: true, firstRow: false, teacher: false });
  expect(result.handAttendance.slice(3, 6)).toEqual(["ta_squad", "ta_squad", "ta_squad"]);
  expect(result.handAttendance.filter((baseId) => baseId === "ta_squad")).toHaveLength(3);
  expect(result.sources.slice(3, 6)).toEqual(["copy", "hand", "copy"]);
  expect(result.effectAttendance.filter((baseId) => baseId === "ta_squad")).toHaveLength(1);
});

test("幸せの青い鳥は本体を攻撃せず、攻撃で倒した位置へ相手所有の基本5/5を出席させる", async ({ page }) => {
  await page.goto(gameUrl);

  const result = await page.evaluate(() => {
    const api = window.__chibattle;
    const { state } = api;
    const reset = () => {
      state.phase = "battle";
      state.currentSide = "player";
      state.gameOver = false;
      state.testMode = true;
      state.actionTurn = 2;
      state.noAttackUntilActionTurn = 0;
      state.players.player.turnsTaken = 2;
      state.players.opponent.turnsTaken = 1;
      state.players.player.board.seats = Array(9).fill(null);
      state.players.player.board.teacher = null;
      state.players.player.trash = [];
      state.players.opponent.board.seats = Array(9).fill(null);
      state.players.opponent.board.teacher = null;
      state.players.opponent.trash = [];
    };
    const bird = (owner = "player") => {
      const card = api.makeBoardCard(api.createCardFromBase("happy_blue_bird", owner));
      card.playedOnTurn = 0;
      return card;
    };
    const weakStudent = () => {
      const card = api.makeBoardCard(api.createCardFromBase("general_student", "opponent"));
      card.playedOnTurn = 0;
      card.currentHp = 1;
      return card;
    };

    reset();
    const automaticBird = bird();
    state.players.player.board.seats[0] = automaticBird;
    state.players.opponent.board.seats[4] = weakStudent();
    state.selectedAttacker = { owner: "player", zone: "seat", index: 0 };
    const canAttackLife = api.canSelectedAttackerTargetLife("opponent");
    state.selectedAttacker = null;
    api.resolveHappyBlueBirdEndTurnAttacks("player");
    const automaticSpawn = state.players.opponent.board.seats[4];
    const automaticTrash = state.players.opponent.trash.map((card) => card.baseId);

    reset();
    const manualBird = bird();
    state.players.player.board.seats[0] = manualBird;
    state.players.opponent.board.teacher = weakStudent();
    const manualResult = api.resolveCardAttackWithBoardCleanup(manualBird, {
      owner: "opponent",
      zone: "teacher",
      index: null
    });
    const manualSpawn = state.players.opponent.board.teacher;

    reset();
    const nonLethalBird = bird();
    state.players.player.board.seats[0] = nonLethalBird;
    const durableTarget = api.makeBoardCard(api.createCardFromBase("loud_student", "opponent"));
    durableTarget.playedOnTurn = 0;
    state.players.opponent.board.seats[4] = durableTarget;
    const nonLethalResult = api.resolveCardAttackWithBoardCleanup(nonLethalBird, {
      owner: "opponent",
      zone: "seat",
      index: 4
    });
    const nonLethalTarget = state.players.opponent.board.seats[4];

    reset();
    const spentBird = bird();
    spentBird.hasAttacked = true;
    state.players.player.board.seats[0] = spentBird;
    state.players.opponent.board.seats[4] = weakStudent();
    api.resolveHappyBlueBirdEndTurnAttacks("player");

    return {
      canAttackLife,
      automatic: {
        attackerHasAttacked: automaticBird.hasAttacked,
        baseId: automaticSpawn?.baseId,
        owner: automaticSpawn?.owner,
        attack: automaticSpawn?.attack,
        hp: automaticSpawn?.currentHp,
        opponentTrash: automaticTrash
      },
      manual: {
        result: manualResult,
        baseId: manualSpawn?.baseId,
        owner: manualSpawn?.owner,
        attack: manualSpawn?.attack,
        hp: manualSpawn?.currentHp
      },
      nonLethal: {
        result: nonLethalResult,
        baseId: nonLethalTarget?.baseId,
        hp: nonLethalTarget?.currentHp
      },
      spentTarget: state.players.opponent.board.seats[4]?.baseId
    };
  });

  expect(result.canAttackLife).toBe(false);
  expect(result.automatic).toMatchObject({
    attackerHasAttacked: true,
    baseId: "happy_blue_bird",
    owner: "opponent",
    attack: 5,
    hp: 5,
    opponentTrash: ["general_student"]
  });
  expect(result.manual).toMatchObject({
    result: { targetDefeated: true, birdSummoned: true },
    baseId: "happy_blue_bird",
    owner: "opponent",
    attack: 5,
    hp: 5
  });
  expect(result.nonLethal).toMatchObject({
    result: { targetDefeated: false, birdSummoned: false },
    baseId: "loud_student",
    hp: 4
  });
  expect(result.spentTarget).toBe("general_student");
});

test("スーツを着た学生は出席元と再出席を数えて戦意が下がり、教師のダメージを受けない", async ({ page }) => {
  await page.goto(gameUrl);

  const result = await page.evaluate(() => {
    const api = window.__chibattle;
    const { state } = api;
    state.screen = "battle";
    state.phase = "battle";
    state.actionTurn = 2;
    state.suitStudentAttendanceCount = 0;
    state.players.player.board.seats = Array(9).fill(null);
    state.players.player.board.teacher = null;
    state.players.opponent.board.seats = Array(9).fill(null);
    state.players.opponent.board.teacher = null;

    const discounted = api.createCardFromBase("suit_student", "player");
    const costs = [api.effectiveCardCost(discounted)];
    const sameCard = api.makeBoardCard(api.createCardFromBase("suit_student", "player"));
    api.attendCard("player", sameCard, "seat", 0, { attendanceSource: api.ATTENDANCE_SOURCE.HAND });
    costs.push(api.effectiveCardCost(discounted));

    state.players.player.board.seats[0] = null;
    api.attendCard("player", sameCard, "seat", 0, { attendanceSource: api.ATTENDANCE_SOURCE.EFFECT });
    costs.push(api.effectiveCardCost(discounted));

    const fromDeck = api.makeBoardCard(api.createCardFromBase("suit_student", "opponent"));
    api.attendCard("opponent", fromDeck, "seat", 0, { attendanceSource: api.ATTENDANCE_SOURCE.DECK });
    costs.push(api.effectiveCardCost(discounted));

    const fromLate = api.makeBoardCard(api.createCardFromBase("suit_student", "opponent"));
    api.attendCard("opponent", fromLate, "seat", 1, { attendanceSource: api.ATTENDANCE_SOURCE.LATE });
    costs.push(api.effectiveCardCost(discounted));

    const trackedCount = state.suitStudentAttendanceCount;
    const dynamicText = api.cardRulesText(discounted);
    state.suitStudentAttendanceCount = 20;
    const minimumCost = api.effectiveCardCost(discounted);

    const teacher = api.makeBoardCard(api.createCardFromBase("general_teacher", "opponent"));
    const attackTarget = api.makeBoardCard(api.createCardFromBase("suit_student", "player"));
    const attackDamage = api.dealDamageToCard(attackTarget, 9, teacher, { combat: true });
    const attackHp = attackTarget.currentHp;

    const lectureTarget = api.makeBoardCard(api.createCardFromBase("suit_student", "player"));
    const lecturePreview = api.previewFinalDamageToCard(lectureTarget, 9, teacher, { damageKind: "lecture" });
    const lectureDamage = api.dealDamageToCard(lectureTarget, 9, teacher, { damageKind: "lecture" });
    const lectureHp = lectureTarget.currentHp;

    const student = api.makeBoardCard(api.createCardFromBase("general_student", "opponent"));
    const studentTarget = api.makeBoardCard(api.createCardFromBase("suit_student", "player"));
    const studentDamage = api.dealDamageToCard(studentTarget, 1, student, { combat: true });

    return {
      costs,
      count: trackedCount,
      dynamicText,
      minimumCost,
      attackDamage,
      attackHp,
      lecturePreview,
      lectureDamage,
      lectureHp,
      studentDamage,
      studentHp: studentTarget.currentHp
    };
  });

  expect(result.costs).toEqual([8, 7, 6, 5, 4]);
  expect(result.count).toBe(4);
  expect(result.dynamicText).toContain("\n出席数：4人");
  expect(result.minimumCost).toBe(0);
  expect(result.attackDamage).toBe(0);
  expect(result.attackHp).toBe(1);
  expect(result.lecturePreview).toBe(0);
  expect(result.lectureDamage).toBe(0);
  expect(result.lectureHp).toBe(1);
  expect(result.studentDamage).toBe(1);
  expect(result.studentHp).toBe(0);
});
